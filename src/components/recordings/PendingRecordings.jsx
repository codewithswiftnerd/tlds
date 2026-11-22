import { useCallback, useEffect, useState } from 'react';
import { CloudUpload, Download, Trash2 } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { unsavedRecordings, removeRecording } from '../../services/recordingStore';
import { rebuildFromDevice } from '../../services/recorder';
import { fileNameFor, saveToDevice, uploadRecording } from '../../services/recordings';
import { fmtDateTime, fmtDuration } from '../../utils/format';

/**
 * Recordings that were made on this device but never reached the library (closed tab, crash, failed upload).
 * Shown at the top of the app until the recorder uploads, downloads or discards them.
 */
export default function PendingRecordings({ profile }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState({}); // id -> progress | 'working'

  const load = useCallback(() => { unsavedRecordings(profile.uid).then(setItems); }, [profile.uid]);
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i); }, [load]);

  if (!items.length) return null;

  const upload = async (m) => {
    setBusy((b) => ({ ...b, [m.id]: 0 }));
    try {
      const { blob, durationSec } = await rebuildFromDevice(m);
      if (!blob.size) { await removeRecording(m.id); toast('That recording was empty and has been cleared.', 'info'); load(); return; }
      await uploadRecording({ deviceId: m.id, blob, mimeType: m.mimeType, durationSec, mediaType: m.mediaType || 'audio', poster: null, meta: m, profile },
        (p) => setBusy((b) => ({ ...b, [m.id]: p })));
      toast('Recording uploaded to the library.', 'success');
    } catch (e) {
      console.error(e);
      toast(e?.code === 'storage/unauthorized' ? 'Upload refused: your account is not allowed to add recordings for this meeting.' : 'Upload failed. Check your connection and try again.', 'error');
    }
    setBusy((b) => { const n = { ...b }; delete n[m.id]; return n; });
    load();
  };
  const download = async (m) => {
    const { blob } = await rebuildFromDevice(m);
    saveToDevice(blob, fileNameFor(m.meetingTitle, m.mimeType, m.startedAt));
  };
  const discard = async (m) => {
    if (!window.confirm(`Delete the unsaved recording of "${m.meetingTitle}" from this device? This cannot be undone.`)) return;
    await removeRecording(m.id).catch(() => {});
    load();
  };

  return (
    <section className="pending-recs" aria-label="Unsaved recordings">
      {items.map((m) => {
        const b = busy[m.id];
        return (
          <div key={m.id} className="pending-rec">
            <div className="grow">
              <strong>Unsaved recording: {m.meetingTitle || 'Meeting'}</strong>
              <p className="small muted">{fmtDateTime(new Date(m.startedAt))} · {fmtDuration(m.durationSec || 0)} · {m.mediaType === 'video' ? 'video' : 'audio'} · kept on this device</p>
              {b !== undefined && <div className="progress"><i style={{ width: `${b}%` }} /></div>}
            </div>
            <div className="row gap wrap">
              <button className="btn primary sm" onClick={() => upload(m)} disabled={b !== undefined}><CloudUpload size={14} /> {b !== undefined ? `Uploading ${b}%` : 'Upload to library'}</button>
              <button className="btn sm" onClick={() => download(m)} disabled={b !== undefined}><Download size={14} /> Save to device</button>
              <button className="btn ghost sm danger-text" onClick={() => discard(m)} disabled={b !== undefined} aria-label="Discard recording"><Trash2 size={14} /></button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
