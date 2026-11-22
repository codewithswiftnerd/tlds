import { initials } from '../../utils/format';

const TONES = ['#145C3A', '#2F6F57', '#3B7A57', '#5B7F2B', '#2A6B6B', '#6B5B2A', '#7A4B3B'];
const tone = (s = '') => TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

export default function Avatar({ name, size = 36 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: tone(name), fontSize: Math.max(11, size * 0.38) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
