import { describe, expect, it } from 'vitest';
import { detectImportKind } from '../src/detect';

describe('detectImportKind', () => {
  it('detects JSON formats by content', () => {
    expect(
      detectImportKind(
        'scene.json',
        'application/json',
        '{\n  "type": "excalidraw",\n  "version": 2,',
      ),
    ).toBe('excalidraw');
    expect(detectImportKind('clip.txt', '', '{"type":"excalidraw/clipboard","elements":[]}')).toBe(
      'excalidraw',
    );
    expect(
      detectImportKind('board.json', 'application/json', '{"type": "inkflow", "version": 2}'),
    ).toBe('inkflow');
    expect(detectImportKind('board.json', '', '{"version":2,"elements":[],"appState":{}}')).toBe(
      'inkflow',
    );
    // Content wins over a misleading extension.
    expect(
      detectImportKind('drawing.svg', 'image/svg+xml', '{"type":"excalidraw","elements":[]}'),
    ).toBe('excalidraw');
  });

  it('detects SVG markup after prolog, comments and doctype', () => {
    expect(detectImportKind('x', '', '<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe('svg');
    expect(
      detectImportKind(
        'x.txt',
        'text/plain',
        '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Tool -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg width="1">',
      ),
    ).toBe('svg');
    expect(detectImportKind('x', '', '<!DOCTYPE svg [ <!ENTITY a "b"> ]><svg>')).toBe('svg');
    expect(detectImportKind('page.html', 'text/html', '<html><body><svg></svg>')).toBe('unknown');
  });

  it('detects Mermaid headers', () => {
    expect(detectImportKind('a.txt', 'text/plain', 'flowchart LR\n  A --> B')).toBe('mermaid');
    expect(detectImportKind('a.txt', '', '%% comment\n\ngraph TD\nA-->B')).toBe('mermaid');
    expect(detectImportKind('a.txt', '', 'sequenceDiagram\n  Alice->>Bob: Hi')).toBe('mermaid');
    expect(detectImportKind('a.txt', '', 'erDiagram\n CUSTOMER ||--o{ ORDER : places')).toBe(
      'mermaid',
    );
    expect(detectImportKind('a.txt', '', 'classDiagram\n class A')).toBe('mermaid');
    expect(detectImportKind('a.txt', '', 'stateDiagram-v2\n [*] --> A')).toBe('mermaid');
    expect(detectImportKind('a.txt', '', '---\ntitle: Demo\n---\nflowchart TB\nA')).toBe('mermaid');
    expect(detectImportKind('a.txt', '', '%%{init: {"theme": "dark"}}%%\nflowchart TB\nA')).toBe(
      'mermaid',
    );
    expect(detectImportKind('a.txt', 'text/plain', 'graphics are fun')).toBe('unknown');
  });

  it('falls back to the MIME type', () => {
    expect(detectImportKind('file', 'image/svg+xml', '')).toBe('svg');
    expect(detectImportKind('file', 'image/png', '')).toBe('image');
    expect(detectImportKind('file', 'IMAGE/JPEG; charset=binary', '')).toBe('image');
    expect(detectImportKind('file', 'application/vnd.inkflow+json', '')).toBe('inkflow');
    expect(detectImportKind('file', 'image/bmp', '')).toBe('unknown');
  });

  it('detects binary images from their decoded magic bytes', () => {
    expect(detectImportKind('blob', '', '\u0089PNG\r\n\u001a\n\u0000\u0000')).toBe('image');
    expect(detectImportKind('blob', '', '\uFFFDPNG\r\n\u001a\n')).toBe('image');
    expect(detectImportKind('blob', '', 'GIF89a\u0001\u0000')).toBe('image');
    expect(detectImportKind('blob', '', '\u00ff\u00d8\u00ff\u00e0')).toBe('image');
    expect(detectImportKind('blob', '', 'RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')).toBe('image');
  });

  it('falls back to the file extension', () => {
    expect(detectImportKind('board.INKFLOW', '', '')).toBe('inkflow');
    expect(detectImportKind('scene.excalidraw', '', '')).toBe('excalidraw');
    expect(detectImportKind('icon.svg', '', '')).toBe('svg');
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif'])
      expect(detectImportKind(`photo.${ext}`, '', '')).toBe('image');
    expect(detectImportKind('diagram.mmd', '', '')).toBe('mermaid');
    expect(detectImportKind('diagram.mermaid', '', '')).toBe('mermaid');
    expect(detectImportKind('data.json', 'application/json', '{"foo": 1}')).toBe('unknown');
    expect(detectImportKind('notes.txt', 'text/plain', 'hello')).toBe('unknown');
    expect(detectImportKind('.svg', '', '')).toBe('unknown');
  });
});
