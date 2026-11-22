import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Tile from './Tile';
import { useMedia } from '../../hooks/useMedia';

const ms = (p) => p.joinedAt?.toMillis?.() ?? 0;
const STRIP_MAX = 10;

export default function VideoStage({ participants, remote, localVideo, uid, activeUid, view, onTargets, dataSaver }) {
  const narrow = useMedia('(max-width: 700px)');
  const portrait = useMedia('(orientation: portrait)');
  const [page, setPage] = useState(0);

  const list = useMemo(() => [...participants].sort((a, b) => (b.sharing ? 1 : 0) - (a.sharing ? 1 : 0) || ms(a) - ms(b) || a.id.localeCompare(b.id)), [participants]);
  const presenter = list.find((p) => p.sharing);
  const spotlight = presenter || (view === 'spotlight' && list.length > 1 ? (list.find((p) => p.id === activeUid) || list.find((p) => p.id !== uid)) : null);

  const perPage = narrow ? 4 : 9;
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  useEffect(() => { if (page >= pages) setPage(pages - 1); }, [page, pages]);

  const others = spotlight ? list.filter((p) => p.id !== spotlight.id) : [];
  const strip = others.slice(0, STRIP_MAX);
  const shown = spotlight ? [] : list.slice(page * perPage, (page + 1) * perPage);

  // Only the people on screen are streamed to this device, at a quality that fits the tile.
  const targetKey = useMemo(() => {
    const t = {};
    const q = shown.length <= 2 ? 'high' : shown.length <= 4 ? 'medium' : 'low';
    shown.forEach((p) => { t[p.id] = q; });
    if (spotlight) t[spotlight.id] = presenter ? 'low' : 'high';
    strip.forEach((p) => { t[p.id] = 'low'; });
    delete t[uid];
    return JSON.stringify(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.map((p) => p.id).join(), spotlight?.id, presenter?.id, strip.map((p) => p.id).join(), uid]);
  useEffect(() => { onTargets?.(JSON.parse(targetKey)); }, [targetKey, onTargets]);

  const tile = (p, extra = {}) => (
    <Tile key={p.id} p={p} isLocal={p.id === uid} stream={p.id === uid ? localVideo : remote[p.id]} active={activeUid === p.id} {...extra} />
  );

  if (!list.length) return <div className="stage-video center muted">Connecting…</div>;

  const saver = dataSaver ? <div className="saver-pill">Data saver on: cameras paused</div> : null;
  if (spotlight) {
    return (
      <div className="stage-video present">
        {saver}
        <div className="present-main">
          {tile(spotlight, { contain: !!presenter })}
          {presenter && <div className="present-banner">{presenter.id === uid ? 'You are presenting' : `${presenter.name} is presenting`}</div>}
        </div>
        {others.length > 0 && (
          <div className="present-strip">
            {strip.map((p) => tile(p, { compact: true }))}
            {others.length > strip.length && <div className="more-tile">+{others.length - strip.length} more<br /><small>see Participants</small></div>}
          </div>
        )}
      </div>
    );
  }

  const n = shown.length;
  const cols = n <= 1 ? 1 : n === 2 ? (portrait ? 1 : 2) : narrow ? 2 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  return (
    <div className="stage-video">
      {saver}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {shown.map((p) => tile(p))}
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="icon-btn dark" onClick={() => setPage((x) => Math.max(0, x - 1))} disabled={page === 0} aria-label="Previous participants"><ChevronLeft size={18} /></button>
          <span>{page + 1} / {pages}</span>
          <button className="icon-btn dark" onClick={() => setPage((x) => Math.min(pages - 1, x + 1))} disabled={page === pages - 1} aria-label="Next participants"><ChevronRight size={18} /></button>
        </div>
      )}
    </div>
  );
}
