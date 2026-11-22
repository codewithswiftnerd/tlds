import { addChunk, getChunks, putMeta, requestPersistence } from './recordingStore';
import { fixWebmDuration } from './webmDuration';
import { initials } from '../utils/format';

const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
const VIDEO_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
const W = 1280, H = 720, FPS = 15;
const TONES = ['#145C3A', '#2F6F57', '#3B7A57', '#5B7F2B', '#2A6B6B', '#6B5B2A', '#7A4B3B'];
const tone = (s = '') => TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

export function recordingSupport() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const rec = typeof window.MediaRecorder !== 'undefined' && !!AC;
  const canvas = typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  const pick = (list) => list.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
  return { audio: rec && !!pick(AUDIO_TYPES), video: rec && canvas && !!pick(VIDEO_TYPES) };
}

/** A timer that keeps ticking in background tabs (main-thread timers get throttled there). */
function ticker(ms, fn) {
  try {
    const src = `let t=setInterval(()=>postMessage(0),${ms});onmessage=()=>{clearInterval(t);close()}`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = fn;
    return () => { w.postMessage(0); w.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const i = setInterval(fn, ms);
    return () => clearInterval(i);
  }
}

/**
 * Records a meeting on the recorder's own device.
 *  - Audio: every participant's microphone (and shared-tab audio) mixed into one track.
 *  - Video (optional): a 720p "speaker view": the shared screen when someone presents, otherwise the
 *    active speaker's camera, otherwise a name card, with a lower-third title bar.
 * Chunks go to IndexedDB every few seconds, so nothing is lost if the page dies mid-meeting.
 */
export class MeetingRecorder {
  constructor({ video = false, meta }) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.video = video;
    this.meta = meta;
    this.id = `${meta.meetingId}_${Date.now()}`;
    this.ctx = new AC();
    this.dest = this.ctx.createMediaStreamDestination();
    this.sources = new Map();
    this.memChunks = [];
    this.persisted = true;
    this.seq = 0;
    this.queue = Promise.resolve();
    this.scene = { title: meta.meetingTitle || '', screen: null, speaker: null };
    this.els = new Map();
    this.poster = null;
    this.onError = null;
    this._wake = () => { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); };
  }

  /** streams: { key: MediaStream } with audio tracks. Safe to call whenever people join, leave or republish. */
  sync(streams) {
    for (const [k, s] of this.sources) {
      if (streams[k] !== s.stream) { try { s.node.disconnect(); } catch { /* gone */ } this.sources.delete(k); }
    }
    for (const [k, st] of Object.entries(streams)) {
      if (!st || this.sources.has(k) || !st.getAudioTracks().some((t) => t.readyState === 'live')) continue;
      try {
        const node = this.ctx.createMediaStreamSource(st);
        node.connect(this.dest);
        this.sources.set(k, { stream: st, node });
      } catch { /* stream not usable yet; picked up on the next sync */ }
    }
  }

  /** scene: { screen: {stream, name} | null, speaker: {stream|null, name} | null } */
  setScene(scene) { this.scene = { ...this.scene, ...scene }; }

  _videoFor(stream) {
    if (!stream) return null;
    let el = this.els.get(stream);
    if (!el) {
      el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.autoplay = true;
      el.srcObject = stream;
      el.play?.().catch(() => {});
      this.els.set(stream, el);
    }
    return el.videoWidth ? el : null;
  }

  _gc() {
    const keep = new Set([this.scene.screen?.stream, this.scene.speaker?.stream].filter(Boolean));
    for (const [s, el] of this.els) if (!keep.has(s)) { el.srcObject = null; this.els.delete(s); }
  }

  _draw() {
    const g = this.g;
    if (!g) return;
    this._gc();
    g.fillStyle = '#0E1512'; g.fillRect(0, 0, W, H);
    const screen = this._videoFor(this.scene.screen?.stream);
    const cam = this._videoFor(this.scene.speaker?.stream);
    const fit = (el, x, y, w, h, cover) => {
      const r = el.videoWidth / el.videoHeight, R = w / h;
      let dw = w, dh = h;
      if (cover ? r > R : r < R) dw = h * r; else dh = w / r;
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      g.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      g.restore();
    };
    if (screen) {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H - 64);
      fit(screen, 0, 0, W, H - 64, false);
      if (cam) { g.fillStyle = '#000'; g.fillRect(W - 268, H - 64 - 164, 256, 144); fit(cam, W - 268, H - 64 - 164, 256, 144, true); }
    } else if (cam) {
      fit(cam, 0, 0, W, H, true);
    } else {
      const name = this.scene.speaker?.name || '';
      const cx = W / 2, cy = H / 2 - 40;
      g.fillStyle = name ? tone(name) : '#145C3A';
      g.beginPath(); g.arc(cx, cy, 90, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 64px Inter, system-ui, sans-serif';
      g.fillText(name ? initials(name) : 'TLDS', cx, cy + 2);
      g.font = '500 30px Inter, system-ui, sans-serif';
      g.fillStyle = '#dbe7df';
      g.fillText(name || this.scene.title, cx, cy + 150);
    }
    // Lower third.
    g.fillStyle = 'rgba(11,43,29,0.92)'; g.fillRect(0, H - 64, W, 64);
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = '#36A779'; g.font = '700 18px Inter, system-ui, sans-serif'; g.fillText('TLDS LIVE', 24, H - 32);
    g.fillStyle = '#fff'; g.font = '500 22px Inter, system-ui, sans-serif';
    const title = this.scene.title.length > 60 ? `${this.scene.title.slice(0, 59)}…` : this.scene.title;
    g.fillText(title, 150, H - 32);
    const who = this.scene.screen ? `${this.scene.screen.name} is presenting` : cam ? this.scene.speaker?.name || '' : '';
    if (who) { g.textAlign = 'right'; g.fillStyle = '#b9cbc0'; g.font = '400 20px Inter, system-ui, sans-serif'; g.fillText(who, W - 24, H - 32); }
  }

  async start() {
    const support = recordingSupport();
    if (!(this.video ? support.video : support.audio)) throw new Error('unsupported');
    this.ctx.resume?.();
    document.addEventListener('visibilitychange', this._wake);
    let stream = this.dest.stream;
    if (this.video) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = W; this.canvas.height = H;
      this.g = this.canvas.getContext('2d');
      this._draw();
      const vt = this.canvas.captureStream(FPS).getVideoTracks()[0];
      stream = new MediaStream([vt, ...this.dest.stream.getAudioTracks()]);
      this.stopTicker = ticker(Math.round(1000 / FPS), () => this._draw());
      this.posterTimer = setTimeout(() => this._grabPoster(), 8000);
    }
    const types = this.video ? VIDEO_TYPES : AUDIO_TYPES;
    this.mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const opts = { audioBitsPerSecond: 64000, ...(this.video ? { videoBitsPerSecond: 1_000_000 } : {}), ...(this.mimeType ? { mimeType: this.mimeType } : {}) };
    this.rec = new MediaRecorder(stream, opts);
    this.mimeType = (this.rec.mimeType || this.mimeType || (this.video ? 'video/webm' : 'audio/webm')).split(';')[0];
    this.t0 = Date.now();

    requestPersistence();
    try {
      await putMeta({ id: this.id, ...this.meta, mediaType: this.video ? 'video' : 'audio', mimeType: this.mimeType, startedAt: this.t0, durationSec: 0, status: 'recording' });
      this.usedDevice = true;
    } catch { this.persisted = false; }

    this.rec.ondataavailable = (e) => {
      if (!e.data?.size) return;
      const seq = this.seq++;
      if (!this.persisted) { this.memChunks.push(e.data); return; }
      this.queue = this.queue.then(() => addChunk(this.id, seq, e.data)
        .then(() => putMeta({ id: this.id, ...this.meta, mediaType: this.video ? 'video' : 'audio', mimeType: this.mimeType, startedAt: this.t0, durationSec: Math.round((Date.now() - this.t0) / 1000), status: 'recording' }))
        .catch(() => { this.persisted = false; this.memChunks.push(e.data); }));
    };
    this.rec.onerror = (e) => this.onError?.(e.error || e);
    this.rec.start(4000);
    // Heartbeat so other tabs know this recording is still alive (see unsavedRecordings).
    this.heartbeat = setInterval(() => {
      if (this.persisted) putMeta({ id: this.id, ...this.meta, mediaType: this.video ? 'video' : 'audio', mimeType: this.mimeType, startedAt: this.t0, durationSec: Math.round((Date.now() - this.t0) / 1000), status: 'recording' }).catch(() => {});
    }, 10000);
  }

  get elapsedSec() { return this.t0 ? Math.round((Date.now() - this.t0) / 1000) : 0; }

  _grabPoster() {
    if (!this.canvas || this.poster) return Promise.resolve(this.poster);
    return new Promise((res) => {
      try { this.canvas.toBlob((b) => { this.poster = b || null; res(this.poster); }, 'image/jpeg', 0.82); } catch { res(null); }
    });
  }

  /** Stops and returns the finished, seekable file. The device copy stays until the upload succeeds. */
  stop() {
    return new Promise((resolve) => {
      const finish = async () => {
        clearInterval(this.heartbeat); clearTimeout(this.posterTimer);
        if (this.video && !this.poster) await this._grabPoster();
        this.stopTicker?.();
        document.removeEventListener('visibilitychange', this._wake);
        await this.queue.catch(() => {});
        const durationSec = Math.max(1, Math.round((Date.now() - this.t0) / 1000));
        let parts = this.memChunks;
        if (this.usedDevice) {
          try { parts = [...(await getChunks(this.id)), ...this.memChunks]; } catch { /* memory copy below */ }
          putMeta({ id: this.id, ...this.meta, mediaType: this.video ? 'video' : 'audio', mimeType: this.mimeType, startedAt: this.t0, durationSec, status: 'stopped' }).catch(() => {});
        }
        const raw = new Blob(parts, { type: this.mimeType });
        const blob = await fixWebmDuration(raw, durationSec * 1000);
        this.ctx.close().catch(() => {});
        for (const el of this.els.values()) el.srcObject = null;
        this.els.clear();
        resolve({ id: this.id, blob, mimeType: this.mimeType, durationSec, mediaType: this.video ? 'video' : 'audio', poster: this.poster, persisted: this.persisted });
      };
      if (!this.rec || this.rec.state === 'inactive') { finish(); return; }
      this.rec.onstop = finish;
      try { this.rec.stop(); } catch { finish(); }
    });
  }
}

/** Builds a finished file from a recording left on this device (crash recovery). */
export async function rebuildFromDevice(meta) {
  const parts = await getChunks(meta.id);
  const raw = new Blob(parts, { type: meta.mimeType });
  const durationSec = Math.max(1, meta.durationSec || 1);
  return { blob: await fixWebmDuration(raw, durationSec * 1000), durationSec };
}
