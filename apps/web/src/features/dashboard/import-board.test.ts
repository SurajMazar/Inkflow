import { describe, expect, it } from 'vitest';
import { readBoardFile } from './import-board';

const rect = {
  id: 'r1',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 60,
};

function file(name: string, contents: string) {
  return new File([contents], name, { type: 'application/json' });
}

describe('readBoardFile', () => {
  it('reads native .inkflow documents and derives the title from the file name', async () => {
    const doc = { type: 'inkflow', version: 2, elements: [rect], appState: {}, files: {} };
    const result = await readBoardFile(file('Team plan.inkflow', JSON.stringify(doc)));
    expect(result.title).toBe('Team plan');
    expect(result.format).toBe('inkflow');
    expect(result.document.elements).toHaveLength(1);
    expect(result.document.version).toBeGreaterThanOrEqual(1);
  });

  it('rejects files that are not JSON', async () => {
    await expect(readBoardFile(file('broken.json', '{nope'))).rejects.toThrow(/valid JSON/);
  });

  it('rejects files without readable shapes', async () => {
    const doc = {
      type: 'inkflow',
      version: 2,
      elements: [{ type: 'unknown-thing' }],
      appState: {},
      files: {},
    };
    await expect(readBoardFile(file('weird.inkflow', JSON.stringify(doc)))).rejects.toThrow(
      /couldn't read any shapes/i,
    );
  });

  it('converts Excalidraw scenes', async () => {
    const scene = {
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: [
        {
          id: 'e1',
          type: 'rectangle',
          x: 10,
          y: 20,
          width: 120,
          height: 80,
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
          seed: 1,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
          boundElements: null,
          updated: 1,
          link: null,
          locked: false,
          index: 'a0',
        },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    };
    const result = await readBoardFile(file('diagram.excalidraw', JSON.stringify(scene)));
    expect(result.format).toBe('excalidraw');
    expect(result.title).toBe('diagram');
    expect(result.document.elements).toHaveLength(1);
  });
});
