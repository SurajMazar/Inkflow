import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createLabel, getElementBounds } from '@inkflow/elements';
import { measureRenderPadding } from '@inkflow/renderer';
import { parseDocument } from '@inkflow/scene';
import {
  clampExportScale,
  embedSceneInPng,
  exportToCanvas,
  exportToJson,
  exportToPdfBlob,
  exportToPngBlob,
  exportToSvgString,
  extractSceneFromPng,
  extractSceneFromSvg,
  getExportBounds,
  makeITXtChunk,
  parseColor,
  readPngChunks,
  readTextFromPng,
  suggestFileName,
  type RasterExportOptions,
} from '../src';
import { createCanvas, created, make, scopeOf, syntheticPng } from './helpers';

const raster = (extra: Partial<RasterExportOptions> = {}): RasterExportOptions => ({
  background: true,
  darkMode: false,
  padding: 10,
  scale: 1,
  loadImage: async () => ({ width: 1, height: 1 }) as unknown as CanvasImageSource,
  createCanvas,
  ...extra,
});

describe('getExportBounds', () => {
  const a = make('rectangle', { x: 0, y: 0, width: 100, height: 50, roughness: 0, strokeWidth: 2 });
  const b = make('ellipse', {
    x: 200,
    y: 100,
    width: 50,
    height: 50,
    roughness: 0,
    strokeWidth: 2,
  });
  const frame = make('frame', { x: 400, y: 400, width: 300, height: 200, angle: 0, name: 'F' });
  const hidden = make('rectangle', { x: -1000, y: -1000, width: 10, height: 10, hidden: true });
  const deleted = make('rectangle', { x: 5000, y: 5000, width: 10, height: 10, isDeleted: true });

  it('covers element render bounds plus padding (ignoring hidden/deleted)', () => {
    const scope = scopeOf([a, b, hidden, deleted]);
    const pad = measureRenderPadding(a);
    const r = getExportBounds(scope, { padding: 10 });
    expect(r.x).toBeCloseTo(-pad - 10, 6);
    expect(r.y).toBeCloseTo(-pad - 10, 6);
    expect(r.x + r.width).toBeCloseTo(250 + pad + 10, 6);
    expect(r.y + r.height).toBeCloseTo(150 + pad + 10, 6);
  });

  it('crops to a frame (rotated frames use their rotated box)', () => {
    const scope = scopeOf([a, frame]);
    expect(getExportBounds(scope, { padding: 20, frameId: frame.id })).toEqual({
      x: 400,
      y: 400,
      width: 300,
      height: 200,
    });
    const rotated = { ...frame, angle: Math.PI / 2 };
    const r = getExportBounds(scopeOf([rotated]), { padding: 0, frameId: frame.id });
    expect(r.width).toBeCloseTo(200, 6);
    expect(r.height).toBeCloseTo(300, 6);
    expect(r.x).toBeCloseTo(450, 6);
  });

  it('uses the exact viewport rectangle', () => {
    const scope = scopeOf([a, b]);
    expect(
      getExportBounds(scope, { padding: 30, bounds: { x: 10, y: 20, width: -100, height: 50 } }),
    ).toEqual({ x: -90, y: 20, width: 100, height: 50 });
  });

  it('reserves space for frame names and handles empty scopes', () => {
    const scope = scopeOf([frame]);
    const r = getExportBounds(scope, { padding: 0 });
    expect(r.y).toBeLessThan(getElementBounds(frame).minY - 20);
    expect(getExportBounds(scopeOf([]), { padding: 8 })).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
  });
});

describe('PNG iTXt embedding', () => {
  it('round-trips the scene through a synthetic PNG', async () => {
    const png = syntheticPng(3, 2);
    const json = JSON.stringify({
      type: 'inkflow',
      text: 'ünïcødé ✓ 🎨',
      n: Array.from({ length: 200 }, (_, i) => i),
    });
    const out = await embedSceneInPng(png, json);
    const chunks = readPngChunks(out); // verifies CRCs
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'iTXt', 'IEND']);
    expect(await readTextFromPng(out, 'inkflow')).toBe(json);
    expect(await extractSceneFromPng(new Blob([out as BlobPart], { type: 'image/png' }))).toBe(
      json,
    );
    // Compressed payload is smaller than the raw JSON.
    const itxt = chunks.find((c) => c.type === 'iTXt')!;
    expect(itxt.data.length).toBeLessThan(json.length);
    // Re-embedding replaces the previous chunk.
    const again = await embedSceneInPng(out, '{"v":2}');
    expect(readPngChunks(again).filter((c) => c.type === 'iTXt')).toHaveLength(1);
    expect(await readTextFromPng(again, 'inkflow')).toBe('{"v":2}');
  });

  it('writes spec-conformant iTXt chunks and rejects non-PNG input', async () => {
    const chunk = await makeITXtChunk('inkflow', 'hello', false);
    const text = new TextDecoder().decode(chunk.subarray(8, chunk.length - 4));
    expect(text).toBe('inkflow\u0000\u0000\u0000\u0000\u0000hello');
    expect(await extractSceneFromPng(new Blob(['not a png']))).toBeNull();
    expect(await extractSceneFromPng(new Blob([syntheticPng() as BlobPart]))).toBeNull();
  });
});

describe('exportToCanvas / exportToPngBlob', () => {
  it('sizes the canvas to bounds × scale and clamps to maxPixels', async () => {
    const el = make('rectangle', { x: 0, y: 0, width: 1000, height: 500, roughness: 0 });
    const scope = scopeOf([el]);
    const canvas = await exportToCanvas(
      scope,
      raster({ scale: 2, padding: 0, bounds: { x: 0, y: 0, width: 1000, height: 500 } }),
    );
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1000);
    const clamped = await exportToCanvas(
      scope,
      raster({ scale: 4, maxPixels: 1_000_000, bounds: { x: 0, y: 0, width: 1000, height: 500 } }),
    );
    expect(clamped.width * clamped.height).toBeLessThanOrEqual(1_000_000 + 2000);
    expect(clamped.width / clamped.height).toBeCloseTo(2, 1);
    expect(clampExportScale(100, 100, 3, 1e9)).toBe(3);
  });

  it('draws the background only when requested and applies dark mode', async () => {
    const el = make('rectangle', { x: 0, y: 0, width: 100, height: 50 });
    created.length = 0;
    await exportToCanvas(scopeOf([el]), raster({ background: false }));
    expect(created[0]!.ctx.calls.filter((c) => c.name === 'fillRect')).toHaveLength(0);
    created.length = 0;
    await exportToCanvas(scopeOf([el]), raster({ background: true, darkMode: true }));
    const calls = created[0]!.ctx.calls.map((c) => c.name);
    expect(calls).toContain('fillRect');
    expect(calls).toContain('getImageData');
    expect(calls).toContain('putImageData');
  });

  it('produces a valid PNG with the embedded scene', async () => {
    const el = make('rectangle', { x: 0, y: 0, width: 100, height: 50, label: createLabel('Hi') });
    const scope = scopeOf([el]);
    const blob = await exportToPngBlob(scope, raster({ embedScene: true }));
    expect(blob.type).toBe('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const json = await extractSceneFromPng(blob);
    const parsed = parseDocument(JSON.parse(json!));
    expect(parsed.document.elements.map((e) => e.id)).toEqual([el.id]);
    const plain = await exportToPngBlob(scope, raster());
    expect(await extractSceneFromPng(plain)).toBeNull();
  });

  it('loads images through loadImage and exports a frame with its children only', async () => {
    const frame = make('frame', { x: 0, y: 0, width: 200, height: 200 });
    const img = make('image', {
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      fileId: 'f1',
      frameId: frame.id,
    });
    const outside = make('rectangle', { x: 20, y: 20, width: 30, height: 30 });
    const loaded: string[] = [];
    const scope = scopeOf([frame, img, outside], {
      files: {
        f1: {
          id: 'f1',
          mimeType: 'image/png',
          url: 'https://example.com/a.png',
          width: 50,
          height: 50,
          size: 1,
          created: 0,
        },
      },
    });
    created.length = 0;
    const canvas = await exportToCanvas(
      scope,
      raster({
        frameId: frame.id,
        loadImage: async (f) => (
          loaded.push(f.id),
          { width: 50, height: 50 } as unknown as CanvasImageSource
        ),
      }),
    );
    expect(loaded).toEqual(['f1']);
    expect(canvas.width).toBe(200);
    const calls = created[0]!.ctx.calls;
    expect(calls.filter((c) => c.name === 'drawImage')).toHaveLength(1);
    // `outside` is not part of the frame → only the frame border + image are drawn (no rectangle stroke at 20,20).
    const strokes = calls.filter((c) => c.name === 'stroke').length;
    expect(strokes).toBe(1);
  });
});

describe('exportToJson', () => {
  it('round-trips through parseDocument', () => {
    const a = make('rectangle', { x: 1, y: 2, width: 3, height: 4, index: 'a0' });
    const b = make('arrow', {
      points: [
        [0, 0],
        [10, 10],
      ],
      width: 10,
      height: 10,
      index: 'a1',
    });
    const gone = make('ellipse', { isDeleted: true, index: 'a2' });
    const scope = scopeOf([a, b, gone], {
      appState: {
        viewBackgroundColor: '#fafafa',
        gridType: 'square',
        gridSize: 16,
        frameOrder: [],
      },
    });
    const json = exportToJson(scope);
    expect(json).toContain('\n  "type": "inkflow"');
    const parsed = parseDocument(JSON.parse(json));
    expect(parsed.issues).toEqual([]);
    expect(parsed.document.elements).toEqual([a, b]);
    expect(parsed.document.appState.gridType).toBe('square');
    expect(JSON.parse(exportToJson(scope, { includeDeleted: true })).elements).toHaveLength(3);
  });
});

describe('exportToSvgString', () => {
  it('embeds images, fonts and scene metadata', async () => {
    const text = make('text', {
      x: 0,
      y: 0,
      text: 'Hello <world>',
      width: 120,
      height: 30,
      fontFamily: 'hand',
    });
    const img = make('image', { x: 0, y: 50, width: 40, height: 40, fileId: 'f1' });
    const scope = scopeOf([text, img], {
      files: {
        f1: {
          id: 'f1',
          mimeType: 'image/png',
          url: '/files/f1',
          width: 40,
          height: 40,
          size: 1,
          created: 0,
        },
      },
    });
    const svg = await exportToSvgString(scope, {
      background: true,
      darkMode: false,
      padding: 10,
      embedScene: true,
      embedFonts: true,
      fontSources: [
        { family: 'Kalam', url: 'https://fonts.example/kalam.woff2' },
        { family: 'Lora', url: 'https://fonts.example/lora.woff2' },
      ],
      fetchFont: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      loadImage: async () => ({}) as CanvasImageSource,
      loadImageDataUrl: async () => 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(svg).toContain('<image ');
    expect(svg).toContain('href="data:image/png;base64,iVBORw0KGgo="');
    expect(svg).toContain(
      '@font-face{font-family:"Kalam";src:url(data:font/woff2;base64,AQIDBA==)',
    );
    expect(svg).not.toContain('"Lora";src');
    expect(svg).toContain('Hello &lt;world&gt;');
    const json = extractSceneFromSvg(svg);
    expect(parseDocument(JSON.parse(json!)).document.elements).toHaveLength(2);
  });
});

function pdfText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function pdfStreams(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<<([^>]*?\/FlateDecode[^>]*?)>>\s*stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = src.indexOf('endstream', start);
    try {
      out.push(inflateSync(Buffer.from(src.slice(start, end), 'latin1')).toString('latin1'));
    } catch {
      // image streams etc.
    }
  }
  return out;
}

describe('exportToPdfBlob', () => {
  const f1 = make('frame', { x: 0, y: 0, width: 400, height: 300, name: 'One', index: 'a0' });
  const f2 = make('frame', { x: 600, y: 0, width: 800, height: 450, name: 'Two', index: 'a1' });
  const r1 = make('rectangle', {
    x: 20,
    y: 20,
    width: 100,
    height: 60,
    frameId: f1.id,
    backgroundColor: '#ffc9c9',
    fillStyle: 'hachure',
    index: 'a2',
  });
  const t2 = make('text', {
    x: 650,
    y: 50,
    text: 'Slide two',
    width: 200,
    height: 30,
    frameId: f2.id,
    index: 'a3',
  });
  const e2 = make('ellipse', {
    x: 700,
    y: 100,
    width: 100,
    height: 80,
    frameId: f2.id,
    opacity: 50,
    strokeStyle: 'dashed',
    index: 'a4',
  });

  it('vector mode: one page per frame in presentation order, sized to the frame', async () => {
    const scope = scopeOf([f1, f2, r1, t2, e2], {
      appState: {
        viewBackgroundColor: '#ffffff',
        gridType: 'dot',
        gridSize: 20,
        frameOrder: [f2.id],
      },
    });
    const blob = await exportToPdfBlob(scope, { ...raster(), mode: 'vector', pages: 'frames' });
    expect(blob.type).toBe('application/pdf');
    const src = pdfText(new Uint8Array(await blob.arrayBuffer()));
    expect(src.startsWith('%PDF-')).toBe(true);
    expect(src.trimEnd().endsWith('%%EOF')).toBe(true);
    const pages = src.match(/\/Type \/Page\b(?!s)/g) ?? [];
    expect(pages).toHaveLength(2);
    const boxes = [...src.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(boxes).toEqual([
      [600, 337.5],
      [300, 225],
    ]);
    const content = pdfStreams(src).join('\n');
    expect(content).toMatch(/ c\n/); // cubic curves from the rough generator
    expect(content).toMatch(/ l\n/);
    expect(content).toMatch(/\bS\n/); // strokes
    expect(content).toMatch(/\bf\*?\n/); // fills
    expect(content).toMatch(/\[\d[\d. ]*\] 0\.? d\n/); // dash pattern
    expect(content).toMatch(/\/GS\d+ gs/); // opacity
    expect(content).toContain('(Slide two) Tj');
    expect(content).toMatch(/\bW\n/); // clipping
  });

  it('vector mode single page contains all elements', async () => {
    const scope = scopeOf([f1, f2, r1, t2, e2]);
    const blob = await exportToPdfBlob(scope, { ...raster(), mode: 'vector', pages: 'single' });
    const src = pdfText(new Uint8Array(await blob.arrayBuffer()));
    expect(src.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(1);
    const content = pdfStreams(src).join('\n');
    expect(content).toContain('(Slide two) Tj');
    expect(content).toContain('(One) Tj'); // frame names on the single page
  });

  it('raster mode embeds one PNG per page', async () => {
    const scope = scopeOf([f1, f2, r1, t2, e2]);
    const blob = await exportToPdfBlob(scope, { ...raster(), mode: 'raster', pages: 'frames' });
    const src = pdfText(new Uint8Array(await blob.arrayBuffer()));
    expect(src.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(2);
    expect(src.match(/\/Subtype \/Image/g)!.length).toBeGreaterThanOrEqual(2);
  });
});

describe('helpers', () => {
  it('suggests safe file names', () => {
    expect(suggestFileName('My Board', 'png')).toBe('My Board.png');
    expect(suggestFileName('  a/b:c*?  ', 'svg')).toBe('a-b-c.svg');
    expect(suggestFileName('', 'pdf')).toBe('Untitled.pdf');
    expect(suggestFileName('...', 'inkflow')).toBe('Untitled.inkflow');
    expect(suggestFileName('x'.repeat(300), 'json')).toBe(`${'x'.repeat(100)}.json`);
    expect(suggestFileName('CON', 'png')).toBe('CON-board.png');
  });

  it('parses CSS colors for PDF output', () => {
    expect(parseColor('#1e1e1e')).toEqual({ r: 30, g: 30, b: 30, a: 1 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#ff000080')!.a).toBeCloseTo(0.5, 2);
    expect(parseColor('rgba(10, 20, 30, 0.25)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(parseColor('transparent')).toBeNull();
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });
});
