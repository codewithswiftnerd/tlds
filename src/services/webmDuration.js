/**
 * Browsers' MediaRecorder writes WebM files without a duration, so players show "0:00 / --:--" and seeking is
 * slow or broken. This writes the real duration into the file header (Segment > Info > Duration).
 * Pure function: returns a new Blob, or the original one untouched if anything looks unfamiliar.
 */
const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966, Cluster: 0x1f43b675, TimecodeScale: 0x2ad7b1, Duration: 0x4489 };
const HEAD_BYTES = 1024 * 1024;

function vint(bytes, pos, keepMarker) {
  const first = bytes[pos];
  if (first === undefined || first === 0) return null;
  let len = 1, mask = 0x80;
  while (!(first & mask)) { len += 1; mask >>= 1; }
  if (pos + len > bytes.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  for (let i = 1; i < len; i += 1) value = value * 256 + bytes[pos + i];
  const unknown = !keepMarker && value === 2 ** (7 * len) - 1;
  return { len, value, unknown };
}

function element(bytes, pos) {
  const id = vint(bytes, pos, true);
  if (!id) return null;
  const size = vint(bytes, pos + id.len, false);
  if (!size) return null;
  const dataStart = pos + id.len + size.len;
  return { id: id.value, start: pos, dataStart, size: size.unknown ? null : size.value, end: size.unknown ? null : dataStart + size.value };
}

function sizeVint8(n) {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let v = n;
  for (let i = 7; i >= 1; i -= 1) { out[i] = v % 256; v = Math.floor(v / 256); }
  return out;
}

export async function fixWebmDuration(blob, durationMs) {
  try {
    if (!blob || !blob.size || !(durationMs > 0) || !/webm/i.test(blob.type || '')) return blob;
    const bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, HEAD_BYTES)).arrayBuffer());
    const ebml = element(bytes, 0);
    if (!ebml || ebml.id !== ID.EBML || ebml.end == null) return blob;
    const seg = element(bytes, ebml.end);
    if (!seg || seg.id !== ID.Segment) return blob;

    let p = seg.dataStart, info = null;
    while (p < bytes.length) {
      const el = element(bytes, p);
      if (!el) return blob;
      if (el.id === ID.SeekHead) return blob;   // positions would shift; leave the file alone
      if (el.id === ID.Cluster) return blob;    // no Info before media data
      if (el.id === ID.Info) { info = el; break; }
      if (el.end == null) return blob;
      p = el.end;
    }
    if (!info || info.end == null || info.end > bytes.length) return blob;

    let scale = 1e6, durationEl = null;
    for (let q = info.dataStart; q < info.end;) {
      const el = element(bytes, q);
      if (!el || el.end == null || el.end > info.end) return blob;
      if (el.id === ID.TimecodeScale) { let v = 0; for (let i = el.dataStart; i < el.end; i += 1) v = v * 256 + bytes[i]; if (v > 0) scale = v; }
      if (el.id === ID.Duration) durationEl = el;
      q = el.end;
    }
    const ticks = (durationMs * 1e6) / scale;

    if (durationEl) {
      const head = bytes.slice(0, info.end);
      const view = new DataView(head.buffer);
      if (durationEl.size === 8) view.setFloat64(durationEl.dataStart, ticks);
      else if (durationEl.size === 4) view.setFloat32(durationEl.dataStart, ticks);
      else return blob;
      return new Blob([head, blob.slice(info.end)], { type: blob.type });
    }

    const children = bytes.slice(info.dataStart, info.end);
    const dur = new Uint8Array(11);
    dur.set([0x44, 0x89, 0x88]);
    new DataView(dur.buffer).setFloat64(3, ticks);
    const newInfo = new Uint8Array(4 + 8 + children.length + dur.length);
    newInfo.set([0x15, 0x49, 0xa9, 0x66], 0);
    newInfo.set(sizeVint8(children.length + dur.length), 4);
    newInfo.set(children, 12);
    newInfo.set(dur, 12 + children.length);
    return new Blob([bytes.slice(0, info.start), newInfo, blob.slice(info.end)], { type: blob.type });
  } catch {
    return blob;
  }
}
