import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';

function Sink({ id, stream, sinkId, reg, onBlocked }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.srcObject = stream;
    reg(id, el);
    el.play?.().catch((e) => { if (e.name === 'NotAllowedError') onBlocked(); });
    return () => { reg(id, null); el.srcObject = null; };
  }, [id, stream, reg, onBlocked]);
  useEffect(() => {
    const el = ref.current;
    if (el?.setSinkId && sinkId !== undefined) el.setSinkId(sinkId || '').catch(() => {});
  }, [sinkId]);
  return <audio ref={ref} autoPlay playsInline />;
}

/**
 * Always-mounted audio playback for every remote participant, independent of which tiles are visible.
 * Some browsers (iPhone Safari especially) refuse to start sound without a tap: we detect that and ask for one.
 */
export default function AudioSinks({ remote, sinkId }) {
  const els = useRef(new Map());
  const [blocked, setBlocked] = useState(false);
  const reg = useCallback((id, el) => { if (el) els.current.set(id, el); else els.current.delete(id); }, []);
  const onBlocked = useCallback(() => setBlocked(true), []);

  const resume = useCallback(async () => {
    const results = await Promise.allSettled([...els.current.values()].map((el) => el.play()));
    setBlocked(results.some((r) => r.status === 'rejected'));
  }, []);

  useEffect(() => {
    if (!blocked) return undefined;
    const h = () => resume();
    window.addEventListener('pointerdown', h, { once: true });
    return () => window.removeEventListener('pointerdown', h);
  }, [blocked, resume]);

  return (
    <>
      {Object.entries(remote).map(([id, s]) => <Sink key={id} id={id} stream={s} sinkId={sinkId} reg={reg} onBlocked={onBlocked} />)}
      {blocked && <button className="audio-banner" onClick={resume}><Volume2 size={16} /> Tap to turn on sound</button>}
    </>
  );
}
