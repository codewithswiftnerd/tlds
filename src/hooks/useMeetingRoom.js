import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocFromServer, limitToLast, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { goLive, endMeeting } from '../services/meetings';
import { fileNameFor, saveToDevice, uploadRecording } from '../services/recordings';
import { MeetingRecorder, recordingSupport } from '../services/recorder';
import { fetchRoomToken, mediaErrorMessage, RoomClient, roomAdmin } from '../services/webrtc';
import { useToast } from '../context/ToastContext';

const tabSession = (() => {
  try {
    let s = sessionStorage.getItem('tlds-session');
    if (!s) { s = Math.random().toString(36).slice(2); sessionStorage.setItem('tlds-session', s); }
    return s;
  } catch { return Math.random().toString(36).slice(2); }
})();
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem('tlds-call-prefs') || '{}'); } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem('tlds-call-prefs', JSON.stringify(p)); } catch { /* private mode */ } };
const REJOIN_DELAYS = [1500, 4000, 8000, 15000, 25000];
export const REACTIONS = ['🙏', '🙌', '❤️', '👏', '🔥', '😂'];

/**
 * Meeting-room logic. Media runs through a LiveKit SFU (see services/webrtc.js);
 * Firestore keeps roles, permissions, hands, chat and notes.
 */
export function useMeetingRoom(meetingId, user, profile) {
  const toast = useToast();
  const uid = user.uid;
  const isAdminUser = profile?.role === 'admin';
  const [meeting, setMeeting] = useState(undefined); // undefined = loading, null = not found
  const [phase, setPhase] = useState('prejoin');     // prejoin | joining | joined | rejoining | left | removed | replaced | dropped
  const [rawParticipants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [notes, setNotes] = useState({ text: '', updatedBy: null });
  const [remote, setRemote] = useState({});           // uid -> video MediaStream (screen share wins over camera)
  const [remoteAudio, setRemoteAudio] = useState({}); // uid (or uid:screen) -> audio MediaStream
  const [sources, setSources] = useState({ cam: {}, screen: {} });
  const [localVideo, setLocalVideo] = useState(null);
  const [localAudio, setLocalAudio] = useState(null);
  const [activeUid, setActiveUid] = useState(null);
  const [link, setLink] = useState('connected');
  const [quality, setQuality] = useState('good');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [recording, setRecording] = useState({ active: false, startedAt: null, video: false });
  const [upload, setUpload] = useState(null); // { progress, error }
  const [reactions, setReactions] = useState([]);
  const [prefs, setPrefsState] = useState(loadPrefs); // { micId, camId, speakerId, dataSaver }
  const [facing, setFacing] = useState('user');
  const r = useRef({ client: null, unsubs: [], joined: false, rec: null, pending: null, wake: null, stageTargets: {}, lastJoin: null, rejoinTimer: null, lastReact: 0, focus: null, focusAt: 0 });
  const meetingRef = useRef(null);
  const modRef = useRef(false);
  const wantMicRef = useRef(false);
  const offsetRef = useRef(0); // this device's clock minus the server clock (used to keep music in step)
  const serverNow = useCallback(() => Date.now() - offsetRef.current, []);
  const myRef = useMemo(() => doc(db, 'meetings', meetingId, 'participants', uid), [meetingId, uid]);
  const meetingDoc = useMemo(() => doc(db, 'meetings', meetingId), [meetingId]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const setPrefs = useCallback((patch) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n); return n; }), []);

  meetingRef.current = meeting;
  const isHost = meeting?.hostId === uid;
  const isMod = (meeting?.moderatorUids || []).includes(uid);
  const canModerate = isHost || isMod;
  modRef.current = canModerate;
  // Roles come from the meeting document, so they stay correct after a host hand-over.
  const participants = useMemo(() => rawParticipants.map((p) => ({
    ...p, isHost: p.id === meeting?.hostId, isMod: (meeting?.moderatorUids || []).includes(p.id),
  })), [rawParticipants, meeting?.hostId, meeting?.moderatorUids]);
  const me = participants.find((p) => p.id === uid);
  const hostPresent = !!meeting && participants.some((p) => p.id === meeting.hostId);
  const canClaimHost = phase === 'joined' && !!meeting && meeting.status === 'live' && !isHost && !hostPresent && participants.length > 0 && (isMod || isAdminUser);
  const recorderPresent = !!meeting?.recordingBy && (meeting.recordingBy === uid || participants.some((p) => p.id === meeting.recordingBy));
  const recordingByName = meeting?.recordingBy ? (participants.find((p) => p.id === meeting.recordingBy)?.name || '') : '';
  const participantsRef = useRef(participants);
  participantsRef.current = participants;

  useEffect(() => onSnapshot(meetingDoc,
    (s) => setMeeting(s.exists() ? { id: s.id, ...s.data() } : null),
    () => setMeeting(null)), [meetingDoc]);

  // ── Speaking permission ─────────────────────────────────────
  const mode = meeting?.speakingMode || 'moderated';
  const hasFloor = meeting?.currentSpeakerUid === uid;
  const micAllowed = canModerate || (!me?.forceMuted && (hasFloor || (!meeting?.everyoneMuted && mode === 'open')));
  const speaking = micOn && micAllowed;
  wantMicRef.current = speaking;
  const liveRef = useRef({});
  liveRef.current = { micOn, camOn };

  // Publish the microphone only while the person is actually allowed to speak.
  useEffect(() => {
    const c = r.current.client;
    if (phase !== 'joined' || !c) return;
    c.setMic(speaking, prefsRef.current.micId).catch((e) => {
      if (speaking) { toast(mediaErrorMessage('microphone', e), 'error'); setMicOn(false); }
    });
    updateDoc(myRef, { muted: !speaking }).catch(() => {});
  }, [speaking, phase, myRef, toast]);

  // Tell people when they are given (or lose) a speaking turn.
  const hadFloor = useRef(false);
  useEffect(() => {
    if (phase !== 'joined' || canModerate) { hadFloor.current = hasFloor; return; }
    if (hasFloor && !hadFloor.current) toast(micOn ? 'You have the floor. Your microphone is on.' : 'You have the floor. Unmute your microphone to speak.', 'success');
    if (!hasFloor && hadFloor.current && mode === 'moderated') toast('Your speaking turn has ended.', 'info');
    hadFloor.current = hasFloor;
  }, [hasFloor, phase, canModerate, micOn, mode, toast]);

  // Video subscriptions: what the stage shows, plus the speaker the recorder needs; none in data-saver mode.
  const applyTargets = useCallback(() => {
    const c = r.current;
    const t = prefsRef.current.dataSaver ? {} : { ...c.stageTargets };
    if (c.rec?.video && c.focus && c.focus !== uid) t[c.focus] = 'high';
    c.client?.setTargets(t);
  }, [uid]);
  const setVideoTargets = useCallback((map) => { r.current.stageTargets = map; applyTargets(); }, [applyTargets]);
  useEffect(() => { applyTargets(); }, [prefs.dataSaver, applyTargets]);

  const teardown = useCallback(() => {
    const c = r.current;
    c.joined = false;
    clearTimeout(c.rejoinTimer);
    c.unsubs.splice(0).forEach((u) => u());
    c.client?.disconnect(); c.client = null;
    c.wake?.release?.().catch(() => {}); c.wake = null;
    setRemote({}); setRemoteAudio({}); setSources({ cam: {}, screen: {} }); setLocalVideo(null); setLocalAudio(null);
    setParticipants([]); setSharing(false); setCamOn(false); setActiveUid(null); setLink('connected'); setQuality('good');
  }, []);

  // ── Recording ───────────────────────────────────────────────
  const doUpload = useCallback(async (res) => {
    r.current.pending = res;
    setUpload({ progress: 0, error: null });
    try {
      await uploadRecording({ deviceId: res.id, blob: res.blob, mimeType: res.mimeType, durationSec: res.durationSec, mediaType: res.mediaType, poster: res.poster, meta: res.meta, profile }, (p) => setUpload({ progress: p, error: null }));
      r.current.pending = null;
      setUpload(null);
      toast('Recording saved to the library.', 'success');
    } catch (e) {
      console.error(e);
      setUpload({ progress: 0, error: e?.code === 'storage/quota-exceeded' ? 'Upload failed: the storage space is full.' : 'Upload failed. The recording is safe on this device.' });
    }
  }, [profile, toast]);

  /** Stops the recorder (if this device is recording) and starts the upload in the background. */
  const stopRecording = useCallback(async ({ clearFlag = true } = {}) => {
    const rec = r.current.rec;
    if (!rec) return;
    r.current.rec = null;
    setRecording({ active: false, startedAt: null, video: false });
    if (clearFlag) updateDoc(meetingDoc, { recording: false, recordingBy: null }).catch(() => {});
    applyTargets();
    const res = await rec.stop();
    if (!res.blob.size) { toast('The recording was empty, so nothing was saved.', 'error'); return; }
    doUpload({ ...res, meta: { ...rec.meta, startedAt: rec.t0 } });
  }, [meetingDoc, applyTargets, doUpload, toast]);

  // ── Join ────────────────────────────────────────────────────
  const join = useCallback(async ({ mic, cam, takeover = false, auto = false }) => {
    const m = meetingRef.current;
    if (!m) return null;
    const c = r.current;
    if (auto && c.leaving) return null;
    c.leaving = false;
    c.lastJoin = { mic, cam };
    if (!auto) setPhase('joining');
    let created = false;
    try {
      if (m.status === 'scheduled') await goLive(m, profile);
      const existing = await getDoc(myRef);
      if (existing.exists() && !takeover && existing.data().session !== tabSession) { setPhase('prejoin'); return 'exists'; }
      if (existing.exists()) await deleteDoc(myRef);
      await setDoc(myRef, {
        uid, name: profile.name, muted: true, camOn: false, sharing: false,
        handRaised: false, forceMuted: false, session: tabSession, joinedAt: serverTimestamp(),
      });
      created = true;
      try {
        const t0 = Date.now();
        const ts = (await getDocFromServer(myRef)).data()?.joinedAt?.toMillis?.();
        if (ts) offsetRef.current = t0 - ts;
      } catch { /* music falls back to this device's clock */ }

      const { token, url } = await fetchRoomToken(meetingId);
      const client = new RoomClient({
        onVideo: setRemote, onAudio: setRemoteAudio, onSources: setSources, onActive: setActiveUid, onLink: setLink, onQuality: setQuality,
        onLocal: () => { setLocalVideo(client.localVideoStream()); setLocalAudio(client.localMicStream()); },
        onLocalScreenEnded: () => { setSharing(false); updateDoc(myRef, { sharing: false }).catch(() => {}); },
        onServerMuted: () => {
          if (wantMicRef.current) { setMicOn(false); toast('A moderator muted your microphone.', 'info'); }
        },
        onData: (msg, from, name) => {
          if (msg?.t === 'react' && REACTIONS.includes(msg.e)) addReaction(msg.e, name || '');
        },
        onDeviceError: (e) => toast(mediaErrorMessage('microphone or camera', e), 'error'),
        // A crashed client leaves a ghost entry. A moderator tidies it up once the person is really gone.
        onGone: (pid) => {
          if (!modRef.current) return;
          setTimeout(() => {
            const still = r.current.client?.room?.remoteParticipants.has(pid);
            if (!still && pid !== meetingRef.current?.hostId) deleteDoc(doc(db, 'meetings', meetingId, 'participants', pid)).catch(() => {});
          }, 20000); // long enough for a dropped phone to rejoin on its own
        },
        onDisconnected: (why) => {
          if (!c.joined || c.client !== client) return;
          if (why === 'dropped' && meetingRef.current?.status === 'live') {
            c.lastJoin = { mic: liveRef.current.micOn, cam: liveRef.current.camOn };
            teardown(); scheduleRejoin(0); return;
          }
          if (c.rec) stopRecording();
          if (why === 'ended') deleteDoc(myRef).catch(() => {});
          teardown();
          setPhase(why === 'removed' ? 'removed' : why === 'duplicate' ? 'replaced' : why === 'ended' ? 'left' : 'dropped');
        },
      });
      c.client = client;
      await client.connect({ url, token });
      if (c.leaving || c.client !== client) { client.disconnect(); return null; } // left while we were connecting
      c.joined = true;
      setMicOn(mic);
      applyTargets();
      if (cam) {
        try { await client.setCam(true, prefsRef.current.camId); setCamOn(true); updateDoc(myRef, { camOn: true }).catch(() => {}); }
        catch (e) { if (!auto) toast(mediaErrorMessage('camera', e), 'error'); }
      }

      c.unsubs.push(onSnapshot(collection(db, 'meetings', meetingId, 'participants'), (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setParticipants(list);
        if (c.joined && !list.some((p) => p.id === uid) && !snap.metadata.hasPendingWrites) {
          const kicked = (meetingRef.current?.removedUids || []).includes(uid);
          if (c.rec) stopRecording();
          teardown(); setPhase(kicked ? 'removed' : 'replaced');
        }
      }));
      c.unsubs.push(onSnapshot(query(collection(db, 'meetings', meetingId, 'chat'), orderBy('createdAt', 'asc'), limitToLast(300)),
        (s) => setMessages(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}));
      c.unsubs.push(onSnapshot(doc(db, 'meetings', meetingId, 'canvas', 'main'),
        (s) => setNotes(s.exists() ? s.data() : { text: '', updatedBy: null }), () => {}));

      try { c.wake = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
      setPhase('joined');
      if (auto) toast('Reconnected.', 'success');
      return 'ok';
    } catch (e) {
      console.error(e);
      if (created && !auto) deleteDoc(myRef).catch(() => {});
      teardown();
      if (auto) throw e;
      toast(e?.code === 'functions/resource-exhausted' ? 'This meeting is full.'
        : e?.code === 'functions/permission-denied' ? (e.message || 'You cannot join this meeting.')
          : e?.code === 'permission-denied' ? 'Could not join: the database rules block this. Publish the latest firestore.rules in Firebase.'
            : `Could not join: ${e?.message || e?.code || 'unknown error'}`, 'error');
      setPhase('prejoin');
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, myRef, profile, uid, toast, teardown, applyTargets, stopRecording]);

  // ── Automatic rejoin after a network drop ───────────────────
  const scheduleRejoin = useCallback((attempt) => {
    const c = r.current;
    setPhase('rejoining');
    if (attempt >= REJOIN_DELAYS.length) {
      if (c.rec) stopRecording();
      deleteDoc(myRef).catch(() => {});
      setPhase('dropped');
      return;
    }
    c.rejoinTimer = setTimeout(async () => {
      if (c.leaving) return;
      const m = meetingRef.current;
      if (!m || m.status !== 'live') { if (c.rec) stopRecording(); setPhase('left'); return; }
      if (!navigator.onLine) { scheduleRejoin(attempt + 1); return; }
      try { await join({ ...(c.lastJoin || { mic: false, cam: false }), takeover: true, auto: true }); }
      catch (e) {
        if (e?.code === 'functions/permission-denied' || e?.status === 403) { if (c.rec) stopRecording(); setPhase('removed'); return; }
        scheduleRejoin(attempt + 1);
      }
    }, REJOIN_DELAYS[attempt]);
  }, [join, myRef, stopRecording]);
  const rejoinNow = () => { clearTimeout(r.current.rejoinTimer); scheduleRejoin(0); };

  // Tell members up front when the meeting is moderated, so silence is not a surprise.
  const announced = useRef(false);
  useEffect(() => {
    if (phase === 'joined' && !announced.current && !canModerate && mode === 'moderated') {
      announced.current = true;
      toast('This meeting is moderated: raise your hand and the host can let you speak.', 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Host ended the meeting: everyone is released automatically.
  useEffect(() => {
    if ((phase === 'joined' || phase === 'rejoining') && meeting?.status === 'ended') {
      if (r.current.rec) stopRecording({ clearFlag: false });
      deleteDoc(myRef).catch(() => {}); teardown(); setPhase('left');
    }
  }, [meeting?.status, phase, teardown, myRef, stopRecording]);

  // Keep the screen awake; the lock is released whenever the tab is hidden, so take it again on return.
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState === 'visible' && r.current.joined && !r.current.wake) {
        try { r.current.wake = await navigator.wakeLock?.request('screen'); r.current.wake?.addEventListener?.('release', () => { r.current.wake = null; }); } catch { /* optional */ }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Warn before closing the tab while a recording is running or uploading.
  useEffect(() => {
    const busy = recording.active || (upload && !upload.error);
    if (!busy) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [recording.active, upload]);

  useEffect(() => {
    const onHide = () => { if (r.current.joined) deleteDoc(myRef).catch(() => {}); };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      r.current.leaving = true;
      if (r.current.rec) stopRecording();
      if (r.current.joined) deleteDoc(myRef).catch(() => {});
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRef, teardown]);

  // ── Controls ────────────────────────────────────────────────
  const toggleMic = () => {
    if (!micAllowed) { toast(me?.forceMuted ? 'A moderator muted you. Raise your hand to ask to speak.' : 'The host controls who can speak. Raise your hand to ask.', 'info'); return; }
    setMicOn((v) => !v);
  };

  const toggleCam = async () => {
    const c = r.current.client;
    if (!c) return;
    const next = !camOn;
    try { await c.setCam(next, prefsRef.current.camId); setCamOn(next); updateDoc(myRef, { camOn: next }).catch(() => {}); }
    catch (e) { toast(mediaErrorMessage('camera', e), 'error'); }
  };

  const flipCamera = async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    try { await r.current.client?.flipCamera(next); setFacing(next); setPrefs({ camId: '' }); }
    catch { toast('Could not switch camera.', 'error'); }
  };

  /** kind: 'audioinput' | 'videoinput' | 'audiooutput' */
  const setDevice = async (kind, id) => {
    const key = kind === 'audioinput' ? 'micId' : kind === 'videoinput' ? 'camId' : 'speakerId';
    setPrefs({ [key]: id });
    if (kind === 'audiooutput') return; // AudioSinks applies it
    try { if (r.current.client?.room) await r.current.client.switchDevice(kind, id); }
    catch (e) { toast(mediaErrorMessage(kind === 'audioinput' ? 'microphone' : 'camera', e), 'error'); }
  };
  const setDataSaver = (on) => { setPrefs({ dataSaver: on }); toast(on ? 'Data saver on: other people\'s cameras are paused for you. Screen sharing still shows.' : 'Data saver off.', 'info'); };

  const stopShare = async () => {
    try { await r.current.client?.setScreen(false); } catch { /* already stopped */ }
    setSharing(false);
    updateDoc(myRef, { sharing: false }).catch(() => {});
  };
  const startShare = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) { toast('Screen sharing is not supported on this device or browser.', 'error'); return; }
    if (participants.some((p) => p.sharing && p.id !== uid)) { toast('Someone else is presenting. Ask them to stop first.', 'info'); return; }
    try {
      await r.current.client.setScreen(true);
      setSharing(true);
      updateDoc(myRef, { sharing: true }).catch(() => {});
    } catch (e) {
      if (e.name !== 'NotAllowedError') toast('Could not start screen sharing.', 'error');
    }
  };

  const addReaction = (emoji, name) => {
    const id = Math.random().toString(36).slice(2);
    setReactions((l) => [...l.slice(-30), { id, emoji, name, x: 8 + Math.random() * 30 }]);
    setTimeout(() => setReactions((l) => l.filter((x) => x.id !== id)), 4200);
  };
  const react = (emoji) => {
    const now = Date.now();
    if (now - r.current.lastReact < 600) return;
    r.current.lastReact = now;
    addReaction(emoji, 'You');
    r.current.client?.send({ t: 'react', e: emoji })?.catch?.(() => {});
  };

  const toggleHand = () => updateDoc(myRef, me?.handRaised ? { handRaised: false, handRaisedAt: null } : { handRaised: true, handRaisedAt: serverTimestamp() }).catch(() => {});
  const sendMessage = (text) => addDoc(collection(db, 'meetings', meetingId, 'chat'), { senderId: uid, senderName: profile.name, text, createdAt: serverTimestamp() });
  const deleteMessage = (id) => deleteDoc(doc(db, 'meetings', meetingId, 'chat', id));
  const saveNotes = (text) => setDoc(doc(db, 'meetings', meetingId, 'canvas', 'main'), { text, updatedBy: uid, updatedAt: serverTimestamp() }).catch(() => {});

  // ── Host / moderator actions (also enforced by Firestore rules and the roomAdmin function) ──
  const host = {
    setForceMuted: async (pid, v) => {
      await updateDoc(doc(db, 'meetings', meetingId, 'participants', pid), { forceMuted: v });
      if (v) roomAdmin(meetingId, 'mute', pid).catch(() => {});
    },
    giveFloor: (pid) => {
      const b = writeBatch(db);
      b.update(meetingDoc, { currentSpeakerUid: pid });
      b.update(doc(db, 'meetings', meetingId, 'participants', pid), { handRaised: false, handRaisedAt: null, forceMuted: false });
      return b.commit();
    },
    lowerHand: (pid) => updateDoc(doc(db, 'meetings', meetingId, 'participants', pid), { handRaised: false, handRaisedAt: null }),
    revokeFloor: () => updateDoc(meetingDoc, { currentSpeakerUid: null }),
    muteEveryone: async () => {
      await updateDoc(meetingDoc, { everyoneMuted: true, currentSpeakerUid: null });
      roomAdmin(meetingId, 'muteAll').catch(() => {});
    },
    allowEveryone: () => updateDoc(meetingDoc, { everyoneMuted: false }),
    setMode: (m) => updateDoc(meetingDoc, { speakingMode: m }),
    setModerator: (pid, on) => updateDoc(meetingDoc, { moderatorUids: on ? arrayUnion(pid) : arrayRemove(pid) }),
    makeHost: (p) => updateDoc(meetingDoc, { hostId: p.id, hostName: p.name, moderatorUids: arrayUnion(uid) }),
    claim: () => updateDoc(meetingDoc, { hostId: uid, hostName: profile.name }),
    remove: async (pid) => {
      const b = writeBatch(db);
      b.update(meetingDoc, { removedUids: arrayUnion(pid) });
      b.delete(doc(db, 'meetings', meetingId, 'participants', pid));
      await b.commit();
      roomAdmin(meetingId, 'remove', pid).catch(() => {}); // cut the media connection server-side
    },
  };

  // Recorder audio: everyone's microphone and shared-tab sound, including this device's own.
  const recAudio = useMemo(() => {
    const c = r.current.client;
    const screenAudio = c?.localScreenAudioStream?.();
    return { ...remoteAudio, ...(localAudio ? { [uid]: localAudio } : {}), ...(screenAudio ? { [`${uid}:screen`]: screenAudio } : {}) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteAudio, localAudio, sharing, uid]);
  useEffect(() => { r.current.rec?.sync(recAudio); }, [recAudio]);

  // Recorder video: presenter's screen, else the active speaker (held for 2 s so it does not flicker).
  const sceneRef = useRef({});
  sceneRef.current = { sources, activeUid, localVideo };
  useEffect(() => {
    if (!recording.video) return undefined;
    const tick = () => {
      const c = r.current, rec = c.rec;
      if (!rec?.video) return;
      const { sources: src, activeUid: act } = sceneRef.current;
      const list = participantsRef.current;
      const presenter = list.find((p) => p.sharing);
      const now = Date.now();
      if (act && act !== c.focus && now - c.focusAt > 2000) { c.focus = act; c.focusAt = now; applyTargets(); }
      if (!c.focus || !list.some((p) => p.id === c.focus)) { c.focus = presenter?.id || list.find((p) => p.isHost)?.id || list[0]?.id || null; c.focusAt = now; applyTargets(); }
      const fp = list.find((p) => p.id === c.focus);
      const camStream = fp?.camOn ? (fp.id === uid ? c.client?.localCamStream() : src.cam[fp.id]) : null;
      const scr = presenter ? (presenter.id === uid ? c.client?.localScreenStream() : src.screen[presenter.id]) : null;
      rec.setScene({ title: meetingRef.current?.title || '', screen: scr ? { stream: scr, name: presenter.name } : null, speaker: fp ? { stream: camStream || null, name: fp.name } : null });
    };
    tick();
    const i = setInterval(tick, 700);
    return () => clearInterval(i);
  }, [recording.video, uid, applyTargets]);

  const support = useMemo(() => recordingSupport(), []);
  const startRecording = async ({ video = false } = {}) => {
    if (!canModerate || r.current.rec) return;
    if (meeting?.recording && recorderPresent && meeting.recordingBy !== uid) { toast(`${recordingByName || 'Someone'} is already recording this meeting.`, 'info'); return; }
    if (!(video ? support.video : support.audio)) { toast(video ? 'Video recording is not supported in this browser. Try audio only, or use Chrome or Edge on a computer.' : 'Recording is not supported in this browser.', 'error'); return; }
    const m = meetingRef.current;
    const rec = new MeetingRecorder({ video, meta: { meetingId, meetingTitle: m.title, description: m.description || '', hostName: m.hostName || profile.name, createdBy: uid } });
    rec.onError = () => { toast('The recording stopped because of a browser error. What was recorded so far is being saved.', 'error'); stopRecording(); };
    rec.sync(recAudio);
    try { await rec.start(); } catch { toast('Could not start recording.', 'error'); return; }
    r.current.rec = rec;
    r.current.focus = null;
    setRecording({ active: true, startedAt: Date.now(), video });
    updateDoc(meetingDoc, { recording: true, recordingBy: uid, recordingStartedAt: serverTimestamp() }).catch(() => {});
    toast(video ? 'Recording video and audio on this device. Keep this tab open.' : 'Recording audio on this device. Keep this tab open.', 'success');
  };

  const retryUpload = () => { const p = r.current.pending; if (p) doUpload(p); };
  const saveUploadToDevice = () => { const p = r.current.pending; if (p) saveToDevice(p.blob, fileNameFor(p.meta?.meetingTitle, p.mimeType)); };

  // ── Leave / end ─────────────────────────────────────────────
  const leave = async ({ end = false } = {}) => {
    const m = meetingRef.current;
    r.current.leaving = true;
    clearTimeout(r.current.rejoinTimer);
    if (r.current.rec) stopRecording();
    r.current.joined = false;
    if (end && isHost) {
      try { await endMeeting(meetingId); roomAdmin(meetingId, 'end').catch(() => {}); }
      catch { toast('Could not end the meeting.', 'error'); }
    } else if (isHost && m?.status === 'live') {
      const others = participants.filter((p) => p.id !== uid);
      const successor = others.filter((p) => p.isMod).sort((a, b) => (a.joinedAt?.toMillis?.() ?? 0) - (b.joinedAt?.toMillis?.() ?? 0))[0];
      if (successor) {
        await updateDoc(meetingDoc, { hostId: successor.id, hostName: successor.name }).catch(() => {});
      } else if (!others.length) {
        // Last one out: close the meeting so it does not stay "live" forever.
        await endMeeting(meetingId).catch(() => {});
        roomAdmin(meetingId, 'end').catch(() => {});
      }
    }
    await deleteDoc(myRef).catch(() => {});
    teardown();
    setPhase('left');
  };

  return {
    meeting, phase, participants, me, isHost, isMod, canModerate, messages, notes, hostPresent, canClaimHost,
    remote, remoteAudio, localVideo, activeUid, link, quality, serverNow, reactions,
    micOn: speaking, micAllowed, micPublished: !!localAudio, camOn, sharing, recording, upload, mode, hasFloor,
    recorderPresent, recordingByName, recordingSupport: support, prefs, facing,
    join, rejoinNow, toggleMic, toggleCam, flipCamera, setDevice, setDataSaver, startShare, stopShare, toggleHand, react,
    sendMessage, deleteMessage, saveNotes, setVideoTargets,
    host, startRecording, stopRecording, retryUpload, saveUploadToDevice, leave,
  };
}
