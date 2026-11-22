import { ConnectionQuality, DisconnectReason, Room, RoomEvent, Track, VideoPresets, VideoQuality } from 'livekit-client';
import { auth } from './firebase';

/** Calls the Netlify functions (netlify/functions) with the member's Firebase sign-in token. */
async function api(name, body) {
  const idToken = await auth.currentUser.getIdToken();
  let res;
  try {
    res = await fetch(`/api/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify(body) });
  } catch {
    const e = new Error('Could not reach the call service. Check your internet connection.');
    e.code = 'network'; throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || (res.status === 404
      ? 'The call service was not found on this site (the Netlify functions are not deployed).'
      : `The call service returned an error (${res.status}).`));
    e.code = data.code; e.status = res.status;
    throw e;
  }
  return data;
}
/** Short-lived join pass; the server checks the meeting, removals and capacity. */
export const fetchRoomToken = (meetingId) => api('getRoomToken', { meetingId }); // { token, url }
/** Server-side enforcement: remove a person, mute their microphone at the server, or close the room. */
export const roomAdmin = (meetingId, action, uid) => api('roomAdmin', { meetingId, action, uid });

export const insecureContext = () => !window.isSecureContext || !navigator.mediaDevices;

export function mediaErrorMessage(kind, e) {
  if (insecureContext()) return `Your ${kind} cannot be used on this address. Open the app over https (the deployed site), not a plain http link or an IP address.`;
  switch (e?.name) {
    case 'NotAllowedError': return `Access to your ${kind} was blocked. Allow it in your browser's site settings and try again.`;
    case 'NotFoundError': case 'OverconstrainedError': return `No ${kind} was found on this device.`;
    case 'NotReadableError': return `Your ${kind} is in use by another app. Close the other app and try again.`;
    default: return `Could not start your ${kind}.`;
  }
}

/** Used only by the pre-join camera preview. */
export async function getTracks({ mic, cam, camId }) {
  const errors = [];
  let audio = null, video = null;
  if (mic) {
    try { audio = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0]; }
    catch (e) { errors.push(mediaErrorMessage('microphone', e)); }
  }
  if (cam) {
    const v = { width: { ideal: 1280 }, height: { ideal: 720 }, ...(camId ? { deviceId: { exact: camId } } : { facingMode: 'user' }) };
    try { video = (await navigator.mediaDevices.getUserMedia({ video: v })).getVideoTracks()[0]; }
    catch (e) { errors.push(mediaErrorMessage('camera', e)); }
  }
  return { audio, video, errors };
}

/** Lists microphones, cameras and speakers. Labels only appear after the browser has granted media access once. */
export async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const pick = (kind) => all.filter((d) => d.kind === kind && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === 'audioinput' ? 'Microphone' : kind === 'videoinput' ? 'Camera' : 'Speaker'} ${i + 1}` }));
    return { mics: pick('audioinput'), cams: pick('videoinput'), speakers: pick('audiooutput') };
  } catch { return { mics: [], cams: [], speakers: [] }; }
}
export const canChooseSpeaker = () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

const QUALITY = { high: VideoQuality.HIGH, medium: VideoQuality.MEDIUM, low: VideoQuality.LOW };
const streamCache = new WeakMap();
const wrap = (t) => { if (!t) return null; if (!streamCache.has(t)) streamCache.set(t, new MediaStream([t])); return streamCache.get(t); };
const audioKey = (pub, id) => (pub.source === Track.Source.ScreenShareAudio ? `${id}:screen` : id);
const QUALITY_NAME = { [ConnectionQuality.Excellent]: 'good', [ConnectionQuality.Good]: 'good', [ConnectionQuality.Poor]: 'poor', [ConnectionQuality.Lost]: 'lost' };
const enc = new TextEncoder(), dec = new TextDecoder();

/**
 * Media transport on a LiveKit SFU (scales to large meetings).
 * Every participant uploads ONE stream; the server forwards it. To keep 100-person rooms light,
 * all audio is subscribed but camera video is subscribed only for the tiles on screen, at a
 * quality that matches the tile size. Screen shares are always subscribed.
 */
export class RoomClient {
  constructor(h) {
    this.h = h;
    this.room = null;
    this.targets = {};
    this.cam = {}; this.scr = {}; this.aud = {};
  }

  async connect({ url, token }) {
    const room = new Room({
      adaptiveStream: false, // we choose the quality ourselves in setTargets
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h540 },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      publishDefaults: { simulcast: true, dtx: true, red: true },
      disconnectOnPageLeave: true,
    });
    this.room = room;
    const h = this.h;
    room
      .on(RoomEvent.TrackPublished, (pub, p) => this._onPub(pub, p))
      .on(RoomEvent.TrackSubscribed, (track, pub, p) => this._onSub(track, pub, p))
      .on(RoomEvent.TrackUnsubscribed, (track, pub, p) => this._onUnsub(pub, p))
      .on(RoomEvent.TrackUnpublished, (pub, p) => this._onUnsub(pub, p))
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        const id = p.identity;
        delete this.cam[id]; delete this.scr[id]; delete this.aud[id]; delete this.aud[`${id}:screen`];
        this._emit(); h.onGone?.(id);
      })
      .on(RoomEvent.ActiveSpeakersChanged, (sp) => h.onActive?.(sp[0]?.identity || null))
      .on(RoomEvent.LocalTrackPublished, () => h.onLocal?.())
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare) h.onLocalScreenEnded?.();
        h.onLocal?.();
      })
      .on(RoomEvent.TrackMuted, (pub, p) => {
        // The server (a moderator's "hard mute") muted our microphone.
        if (p === room.localParticipant && pub.source === Track.Source.Microphone) h.onServerMuted?.();
        h.onLocal?.();
      })
      .on(RoomEvent.TrackUnmuted, () => h.onLocal?.())
      .on(RoomEvent.ConnectionQualityChanged, (q, p) => { if (p === room.localParticipant) h.onQuality?.(QUALITY_NAME[q] || 'good'); })
      .on(RoomEvent.DataReceived, (payload, p) => {
        try { const msg = JSON.parse(dec.decode(payload)); if (p?.identity) h.onData?.(msg, p.identity, p.name); } catch { /* not ours */ }
      })
      .on(RoomEvent.MediaDevicesError, (e) => h.onDeviceError?.(e))
      .on(RoomEvent.Reconnecting, () => h.onLink?.('reconnecting'))
      .on(RoomEvent.Reconnected, () => h.onLink?.('connected'))
      .on(RoomEvent.Disconnected, (reason) => {
        h.onDisconnected?.(
          reason === DisconnectReason.DUPLICATE_IDENTITY ? 'duplicate'
            : reason === DisconnectReason.PARTICIPANT_REMOVED ? 'removed'
              : reason === DisconnectReason.ROOM_DELETED ? 'ended'
                : reason === DisconnectReason.CLIENT_INITIATED ? 'self' : 'dropped',
        );
      });
    await room.connect(url, token, { autoSubscribe: false });
    room.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => this._onPub(pub, p)));
  }

  _emit() {
    const video = {};
    new Set([...Object.keys(this.cam), ...Object.keys(this.scr)]).forEach((id) => { video[id] = this.scr[id] || this.cam[id]; });
    this.h.onVideo?.(video);
    this.h.onAudio?.({ ...this.aud });
    this.h.onSources?.({ cam: { ...this.cam }, screen: { ...this.scr } });
  }

  _onPub(pub, p) {
    if (pub.kind === Track.Kind.Audio || pub.source === Track.Source.ScreenShare) { if (!pub.isSubscribed) pub.setSubscribed(true); return; }
    this._applyTarget(pub, p.identity);
  }
  _applyTarget(pub, id) {
    const q = this.targets[id];
    try {
      if (q) { if (!pub.isSubscribed) pub.setSubscribed(true); pub.setVideoQuality(QUALITY[q]); }
      else if (pub.isSubscribed) pub.setSubscribed(false);
    } catch { /* publication not ready yet; applied again on subscribe */ }
  }

  /** map: { uid: 'high' | 'medium' | 'low' } for the camera feeds this device needs right now. */
  setTargets(map) {
    this.targets = map;
    this.room?.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => {
      if (pub.kind === Track.Kind.Video && pub.source !== Track.Source.ScreenShare) this._applyTarget(pub, p.identity);
    }));
  }

  _onSub(track, pub, p) {
    const id = p.identity;
    const ms = track.mediaStreamTrack;
    if (track.kind === Track.Kind.Audio) this.aud[audioKey(pub, id)] = wrap(ms);
    else if (pub.source === Track.Source.ScreenShare) { this.scr[id] = wrap(ms); try { pub.setVideoQuality(VideoQuality.HIGH); } catch { /* ok */ } }
    else { this.cam[id] = wrap(ms); this._applyTarget(pub, id); }
    this._emit();
  }
  _onUnsub(pub, p) {
    const id = p.identity;
    if (pub.kind === Track.Kind.Audio) delete this.aud[audioKey(pub, id)];
    else if (pub.source === Track.Source.ScreenShare) delete this.scr[id];
    else delete this.cam[id];
    this._emit();
  }

  // Local controls. These throw the browser's own error (permission denied, no device) so the UI can explain it.
  setMic(on, deviceId) { return this.room.localParticipant.setMicrophoneEnabled(on, deviceId ? { deviceId } : undefined); }
  setCam(on, deviceId) { return this.room.localParticipant.setCameraEnabled(on, deviceId ? { deviceId } : undefined); }
  setScreen(on) {
    return this.room.localParticipant.setScreenShareEnabled(on, on ? { audio: true, selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'include' } : undefined);
  }
  switchDevice(kind, deviceId) { return this.room.switchActiveDevice(kind, deviceId); }
  /** Phones: swap between the front and back camera. */
  async flipCamera(facing) {
    const t = this.room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (!t) return;
    await t.restartTrack({ facingMode: facing, resolution: VideoPresets.h540.resolution });
  }
  /** Small JSON messages to everyone (reactions). Not stored anywhere. */
  send(msg) {
    return this.room?.localParticipant.publishData(enc.encode(JSON.stringify(msg)), { reliable: false });
  }

  _local(source, onlyLive) {
    const pub = this.room?.localParticipant.getTrackPublication(source);
    const t = pub?.track?.mediaStreamTrack;
    return t && (!onlyLive || !pub.isMuted) ? wrap(t) : null;
  }
  localVideoStream() { return this._local(Track.Source.ScreenShare, true) || this._local(Track.Source.Camera, true); }
  localCamStream() { return this._local(Track.Source.Camera, true); }
  localScreenStream() { return this._local(Track.Source.ScreenShare, true); }
  localMicStream() { return this._local(Track.Source.Microphone, false); }
  localScreenAudioStream() { return this._local(Track.Source.ScreenShareAudio, false); }

  disconnect() { const r = this.room; this.room = null; r?.disconnect(); }
}
