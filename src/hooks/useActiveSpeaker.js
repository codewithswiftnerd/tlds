import { useEffect, useRef, useState } from 'react';

/** Picks the loudest participant from { uid: MediaStream } using Web Audio analysers. */
export function useActiveSpeaker(streams) {
  const [active, setActive] = useState(null);
  const ref = useRef({ ctx: null, nodes: new Map() });

  useEffect(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const s = ref.current;
    if (!s.ctx) s.ctx = new AC();
    for (const [uid, n] of s.nodes) {
      if (streams[uid] !== n.stream) { n.src.disconnect(); s.nodes.delete(uid); }
    }
    for (const [uid, stream] of Object.entries(streams)) {
      if (s.nodes.has(uid) || !stream.getAudioTracks().length) continue;
      const src = s.ctx.createMediaStreamSource(stream);
      const an = s.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      s.nodes.set(uid, { stream, src, an, buf: new Uint8Array(an.fftSize) });
    }
  }, [streams]);

  useEffect(() => {
    let last = 0;
    const id = setInterval(() => {
      const s = ref.current;
      if (s.ctx?.state === 'suspended') s.ctx.resume().catch(() => {});
      let best = null, max = 0.02;
      s.nodes.forEach((n, uid) => {
        n.an.getByteTimeDomainData(n.buf);
        let sum = 0;
        for (const v of n.buf) { const d = (v - 128) / 128; sum += d * d; }
        const rms = Math.sqrt(sum / n.buf.length);
        if (rms > max) { max = rms; best = uid; }
      });
      const now = Date.now();
      if (best) { last = now; setActive(best); } else if (now - last > 1500) setActive(null);
    }, 250);
    return () => {
      clearInterval(id);
      ref.current.nodes.forEach((n) => n.src.disconnect());
      ref.current.nodes.clear();
      ref.current.ctx?.close().catch(() => {});
      ref.current.ctx = null;
    };
  }, []);

  return active;
}
