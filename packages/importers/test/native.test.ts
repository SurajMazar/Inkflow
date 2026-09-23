import { createElement } from '@inkflow/elements';
import { CURRENT_DOCUMENT_VERSION, generateNKeysBetween, serializeDocument, DEFAULT_DOCUMENT_APP_STATE } from '@inkflow/scene';
import { describe, expect, it } from 'vitest';
import { MAX_NATIVE_JSON_CHARS } from '../src/limits';
import { importNativeJson } from '../src/native';

function sampleDocument() {
  const [k1, k2] = generateNKeysBetween(null, null, 2);
  const rect = createElement('rectangle', { id: 'rect-1', x: 10, y: 20, width: 100, height: 50, index: k1! });
  const text = createElement('text', { id: 'text-1', x: 0, y: 0, width: 40, height: 25, text: 'Hello', index: k2! });
  return serializeDocument([rect, text], { ...DEFAULT_DOCUMENT_APP_STATE, viewBackgroundColor: '#fafafa' }, {});
}

describe('importNativeJson', () => {
  it('round-trips a serialized document', () => {
    const doc = sampleDocument();
    const result = importNativeJson(JSON.stringify(doc));
    expect(result.issues).toEqual([]);
    expect(result.document.version).toBe(CURRENT_DOCUMENT_VERSION);
    expect(result.document.elements.map((e) => e.id)).toEqual(['rect-1', 'text-1']);
    expect(result.document.elements[0]).toEqual(doc.elements[0]);
    expect(result.document.appState.viewBackgroundColor).toBe('#fafafa');
  });

  it('accepts documents without the type marker and with a BOM', () => {
    const { type: _type, ...doc } = sampleDocument();
    const result = importNativeJson('\uFEFF' + JSON.stringify(doc));
    expect(result.document.elements).toHaveLength(2);
  });

  it('reports invalid elements instead of failing', () => {
    const doc = sampleDocument();
    const raw = JSON.parse(JSON.stringify(doc)) as { elements: unknown[] };
    raw.elements.push({ id: 'bad', type: 'rectangle', x: 'nope' }, { id: 'weird', type: 'hologram' });
    const result = importNativeJson(JSON.stringify(raw));
    expect(result.document.elements).toHaveLength(2);
    expect(result.issues.map((i) => i.elementId)).toEqual(['bad', 'weird']);
  });

  it('throws a friendly error for malformed JSON', () => {
    expect(() => importNativeJson('{"elements": [')).toThrow(/not valid JSON/);
  });

  it('rejects non-object JSON', () => {
    expect(() => importNativeJson('[1, 2, 3]')).toThrow(/does not contain an Inkflow board/);
    expect(() => importNativeJson('"text"')).toThrow(/does not contain an Inkflow board/);
    expect(() => importNativeJson('null')).toThrow(/does not contain an Inkflow board/);
    expect(() => importNativeJson('{"elements": 5}')).toThrow(/does not contain an Inkflow board/);
  });

  it('rejects files of another format', () => {
    expect(() => importNativeJson('{"type":"excalidraw","elements":[]}')).toThrow(/Excalidraw/);
    expect(() => importNativeJson('{"type":"other","elements":[]}')).toThrow(/does not contain/);
  });

  it('rejects oversized input before parsing', () => {
    const huge = ' '.repeat(MAX_NATIVE_JSON_CHARS + 1);
    expect(() => importNativeJson(huge)).toThrow(/too large/);
  });

  it('rejects documents from a newer format version', () => {
    expect(() => importNativeJson(JSON.stringify({ type: 'inkflow', version: 999, elements: [] }))).toThrow(/newer version/);
  });
});
