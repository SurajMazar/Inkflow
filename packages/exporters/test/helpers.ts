import { deflateSync } from 'node:zlib';
import { createElement, type ElementOfType, type ElementType, type NewElementProps, type SceneElement } from '@inkflow/elements';
import { DEFAULT_DOCUMENT_APP_STATE } from '@inkflow/scene';
import { makePngChunk, PNG_SIGNATURE, type ExportScope } from '../src';

let counter = 0;

export function make<T extends ElementType>(type: T, props: NewElementProps<T> = {}): ElementOfType<T> {
  counter++;
  return createElement(type, { id: `${type}-${counter}`, seed: 500 + counter, versionNonce: counter, ...props } as NewElementProps<T>);
}

export function scopeOf(elements: SceneElement[], extra: Partial<ExportScope> = {}): ExportScope {
  const map = new Map(elements.map((e) => [e.id, e]));
  return {
    elements,
    getElement: (id) => map.get(id),
    files: {},
    appState: { ...DEFAULT_DOCUMENT_APP_STATE },
    ...extra,
  };
}

/** A real, decodable w×h RGBA PNG (IHDR + zlib IDAT + IEND). */
export function syntheticPng(width = 2, height = 2): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) raw.set([255, x * 100, y * 100, 255], y * (1 + width * 4) + 1 + x * 4);
  }
  const chunks = [makePngChunk('IHDR', ihdr), makePngChunk('IDAT', new Uint8Array(deflateSync(raw))), makePngChunk('IEND', new Uint8Array(0))];
  const total = PNG_SIGNATURE.length + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE, 0);
  let p = PNG_SIGNATURE.length;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Recording 2D context + canvas double that encodes to a synthetic PNG. */
export class FakeContext {
  calls: { name: string; args: unknown[] }[] = [];
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  lineCap = 'butt';
  lineJoin = 'miter';
  globalCompositeOperation = 'source-over';
  constructor(readonly canvas: FakeCanvas) {}
}

const METHODS = [
  'save', 'restore', 'setTransform', 'translate', 'rotate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo',
  'closePath', 'rect', 'arc', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'drawImage',
  'setLineDash', 'putImageData',
] as const;
for (const m of METHODS) {
  (FakeContext.prototype as unknown as Record<string, (...a: unknown[]) => void>)[m] = function (this: FakeContext, ...args: unknown[]) {
    this.calls.push({ name: m, args });
  };
}
(FakeContext.prototype as unknown as Record<string, unknown>)['getImageData'] = function (this: FakeContext, _x: number, _y: number, w: number, h: number) {
  this.calls.push({ name: 'getImageData', args: [w, h] });
  return { data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h };
};
(FakeContext.prototype as unknown as Record<string, unknown>)['measureText'] = (t: string) => ({ width: t.length * 6 });

export class FakeCanvas {
  readonly ctx: FakeContext;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.ctx = new FakeContext(this);
  }
  getContext(): FakeContext {
    return this.ctx;
  }
  toBlob(cb: (b: Blob | null) => void): void {
    cb(new Blob([syntheticPng(Math.min(4, this.width), Math.min(4, this.height)) as BlobPart], { type: 'image/png' }));
  }
  toDataURL(): string {
    return `data:image/png;base64,${Buffer.from(syntheticPng(2, 2)).toString('base64')}`;
  }
}

export const created: FakeCanvas[] = [];
export const createCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = new FakeCanvas(w, h);
  created.push(c);
  return c as unknown as HTMLCanvasElement;
};
