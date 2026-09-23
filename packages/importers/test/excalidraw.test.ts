import { validateElement, type SceneElement } from '@inkflow/elements';
import { compareOrder } from '@inkflow/scene';
import { describe, expect, it } from 'vitest';
import { importExcalidraw } from '../src/excalidraw';

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const PNG_BYTES = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...be32(13),
  ...ascii('IHDR'),
  ...be32(320),
  ...be32(200),
  8,
  6,
  0,
  0,
  0,
  ...be32(0),
]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`;

function base(
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1234,
    version: 3,
    versionNonce: 99,
    isDeleted: false,
    boundElements: null,
    updated: 1_700_000_000_000,
    link: null,
    locked: false,
    ...extra,
  };
}

function text(id: string, value: string, extra: Record<string, unknown> = {}) {
  return base(id, 'text', {
    text: value,
    originalText: value,
    fontSize: 20,
    fontFamily: 1,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    lineHeight: 1.25,
    ...extra,
  });
}

const sample = {
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [
    base('frame1', 'frame', {
      x: -100,
      y: -100,
      width: 1200,
      height: 900,
      name: 'Overview',
      roughness: 0,
    }),
    base('rect1', 'rectangle', {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      backgroundColor: '#a5d8ff',
      roundness: { type: 3 },
      frameId: 'frame1',
      groupIds: ['groupA'],
      boundElements: [
        { type: 'text', id: 'label1' },
        { type: 'arrow', id: 'arrow1' },
      ],
    }),
    text('label1', 'Start\nhere', {
      x: 70,
      y: 25,
      text: 'Start\nhere',
      originalText: 'Start here',
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: 'rect1',
      strokeColor: '#e03131',
      fontFamily: 2,
      fontSize: 24,
    }),
    base('ell1', 'ellipse', {
      x: 400,
      y: 0,
      width: 120,
      height: 80,
      fillStyle: 'cross-hatch',
      strokeStyle: 'dashed',
    }),
    base('dia1', 'diamond', {
      x: 600,
      y: 0,
      width: 90,
      height: 90,
      fillStyle: 'unknown-style',
      opacity: 60,
      groupIds: ['groupA'],
    }),
    base('arrow1', 'arrow', {
      x: 200,
      y: 50,
      width: 200,
      height: 0,
      points: [
        [0, 0],
        [100, -20],
        [200, 0],
      ],
      roundness: { type: 2 },
      startBinding: { elementId: 'rect1', focus: 0, gap: 5 },
      endBinding: { elementId: 'ell1', focus: 0.2, gap: 500 },
      startArrowhead: 'dot',
      endArrowhead: 'triangle',
    }),
    text('arrowLabel', 'yes', { containerId: 'arrow1', fontFamily: 3 }),
    base('elbow1', 'arrow', {
      points: [
        [0, 0],
        [50, 0],
        [50, 50],
      ],
      elbowed: true,
      startArrowhead: 'crowfoot_one_or_many',
      endArrowhead: null,
      startBinding: { elementId: 'missing', focus: 0, gap: 1 },
    }),
    base('line1', 'line', {
      x: 10,
      y: 300,
      points: [
        [0, 0],
        [-10, 20],
        [50, 40],
      ],
    }),
    base('poly1', 'line', {
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0],
      ],
      polygon: true,
      roundness: { type: 2 },
    }),
    base('free1', 'freedraw', {
      x: 100,
      y: 300,
      points: [
        [0, 0],
        [5, 5],
        [10, -2],
      ],
      pressures: [0.2, 0.5, 1.4],
      simulatePressure: false,
    }),
    text('t1', 'Hand', { fontFamily: 1, x: 10, y: 500 }),
    text('t2', 'Sans', { fontFamily: 2, x: 10, y: 550 }),
    text('t3', 'Code', {
      fontFamily: 3,
      x: 10,
      y: 600,
      textAlign: 'right',
      autoResize: false,
      text: 'Co\nde',
      originalText: 'Code',
    }),
    text('t4', 'Excalifont', { fontFamily: 5 }),
    text('t5', 'Unknown', { fontFamily: 42 }),
    base('img1', 'image', {
      x: 700,
      y: 300,
      width: 160,
      height: 100,
      fileId: 'file1',
      status: 'saved',
      scale: [1, 1],
    }),
    base('deleted1', 'rectangle', { isDeleted: true }),
    text('orphanLabel', 'orphan', { containerId: 'deleted1' }),
  ],
  appState: { viewBackgroundColor: '#fafafa', gridSize: 20 },
  files: {
    file1: {
      id: 'file1',
      mimeType: 'image/png',
      dataURL: PNG_DATA_URL,
      created: 1_690_000_000_000,
    },
  },
};

function byId(elements: SceneElement[], id: string): SceneElement {
  const el = elements.find((e) => e.id === id);
  if (!el) throw new Error(`missing ${id}`);
  return el;
}

describe('importExcalidraw', () => {
  const result = importExcalidraw(sample);
  const { elements, files, appState } = result.document;

  it('converts without issues and keeps valid ids', () => {
    expect(result.issues).toEqual([]);
    expect(elements.map((e) => e.id)).toEqual([
      'frame1',
      'rect1',
      'ell1',
      'dia1',
      'arrow1',
      'elbow1',
      'line1',
      'poly1',
      'free1',
      't1',
      't2',
      't3',
      't4',
      't5',
      'img1',
      'orphanLabel',
    ]);
    for (const el of elements) expect(validateElement(el).success).toBe(true);
  });

  it('preserves z-order with ascending fractional indices', () => {
    const sorted = [...elements].sort(compareOrder).map((e) => e.id);
    expect(sorted).toEqual(elements.map((e) => e.id));
    for (let i = 1; i < elements.length; i++)
      expect(elements[i - 1]!.index < elements[i]!.index).toBe(true);
  });

  it('merges bound text into shape and arrow labels', () => {
    const rect = byId(elements, 'rect1');
    expect(rect.type).toBe('rectangle');
    if (rect.type !== 'rectangle') return;
    expect(rect.label).toMatchObject({
      text: 'Start here',
      fontFamily: 'sans',
      fontSize: 24,
      textAlign: 'center',
      verticalAlign: 'middle',
      color: '#e03131',
    });
    expect(rect).toMatchObject({
      backgroundColor: '#a5d8ff',
      roundness: 'round',
      frameId: 'frame1',
      groupIds: ['groupA'],
      seed: 1234,
    });
    expect(elements.some((e) => e.id === 'label1' || e.id === 'arrowLabel')).toBe(false);

    const arrow = byId(elements, 'arrow1');
    if (arrow.type !== 'arrow') throw new Error('expected arrow');
    expect(arrow.label).toMatchObject({ text: 'yes', position: 0.5, fontFamily: 'mono' });
  });

  it('keeps arrow bindings, arrowheads and path styles', () => {
    const arrow = byId(elements, 'arrow1');
    if (arrow.type !== 'arrow') throw new Error('expected arrow');
    expect(arrow.startBinding).toEqual({ elementId: 'rect1', portId: null, anchor: null, gap: 5 });
    expect(arrow.endBinding).toEqual({ elementId: 'ell1', portId: null, anchor: null, gap: 200 });
    expect(arrow.startArrowhead).toBe('dot');
    expect(arrow.endArrowhead).toBe('triangle');
    expect(arrow.pathStyle).toBe('curved');
    expect(arrow).toMatchObject({ x: 200, y: 30, width: 200, height: 20 });
    expect(arrow.points).toEqual([
      [0, 20],
      [100, 0],
      [200, 20],
    ]);

    const elbow = byId(elements, 'elbow1');
    if (elbow.type !== 'arrow') throw new Error('expected arrow');
    expect(elbow.pathStyle).toBe('elbow');
    expect(elbow.startArrowhead).toBe('er-one-many');
    expect(elbow.endArrowhead).toBe('none');
    expect(elbow.startBinding).toBeNull();
  });

  it('converts shapes and styles', () => {
    expect(byId(elements, 'ell1')).toMatchObject({
      type: 'ellipse',
      fillStyle: 'cross-hatch',
      strokeStyle: 'dashed',
      width: 120,
      height: 80,
    });
    expect(byId(elements, 'dia1')).toMatchObject({
      type: 'diamond',
      fillStyle: 'hachure',
      opacity: 60,
    });
    expect(byId(elements, 'frame1')).toMatchObject({
      type: 'frame',
      name: 'Overview',
      width: 1200,
    });
  });

  it('normalizes line and freedraw points', () => {
    const line = byId(elements, 'line1');
    if (line.type !== 'line') throw new Error('expected line');
    expect(line).toMatchObject({
      x: 0,
      y: 300,
      width: 60,
      height: 40,
      closed: false,
      pathStyle: 'sharp',
    });
    expect(line.points).toEqual([
      [10, 0],
      [0, 20],
      [60, 40],
    ]);
    const poly = byId(elements, 'poly1');
    if (poly.type !== 'line') throw new Error('expected line');
    expect(poly.closed).toBe(true);
    expect(poly.pathStyle).toBe('curved');

    const free = byId(elements, 'free1');
    if (free.type !== 'freedraw') throw new Error('expected freedraw');
    expect(free).toMatchObject({ x: 100, y: 298, width: 10, height: 7, simulatePressure: false });
    expect(free.points).toEqual([
      [0, 2, 0.2],
      [5, 7, 0.5],
      [10, 0, 1],
    ]);
  });

  it('maps text fonts and sizing', () => {
    const fonts = ['t1', 't2', 't3', 't4', 't5'].map((id) => {
      const el = byId(elements, id);
      return el.type === 'text' ? el.fontFamily : null;
    });
    expect(fonts).toEqual(['hand', 'sans', 'mono', 'hand', 'sans']);
    const t3 = byId(elements, 't3');
    if (t3.type !== 'text') throw new Error('expected text');
    expect(t3).toMatchObject({ text: 'Code', autoResize: false, textAlign: 'right', fontSize: 20 });
    const orphan = byId(elements, 'orphanLabel');
    expect(orphan).toMatchObject({ type: 'text', text: 'orphan' });
  });

  it('converts images and the files map', () => {
    const img = byId(elements, 'img1');
    if (img.type !== 'image') throw new Error('expected image');
    expect(img).toMatchObject({
      fileId: 'file1',
      status: 'saved',
      naturalWidth: 320,
      naturalHeight: 200,
      lockAspectRatio: true,
    });
    expect(files.file1).toEqual({
      id: 'file1',
      mimeType: 'image/png',
      url: PNG_DATA_URL,
      width: 320,
      height: 200,
      size: PNG_BYTES.length,
      created: 1_690_000_000_000,
    });
    expect(appState).toMatchObject({ viewBackgroundColor: '#fafafa', gridSize: 20 });
  });

  it('drops unsafe files, links and unsupported elements with issues', () => {
    const svgPayload = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>',
    ).toString('base64');
    const res = importExcalidraw({
      type: 'excalidraw',
      elements: [
        base('a', 'rectangle', { link: 'javascript:alert(1)' }),
        base('b', 'rectangle', { link: 'https://example.com' }),
        base('c', 'embeddable', { link: 'https://youtube.com' }),
        base('d', 'image', { fileId: 'remote' }),
        base('e', 'image', { fileId: 'fake' }),
        base('f', 'image', { fileId: 'vector' }),
        base('a', 'ellipse'),
        base('<script>', 'diamond'),
      ],
      files: {
        remote: { id: 'remote', mimeType: 'image/png', dataURL: 'https://evil.example/x.png' },
        fake: { id: 'fake', mimeType: 'image/png', dataURL: 'data:image/png;base64,aGVsbG8=' },
        vector: {
          id: 'vector',
          mimeType: 'image/svg+xml',
          dataURL: `data:image/svg+xml;base64,${svgPayload}`,
        },
      },
    });
    const els = res.document.elements;
    expect(byId(els, 'a').link).toBeNull();
    expect(byId(els, 'b').link).toBe('https://example.com');
    expect(els.some((e) => e.id === 'c')).toBe(false);
    expect(els).toHaveLength(7);
    // Duplicate and invalid ids are replaced with fresh ones.
    const ids = new Set(els.map((e) => e.id));
    expect(ids.size).toBe(7);
    expect(ids.has('<script>')).toBe(false);
    expect(Object.keys(res.document.files)).toEqual(['vector']);
    const vector = Buffer.from(res.document.files.vector!.url.split(',')[1]!, 'base64').toString(
      'utf8',
    );
    expect(vector).toContain('<rect');
    expect(vector).not.toContain('script');
    const messages = res.issues.map((i) => i.message).join('\n');
    expect(messages).toMatch(/embeddable/);
    expect(messages).toMatch(/File remote/);
    expect(messages).toMatch(/File fake/);
    const missing = byId(els, 'd');
    expect(missing).toMatchObject({ type: 'image', status: 'error', fileId: null });
  });

  it('rejects input that is not an Excalidraw scene', () => {
    expect(() => importExcalidraw(null)).toThrow('Not an Excalidraw file');
    expect(() => importExcalidraw('{"type":"excalidraw"}')).toThrow('Not an Excalidraw file');
    expect(() => importExcalidraw([])).toThrow('Not an Excalidraw file');
    expect(() => importExcalidraw({ type: 'inkflow', elements: [] })).toThrow(
      'Not an Excalidraw file',
    );
    expect(() => importExcalidraw({ type: 'excalidraw', elements: {} })).toThrow(
      'Not an Excalidraw file',
    );
  });

  it('tolerates garbage element properties', () => {
    const res = importExcalidraw({
      type: 'excalidraw',
      elements: [
        base('g1', 'rectangle', {
          x: 'NaN',
          width: -40,
          strokeColor: '<b>',
          opacity: 400,
          strokeWidth: 9999,
          angle: Infinity,
        }),
        'not-an-object',
        base('g2', 'line', { points: 'nope' }),
        base('g3', 'arrow', {
          points: [
            [0, 0],
            ['a', 1],
            [5, 5],
          ],
        }),
      ],
    });
    expect(res.document.elements.map((e) => e.id)).toEqual(['g1', 'g2', 'g3']);
    expect(byId(res.document.elements, 'g1')).toMatchObject({
      x: 0,
      width: 40,
      strokeColor: '#1e1e1e',
      opacity: 100,
      strokeWidth: 200,
      angle: 0,
    });
    const g3 = byId(res.document.elements, 'g3');
    expect(g3.type === 'arrow' && g3.points.length).toBe(2);
  });
});
