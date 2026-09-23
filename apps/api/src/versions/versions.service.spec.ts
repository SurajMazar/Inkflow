import { describe, expect, it } from 'vitest';
import { createElement, type SceneElement } from '@inkflow/elements';
import { createEmptyDocument } from '@inkflow/scene';
import { compareDocuments, sameContent } from './versions.service';

const doc = (elements: SceneElement[]) => ({ ...createEmptyDocument(), elements });

describe('version comparison', () => {
  it('ignores bookkeeping fields', () => {
    const a = createElement('rectangle', { id: 'a' });
    expect(sameContent(a, { ...a, version: 99, versionNonce: 1, updated: 5 })).toBe(true);
    expect(sameContent(a, { ...a, x: 1 })).toBe(false);
  });

  it('classifies added, removed, modified and unchanged elements', () => {
    const a = createElement('rectangle', { id: 'a' });
    const b = createElement('ellipse', { id: 'b' });
    const c = createElement('diamond', { id: 'c' });
    const gone = createElement('text', { id: 'gone', isDeleted: true });
    const result = compareDocuments(doc([a, b, gone]), doc([{ ...a, x: 50 }, c, { ...b, version: 7 }]));
    expect(result).toEqual({ added: ['c'], removed: [], modified: ['a'], unchangedCount: 1 });
    expect(compareDocuments(doc([a, b]), doc([a])).removed).toEqual(['b']);
  });
});
