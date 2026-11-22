import { useState } from 'react';
import { Pause, Play, Repeat, RotateCcw, RotateCw, Square, Trash2, Volume2, VolumeX } from 'lucide-react';
import { PanelShell } from './Panels';
import { useQuery } from '../../hooks/useQuery';
import { useToast } from '../../context/ToastContext';
import { addTrack, checkAudioUrl, deleteTrack, libraryQuery } from '../../services/music';

function AddTrack({ profile }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState('');

  const pick = (e) => {
    const f = e.target.files[0];
    if (f && !f.type.startsWith('audio/')) { setErr('Please choose an audio file (mp3, m4a, wav...).'); return; }
    if (f && f.size > 50 * 1024 * 1024) { setErr('That file is larger than 50 MB.'); return; }
    setErr(''); setFile(f || null);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!file && !/^https:\/\//i.test(url.trim())) { setErr('Choose a file, or paste a link that starts with https://'); return; }
    setProgress(0);
    try {
      if (!file) await checkAudioUrl(url.trim());
      await addTrack(profile, { title: title.trim(), file, url: url.trim() }, setProgress);
      setTitle(''); setUrl(''); setFile(null); setOpen(false); toast('Added to the music library.', 'success');
    } catch (x) {
      console.error(x);
      setErr(file ? 'Could not upload the file.' : 'That link is not a direct audio file. YouTube, Spotify and other song pages will not work; use a link that ends in .mp3 or similar.');
    }
    setProgress(null);
  };

  if (!open) return <button className="btn-dark" onClick={() => setOpen(true)}>+ Add a song</button>;
  return (
    <form className="music-add" onSubmit={submit}>
      <input required placeholder="Song title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} aria-label="Song title" />
      <label className="muted small">Upload a file<input type="file" accept="audio/*" onChange={pick} /></label>
      <span className="muted small center-text">or</span>
      <input placeholder="Paste a direct audio link (https://…mp3)" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!file} aria-label="Audio link" />
      {err && <p className="error-note dark" role="alert">{err}</p>}
      {progress !== null && file && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}
      <div className="row gap"><button className="btn primary" disabled={progress !== null}>{progress !== null ? 'Adding…' : 'Add'}</button><button type="button" className="btn-dark" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

export default function MusicPanel({ music, canModerate, canAdd, profile, isAdmin, onClose }) {
  const toast = useToast();
  const lib = useQuery(libraryQuery, []);
  const { state, controls } = music;
  const playing = !!state?.playing;
  const act = (fn) => async () => { try { await fn(); } catch { toast('Could not change the music.', 'error'); } };

  return (
    <PanelShell title="Music" onClose={onClose}>
      <div className="music-now">
        <strong>{state?.url ? state.title : 'Nothing playing'}</strong>
        {state?.url && <small>{playing ? 'Playing for everyone' : 'Paused'}{music.ducked ? ' · lowered while someone speaks' : ''}</small>}
        {canModerate && state?.url && (
          <div className="row gap wrap">
            <button className="icon-btn dark" onClick={act(() => controls.seek(-10))} aria-label="Back 10 seconds"><RotateCcw size={18} /></button>
            <button className="icon-btn dark" onClick={act(playing ? controls.pause : controls.resume)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
            <button className="icon-btn dark" onClick={act(() => controls.seek(10))} aria-label="Forward 10 seconds"><RotateCw size={18} /></button>
            <button className="icon-btn dark" onClick={act(controls.stop)} aria-label="Stop music"><Square size={18} /></button>
            <button className={`icon-btn dark ${state.loop ? 'active' : ''}`} onClick={act(controls.toggleLoop)} aria-label="Repeat" aria-pressed={!!state.loop}><Repeat size={18} /></button>
          </div>
        )}
        <div className="row gap">
          <button className="icon-btn dark" onClick={() => music.setMuted(!music.muted)} aria-label={music.muted ? 'Unmute music for me' : 'Mute music for me'}>{music.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
          <input type="range" min="0.05" max="1" step="0.05" value={music.vol} onChange={(e) => music.setVol(Number(e.target.value))} aria-label="Music volume (only for you)" className="grow" />
        </div>
        <small className="muted">Volume and mute only change what you hear. {canModerate ? 'Use headphones so the music does not feed back into your microphone.' : ''}</small>
      </div>

      {canModerate ? (
        <>
          <div className="pl2">
            {lib.loading && <p className="muted">Loading…</p>}
            {!lib.loading && !lib.data.length && <p className="muted">No songs yet. Add one below.</p>}
            <ul>
              {lib.data.map((t) => (
                <li key={t.id}>
                  <button className="music-track" onClick={act(() => controls.play(t))} aria-label={`Play ${t.title}`}>
                    <Play size={14} /><span>{t.title}</span><small>{t.source === 'upload' ? 'uploaded' : 'link'}</small>
                  </button>
                  {(isAdmin || t.addedBy === profile.uid) && <button className="icon-btn dark sm danger" aria-label={`Delete ${t.title}`} onClick={() => window.confirm(`Delete "${t.title}" from the library?`) && act(() => deleteTrack(t))()}><Trash2 size={14} /></button>}
                </li>
              ))}
            </ul>
          </div>
          {canAdd && <div className="music-foot"><AddTrack profile={profile} /></div>}
        </>
      ) : <p className="muted small music-note">The host chooses the music. It lowers by itself when someone speaks.</p>}
    </PanelShell>
  );
}
