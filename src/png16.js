/**
 * Minimal PNG decoder that preserves 16-bit greyscale precision.
 *
 * The browser will happily decode a 16-bit PNG through <img>, but every path
 * back to JS (canvas.getImageData, texImage2D from an HTMLImageElement) clamps
 * to 8 bits per channel. For a heightmap that turns ~1 cm of vertical precision
 * into ~3 m of staircase. So we inflate and unfilter the PNG ourselves and hand
 * back the real Uint16Array.
 *
 * Inflation uses the platform DecompressionStream, so there is no dependency.
 */

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');          // PNG IDAT is zlib-wrapped
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function unfilter(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = pos;
    pos += stride;
    const o = y * stride;
    const p = o - stride;                                  // previous output row

    switch (filter) {
      case 0:                                              // None
        out.set(raw.subarray(line, line + stride), o);
        break;
      case 1:                                              // Sub
        for (let i = 0; i < bytesPerPixel; i++) out[o + i] = raw[line + i];
        for (let i = bytesPerPixel; i < stride; i++)
          out[o + i] = (raw[line + i] + out[o + i - bytesPerPixel]) & 0xff;
        break;
      case 2:                                              // Up  (what we encode)
        if (y === 0) out.set(raw.subarray(line, line + stride), o);
        else for (let i = 0; i < stride; i++) out[o + i] = (raw[line + i] + out[p + i]) & 0xff;
        break;
      case 3:                                              // Average
        for (let i = 0; i < stride; i++) {
          const a = i >= bytesPerPixel ? out[o + i - bytesPerPixel] : 0;
          const b = y > 0 ? out[p + i] : 0;
          out[o + i] = (raw[line + i] + ((a + b) >> 1)) & 0xff;
        }
        break;
      case 4:                                              // Paeth
        for (let i = 0; i < stride; i++) {
          const a = i >= bytesPerPixel ? out[o + i - bytesPerPixel] : 0;
          const b = y > 0 ? out[p + i] : 0;
          const c = (y > 0 && i >= bytesPerPixel) ? out[p + i - bytesPerPixel] : 0;
          const q = a + b - c;
          const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
          const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          out[o + i] = (raw[line + i] + pred) & 0xff;
        }
        break;
      default:
        throw new Error('PNG: unknown filter type ' + filter + ' on row ' + y);
    }
  }
  return out;
}

/** @returns {Promise<{width:number, height:number, data:Uint16Array}>} */
export async function loadPNG16(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PNG fetch failed ${res.status} for ${url}`);

  let bytes;
  const total = +res.headers.get('content-length') || 0;
  if (onProgress && res.body && total) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(got / total);
    }
    bytes = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }

  for (let i = 0; i < 8; i++)
    if (bytes[i] !== SIG[i]) throw new Error('not a PNG: ' + url);

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];

  while (p < bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const data = p + 8;
    if (type === 'IHDR') {
      width = dv.getUint32(data);
      height = dv.getUint32(data + 4);
      bitDepth = bytes[data + 8];
      colorType = bytes[data + 9];
      interlace = bytes[data + 12];
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(data, data + len));
    } else if (type === 'IEND') break;
    p = data + len + 4;
  }

  if (bitDepth !== 16 || colorType !== 0)
    throw new Error(`expected 16-bit greyscale PNG, got bitDepth=${bitDepth} colorType=${colorType}`);
  if (interlace) throw new Error('interlaced PNG not supported');

  let joined;
  if (idat.length === 1) joined = idat[0];
  else {
    const n = idat.reduce((a, c) => a + c.length, 0);
    joined = new Uint8Array(n);
    let at = 0;
    for (const c of idat) { joined.set(c, at); at += c.length; }
  }

  const raw = await inflate(joined);
  const flat = unfilter(raw, width, height, 2);

  // PNG stores 16-bit samples big-endian; the platform is little-endian.
  const data = new Uint16Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 2) data[i] = (flat[j] << 8) | flat[j + 1];

  return { width, height, data };
}
