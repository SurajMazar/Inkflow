/** PNG chunk utilities: iTXt writer/reader used to embed the scene in exported PNGs. */

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
export const SCENE_KEYWORD = 'inkflow';

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = table[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface PngChunk {
  type: string;
  data: Uint8Array;
  /** Byte offset of the chunk (length field) in the file. */
  offset: number;
}

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
}

/** Parses all chunks (throws on a truncated or malformed file). CRCs are verified. */
export function readPngChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error('Not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let pos = PNG_SIGNATURE.length;
  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos);
    const end = pos + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG chunk');
    const type = String.fromCharCode(
      bytes[pos + 4]!,
      bytes[pos + 5]!,
      bytes[pos + 6]!,
      bytes[pos + 7]!,
    );
    const crc = view.getUint32(pos + 8 + length);
    if (crc32(bytes, pos + 4, pos + 8 + length) !== crc)
      throw new Error(`Bad CRC in ${type} chunk`);
    chunks.push({ type, data: bytes.subarray(pos + 8, pos + 8 + length), offset: pos });
    pos = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

export function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('Invalid chunk type');
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

async function pipe(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** zlib (RFC 1950) deflate via CompressionStream — the format PNG iTXt compression method 0 uses. */
export function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream('deflate'));
}

export function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream('deflate'));
}

const latin1 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** Builds an iTXt chunk (keyword, compressed UTF-8 text when CompressionStream is available). */
export async function makeITXtChunk(
  keyword: string,
  text: string,
  compress = true,
): Promise<Uint8Array> {
  if (!/^[\x20-\x7e]{1,79}$/.test(keyword)) throw new Error('Invalid iTXt keyword');
  const utf8 = new TextEncoder().encode(text);
  const canCompress = compress && typeof CompressionStream !== 'undefined';
  const payload = canCompress ? await deflate(utf8) : utf8;
  const key = latin1(keyword);
  // keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
  const data = new Uint8Array(key.length + 5 + payload.length);
  data.set(key, 0);
  let p = key.length;
  data[p++] = 0;
  data[p++] = canCompress ? 1 : 0;
  data[p++] = 0;
  data[p++] = 0; // empty language tag
  data[p++] = 0; // empty translated keyword
  data.set(payload, p);
  return makePngChunk('iTXt', data);
}

/** Parses an iTXt chunk payload. */
export async function parseITXt(data: Uint8Array): Promise<{ keyword: string; text: string }> {
  const nul = (from: number) => {
    const i = data.indexOf(0, from);
    if (i === -1) throw new Error('Malformed iTXt chunk');
    return i;
  };
  const k = nul(0);
  const keyword = String.fromCharCode(...data.subarray(0, k));
  const compressed = data[k + 1] === 1;
  const method = data[k + 2];
  const lang = nul(k + 3);
  const translated = nul(lang + 1);
  let payload = data.subarray(translated + 1);
  if (compressed) {
    if (method !== 0) throw new Error('Unsupported iTXt compression');
    payload = await inflate(payload);
  }
  return { keyword, text: new TextDecoder().decode(payload) };
}

/** Inserts (or replaces) an iTXt chunk with `keyword` right before IEND. */
export async function embedTextInPng(
  png: Uint8Array,
  keyword: string,
  text: string,
): Promise<Uint8Array> {
  const chunks = readPngChunks(png);
  const iend = chunks.find((c) => c.type === 'IEND');
  if (!iend) throw new Error('PNG without IEND');
  const chunk = await makeITXtChunk(keyword, text);
  const kept: Uint8Array[] = [png.subarray(0, PNG_SIGNATURE.length)];
  for (const c of chunks) {
    if (c.type === 'IEND') break;
    if (c.type === 'iTXt') {
      const { keyword: k } = await parseITXt(c.data).catch(() => ({ keyword: '' }));
      if (k === keyword) continue;
    }
    kept.push(png.subarray(c.offset, c.offset + 12 + c.data.length));
  }
  kept.push(chunk, png.subarray(iend.offset, iend.offset + 12));
  const total = kept.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of kept) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

/** Reads the text of the iTXt (or tEXt) chunk with `keyword`, or null. */
export async function readTextFromPng(png: Uint8Array, keyword: string): Promise<string | null> {
  let chunks: PngChunk[];
  try {
    chunks = readPngChunks(png);
  } catch {
    return null;
  }
  for (const c of chunks) {
    if (c.type === 'iTXt') {
      try {
        const parsed = await parseITXt(c.data);
        if (parsed.keyword === keyword) return parsed.text;
      } catch {
        // skip malformed chunks
      }
    } else if (c.type === 'tEXt') {
      const nul = c.data.indexOf(0);
      if (nul > 0 && String.fromCharCode(...c.data.subarray(0, nul)) === keyword) {
        return new TextDecoder('latin1').decode(c.data.subarray(nul + 1));
      }
    }
  }
  return null;
}
