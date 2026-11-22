/** Floating reactions (🙏 🙌 ❤️ …) sent over the media connection. Nothing is stored. */
export default function Reactions({ items }) {
  if (!items.length) return null;
  return (
    <div className="reactions" aria-live="polite">
      {items.map((r) => (
        <span key={r.id} className="reaction" style={{ left: `${r.x}%` }}>
          <span className="reaction-emoji" aria-hidden="true">{r.emoji}</span>
          {r.name && <small>{r.name}</small>}
        </span>
      ))}
    </div>
  );
}
