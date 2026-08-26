require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/room' });

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'tlds_secret_change_this';
if (!process.env.JWT_SECRET) {
  console.warn('[WARNING] JWT_SECRET is not set — using an insecure default. Set it in your environment before going live.');
}
// Comma-separated list of allowed frontend origins, e.g. "https://tlds.org,https://www.tlds.org"
const FRONTEND_ORIGINS = (process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).filter(Boolean);

// ── Storage ──
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
[DATA_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); });
// NOTE: Render's default disk is ephemeral — everything in DATA_DIR/UPLOADS_DIR
// is wiped on redeploy/restart. For anything you need to keep long-term
// (members, meetings, recordings, music), point this at a real database and
// object storage (e.g. Postgres/Mongo + S3-compatible storage) before launch.

// Using diskStorage (not the `dest` shorthand) so uploaded files keep their
// original extension. `dest` alone names files with no extension at all,
// which makes Express serve them as application/octet-stream instead of
// audio/*, and that silently breaks playback in some browsers.
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname).toLowerCase()}`)
});
const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB — generous for a recorded session, not unbounded
  fileFilter: (req, file, cb) => {
    const ok = /^audio\//.test(file.mimetype) || /\.(mp3|wav|m4a|webm|ogg|aac)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only audio files are allowed'), ok);
  }
});

// ── Simple JSON DB ──
function dbPath(name) { return path.join(DATA_DIR, name+'.json'); }
function dbRead(name) {
  try { return JSON.parse(fs.readFileSync(dbPath(name),'utf8')); } catch { return []; }
}
function dbWrite(name, data) { fs.writeFileSync(dbPath(name), JSON.stringify(data, null, 2)); }

// ── Middleware ──
app.use(compression()); // gzip JSON/static responses — meaningful win on slower connections
app.use(cors({
  origin: FRONTEND_ORIGINS.length ? FRONTEND_ORIGINS : true, // reflect origin if none configured (dev-friendly; set FRONTEND_URL in prod)
  credentials: false // Bearer-token auth is used, not cookies, so credentials aren't needed
}));
app.use(express.json({ limit: '2mb' })); // chat/canvas payloads are small; large media goes through multer instead
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', immutable: true }));

// ── Auth middleware ──
function auth(req, res, next) {
  const token = (req.headers.authorization||'').replace('Bearer ','');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'host') return res.status(403).json({ error: 'Forbidden' });
    next();
  });
}

// ── Email ──
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: 587, secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_USER) return;
  try { await mailer.sendMail({ from: `TLDS LIVE <${process.env.SMTP_USER}>`, to, subject, html }); }
  catch(e) { console.error('[Email]', e.message); }
}

async function sendMeetingReminder(meeting, hoursLeft) {
  const users = dbRead('users');
  const html = `<div style="font-family:Inter,sans-serif;max-width:500px;margin:0 auto">
    <div style="background:#1a4a2e;padding:20px;border-radius:12px 12px 0 0;text-align:center">
      <h2 style="color:#fff;margin:0">TLDS LIVE</h2>
    </div>
    <div style="background:#f8fdf9;padding:28px;border-radius:0 0 12px 12px;border:1px solid #c2dece">
      <h3 style="color:#1a4a2e">Meeting Reminder</h3>
      <p style="color:#5a7a65">Your meeting starts in <strong>${hoursLeft} hour${hoursLeft>1?'s':''}</strong>:</p>
      <div style="background:#fff;border:1.5px solid #c2dece;border-radius:10px;padding:16px;margin:16px 0">
        <strong style="color:#1a4a2e;font-size:1.1rem">${meeting.title}</strong><br/>
        <span style="color:#5a7a65;font-size:.9rem">${new Date(meeting.scheduledAt).toLocaleString()}</span>
      </div>
      <a href="${FRONTEND_ORIGINS[0]||'#'}" style="display:inline-block;background:#1a4a2e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Join Meeting</a>
      <p style="color:#5a7a65;font-size:.8rem;margin-top:20px">God bless you! — Tree of Life Discipleship School</p>
    </div></div>`;
  for (const user of users) {
    await sendEmail(user.email, `Reminder: "${meeting.title}" in ${hoursLeft} hour${hoursLeft>1?'s':''}`, html);
  }
}

// Restart-safe reminder scheduling: instead of one setTimeout per reminder
// (which is lost on restart and overflows for dates >24.8 days out), sweep
// all upcoming meetings on an interval and fire any reminder whose window
// has been entered, flagging it as sent so restarts never duplicate/miss it.
const REMINDER_SWEEP_MS = 5 * 60 * 1000; // every 5 minutes
async function reminderSweep() {
  const meetings = dbRead('meetings');
  const now = Date.now();
  let changed = false;
  for (const m of meetings) {
    if (m.status === 'ended') continue;
    const t = new Date(m.scheduledAt).getTime();
    if (isNaN(t)) continue;
    const hoursOut = (t - now) / (60*60*1000);
    if (!m.reminder24Sent && hoursOut <= 24 && hoursOut > 23) {
      m.reminder24Sent = true; changed = true;
      sendMeetingReminder(m, 24).catch(()=>{});
    }
    if (!m.reminder1Sent && hoursOut <= 1 && hoursOut > 0) {
      m.reminder1Sent = true; changed = true;
      sendMeetingReminder(m, 1).catch(()=>{});
    }
  }
  if (changed) dbWrite('meetings', meetings);
}
setInterval(reminderSweep, REMINDER_SWEEP_MS);
reminderSweep().catch(()=>{});

// ══ HEALTH ══
app.get('/health', (_req, res) => res.json({ ok: true }));

// ══ AUTH ══
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, phone, location } = req.body;
  if (!name||!email||!password) return res.status(400).json({ error: 'Name, email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password too short' });
  const users = dbRead('users');
  if (users.find(u => u.email === email.toLowerCase())) return res.status(400).json({ error: 'Email already registered' });
  const hashed = await bcrypt.hash(password, 12);
  const isFirst = users.length === 0;
  const user = { id: uuid(), name, email: email.toLowerCase(), password: hashed, phone: phone||'', location: location||'', role: isFirst?'admin':'member', createdAt: new Date().toISOString() };
  users.push(user);
  dbWrite('users', users);
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
  const { password: _, ...safeUser } = user;
  await sendEmail(user.email, 'Welcome to TLDS LIVE!', `<p>Hi ${name.split(' ')[0]}, welcome to Tree of Life Discipleship School Live platform! God bless you!</p>`);
  res.status(201).json({ user: safeUser, token });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const users = dbRead('users');
  const user = users.find(u => u.email === email?.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

app.put('/api/auth/profile', auth, (req, res) => {
  const { name, phone, location } = req.body;
  const users = dbRead('users');
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (name) users[idx].name = name;
  if (phone !== undefined) users[idx].phone = phone;
  if (location !== undefined) users[idx].location = location;
  dbWrite('users', users);
  const { password: _, ...safe } = users[idx];
  res.json({ user: safe });
});

app.post('/api/auth/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password too short' });
  const users = dbRead('users');
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  const ok = await bcrypt.compare(currentPassword, users[idx].password);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  users[idx].password = await bcrypt.hash(newPassword, 12);
  dbWrite('users', users);
  res.json({ ok: true });
});

// ══ MEETINGS ══
app.get('/api/meetings', (_req, res) => {
  const meetings = dbRead('meetings');
  res.json({ meetings: meetings.sort((a,b) => new Date(b.scheduledAt)-new Date(a.scheduledAt)) });
});

app.post('/api/meetings', adminOnly, async (req, res) => {
  const { title, description, scheduledAt, duration } = req.body;
  if (!title||!scheduledAt) return res.status(400).json({ error: 'Title and date required' });
  const meeting = { _id: uuid(), title, description: description||'', scheduledAt, duration: duration||'', status: 'upcoming', createdAt: new Date().toISOString(), canvas: '', chatHistory: [], reminder24Sent: false, reminder1Sent: false };
  const meetings = dbRead('meetings');
  meetings.push(meeting);
  dbWrite('meetings', meetings);
  // Reminders are now handled by the periodic reminderSweep() above, which
  // survives restarts and doesn't overflow setTimeout for far-future dates.
  res.status(201).json({ meeting });
});

app.post('/api/meetings/:id/start', adminOnly, (req, res) => {
  const meetings = dbRead('meetings');
  const idx = meetings.findIndex(m => m._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  meetings[idx].status = 'live';
  meetings[idx].startedAt = new Date().toISOString();
  dbWrite('meetings', meetings);
  broadcastToRoom(req.params.id, { type: 'meeting_started', payload: {} });
  res.json({ meeting: meetings[idx] });
});

app.post('/api/meetings/:id/end', adminOnly, (req, res) => {
  const meetings = dbRead('meetings');
  const idx = meetings.findIndex(m => m._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  meetings[idx].status = 'ended';
  meetings[idx].endedAt = new Date().toISOString();
  dbWrite('meetings', meetings);
  res.json({ meeting: meetings[idx] });
});

app.post('/api/meetings/:id/canvas', auth, (req, res) => {
  const meetings = dbRead('meetings');
  const idx = meetings.findIndex(m => m._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  meetings[idx].canvas = req.body.content || '';
  dbWrite('meetings', meetings);
  res.json({ ok: true });
});

app.get('/api/meetings/:id/canvas', auth, (req, res) => {
  const meetings = dbRead('meetings');
  const meeting = meetings.find(m => m._id === req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });
  res.json({ content: meeting.canvas || '' });
});

app.get('/api/meetings/:id/chat', auth, (req, res) => {
  const meetings = dbRead('meetings');
  const meeting = meetings.find(m => m._id === req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });
  res.json({ messages: meeting.chatHistory || [] });
});

app.post('/api/meetings/:id/chat', auth, (req, res) => {
  const meetings = dbRead('meetings');
  const idx = meetings.findIndex(m => m._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const text = String(req.body.text || '').slice(0, 2000);
  if (!text.trim()) return res.status(400).json({ error: 'Empty message' });
  // Identity comes from the verified JWT, never from the client body —
  // otherwise any logged-in member could claim to be an admin or someone else.
  const msg = { id: uuid(), text, name: req.user.name, role: req.user.role, userId: req.user.id, savedAt: new Date().toISOString(), time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) };
  if (!meetings[idx].chatHistory) meetings[idx].chatHistory = [];
  meetings[idx].chatHistory.push(msg);
  dbWrite('meetings', meetings);
  broadcastToRoom(req.params.id, { type: 'chat', payload: msg });
  res.status(201).json({ message: msg });
});

app.post('/api/meetings/:id/mute', adminOnly, (req, res) => {
  broadcastToRoom(req.params.id, { type: 'muted', payload: { userId: req.body.userId } });
  res.json({ ok: true });
});

// ══ RECORDINGS ══
app.post('/api/recordings', auth, audioUpload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const recordings = dbRead('recordings');
  const rec = { id: uuid(), meetingId: req.body.meetingId, title: req.body.title||'Recording', recordedAt: req.body.recordedAt||new Date().toISOString(), url: '/uploads/'+req.file.filename, size: (req.file.size/1024/1024).toFixed(1)+' MB', uploadedBy: req.user.id };
  recordings.push(rec);
  dbWrite('recordings', recordings);
  res.status(201).json({ recording: rec });
});

app.get('/api/recordings', auth, (req, res) => {
  const recordings = dbRead('recordings');
  const limit = req.query.limit ? parseInt(req.query.limit) : recordings.length;
  res.json({ recordings: recordings.slice(-limit).reverse() });
});

// ══ MUSIC (shared background tracks — stored server-side so every
//    participant actually hears the same file, instead of each browser's
//    own localStorage) ══
app.get('/api/music', auth, (req, res) => {
  res.json({ tracks: dbRead('music') });
});

app.post('/api/music', adminOnly, audioUpload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const tracks = dbRead('music');
  const track = { id: uuid(), name: (req.body.name || req.file.originalname).slice(0, 200), url: '/uploads/'+req.file.filename, size: (req.file.size/1024/1024).toFixed(1)+' MB', uploadedBy: req.user.id, uploadedAt: new Date().toISOString() };
  tracks.push(track);
  dbWrite('music', tracks);
  res.status(201).json({ track });
});

app.delete('/api/music/:id', adminOnly, (req, res) => {
  const tracks = dbRead('music');
  const idx = tracks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = tracks.splice(idx, 1);
  dbWrite('music', tracks);
  const filePath = path.join(UPLOADS_DIR, path.basename(removed.url));
  fs.unlink(filePath, () => {});
  res.json({ ok: true });
});

// ══ ADMIN ══
app.get('/api/admin/stats', adminOnly, (req, res) => {
  const users = dbRead('users').map(u => { const {password,...s}=u; return s; });
  res.json({ users: users.length, meetings: dbRead('meetings').length, recordings: dbRead('recordings').length, userList: users });
});

app.put('/api/admin/users/:id/role', adminOnly, (req, res) => {
  const { role } = req.body;
  if (!['admin','host','member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const users = dbRead('users');
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  users[idx].role = role;
  dbWrite('users', users);
  res.json({ ok: true });
});

// ══ WEBSOCKET (chat/canvas/presence signaling + WebRTC offer/answer/ICE relay) ══
const rooms = new Map(); // roomId -> Map(socketId -> { ws, user, muted, speaking })

function broadcastToRoom(roomId, data, excludeSocketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(data);
  room.forEach(({ ws }, id) => { if (id !== excludeSocketId && ws.readyState === 1) ws.send(payload); });
}

function sendToUser(roomId, targetUserId, data) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(data);
  room.forEach(({ ws, user }) => { if (user && user.userId === targetUserId && ws.readyState === 1) ws.send(payload); });
}

function getRoomParticipants(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.values()).map(c => ({ userId: c.user.userId, name: c.user.name, role: c.user.role, muted: c.muted||false, speaking: c.speaking||false }));
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.pathname.replace('/room/','').replace('/room','');
  const token = url.searchParams.get('token');

  // Verify the JWT before accepting anything from this socket. Without this,
  // any client can open a raw WebSocket to a room and claim to be anyone —
  // including an admin — without ever logging in.
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const socketId = uuid();
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  const room = rooms.get(roomId);
  // Identity is taken from the verified token, never from client-sent payloads.
  let clientData = { ws, user: { userId: decoded.id, name: decoded.name, role: decoded.role }, muted: false, speaking: false };
  room.set(socketId, clientData);

  const meetings = dbRead('meetings');
  const meeting = meetings.find(m => m._id === roomId);
  if (meeting?.canvas) ws.send(JSON.stringify({ type: 'canvas', payload: { content: meeting.canvas } }));
  broadcastToRoom(roomId, { type: 'participants', payload: { participants: getRoomParticipants(roomId) } });

  ws.on('message', (raw) => {
    try {
      const { type, payload } = JSON.parse(raw);
      if (type === 'join') {
        // Identity already established from the token above — nothing to do,
        // this message is kept only for client-side backward compatibility.
      } else if (type === 'mute_self') {
        clientData.muted = !!payload.muted;
        broadcastToRoom(roomId, { type: 'participants', payload: { participants: getRoomParticipants(roomId) } });
      } else if (type === 'canvas') {
        broadcastToRoom(roomId, { type: 'canvas', payload }, socketId);
      } else if (type === 'music') {
        broadcastToRoom(roomId, { type: 'music', payload }, socketId);
      } else if (type === 'speaking') {
        clientData.speaking = !!payload.speaking;
        broadcastToRoom(roomId, { type: 'participants', payload: { participants: getRoomParticipants(roomId) } });
      } else if (type === 'webrtc-offer' || type === 'webrtc-answer' || type === 'webrtc-ice') {
        // Relay signaling to the specific target peer only, stamping the
        // verified sender id so the recipient knows who it's really from.
        const { targetUserId, ...rest } = payload;
        if (targetUserId) sendToUser(roomId, targetUserId, { type, payload: { ...rest, fromUserId: clientData.user.userId } });
      }
    } catch(e) {}
  });

  ws.on('close', () => {
    room.delete(socketId);
    if (room.size === 0) rooms.delete(roomId);
    else broadcastToRoom(roomId, { type: 'participants', payload: { participants: getRoomParticipants(roomId) } });
  });
});

server.listen(PORT, () => {
  console.log(`\n TLDS Platform v3 running on port ${PORT}`);
  console.log(`   Email: ${process.env.SMTP_USER ? 'configured' : 'not configured'}\n`);
});
