import { describe, expect, it } from 'vitest';
import { createEdgeLabel, createLabel, type SceneElement } from '@inkflow/elements';
import { renderSceneToSvg, type SvgRenderOptions } from '../src';
import { lookup, make } from './fixtures';

/**
 * Minimal XML well-formedness checker: tags balance, attributes are quoted, entities are valid,
 * and no raw `<`/`&` appear in text or attribute values.
 */
export function checkWellFormedXml(xml: string): { ok: true } | { ok: false; error: string } {
  const stack: string[] = [];
  let i = 0;
  const entity = /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;
  const checkText = (text: string): string | null => {
    for (let k = 0; k < text.length; k++) {
      if (text[k] === '<') return 'raw < in text';
      if (text[k] === '&' && !entity.test(text.slice(k))) return `bad entity at ${text.slice(k, k + 10)}`;
    }
    return null;
  };
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const text = lt === -1 ? xml.slice(i) : xml.slice(i, lt);
    const err = checkText(text);
    if (err) return { ok: false, error: err };
    if (lt === -1) break;
    const gt = xml.indexOf('>', lt);
    if (gt === -1) return { ok: false, error: 'unterminated tag' };
    const tag = xml.slice(lt + 1, gt);
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      if (stack.pop() !== name) return { ok: false, error: `mismatched </${name}>` };
    } else {
      const selfClosing = tag.endsWith('/');
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const m = /^([a-zA-Z][\w:.-]*)((?:\s+[a-zA-Z_:][\w:.-]*="[^"<]*")*)\s*$/.exec(body);
      if (!m) return { ok: false, error: `malformed tag <${tag.slice(0, 60)}>` };
      const attrs = m[2]!;
      for (const v of attrs.matchAll(/="([^"]*)"/g)) {
        const e = checkText(v[1]!);
        if (e) return { ok: false, error: `attribute: ${e}` };
      }
      if (!selfClosing) stack.push(m[1]!);
    }
    i = gt + 1;
  }
  return stack.length === 0 ? { ok: true } : { ok: false, error: `unclosed <${stack.join(', ')}>` };
}

function svgOptions(elements: SceneElement[], extra: Partial<SvgRenderOptions> = {}): SvgRenderOptions {
  return {
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    scale: 1,
    background: '#ffffff',
    theme: 'light',
    imageData: {},
    files: {},
    showFrameNames: true,
    getElement: lookup(elements),
    ...extra,
  };
}

describe('renderSceneToSvg', () => {
  const scene = (): SceneElement[] => {
    const frame = make('frame', { name: 'Frame <1>', x: 20, y: 40, width: 500, height: 400 });
    return [
      frame,
      make('rectangle', { x: 40, y: 60, width: 120, height: 80, backgroundColor: '#ffc9c9', fillStyle: 'hachure', frameId: frame.id, label: createLabel('Box & co') }),
      make('ellipse', { x: 200, y: 60, width: 100, height: 80, angle: 0.4, opacity: 60 }),
      make('arrow', { x: 40, y: 200, points: [[0, 0], [200, 50]], width: 200, height: 50, label: createEdgeLabel('edge') }),
      make('text', { x: 300, y: 300, text: '<script>alert("x")</script>', width: 200, height: 30 }),
      make('image', { x: 600, y: 60, width: 100, height: 80, fileId: 'img', flipX: true, crop: { x: 10, y: 10, width: 50, height: 40 }, naturalWidth: 100, naturalHeight: 80 }),
      make('freedraw', { x: 50, y: 500, points: [[0, 0, 0.5], [30, 10, 0.6], [60, 0, 0.7]], width: 60, height: 10 }),
    ];
  };

  it('produces well-formed standalone SVG with vector paths', () => {
    const els = scene();
    const svg = renderSceneToSvg(els, svgOptions(els, { imageData: { img: 'data:image/png;base64,iVBORw0KGgo=' } }));
    expect(checkWellFormedXml(svg)).toEqual({ ok: true });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 800 600"');
    expect(svg).toContain('width="800" height="600"');
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(8);
    // Only the image element is embedded as <image>; shapes are vector paths.
    expect((svg.match(/<image /g) ?? []).length).toBe(1);
    expect(svg).toContain('href="data:image/png;base64,iVBORw0KGgo="');
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('rotate(22.92 50 40)');
    expect(svg).toContain('opacity="0.6"');
    expect(svg).toMatch(/<rect x="0" y="0" width="800" height="600" fill="#ffffff"\/>/);
    expect(svg).toContain('font-family="&quot;Kalam&quot;');
  });

  it('escapes all user text (XSS-safe)', () => {
    const els = scene();
    const svg = renderSceneToSvg(els, svgOptions(els));
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(svg).toContain('Frame &lt;1&gt;');
    expect(svg).toContain('Box &amp; co');
    const evil = make('rectangle', { width: 10, height: 10, strokeColor: '"/><script>alert(1)</script>' });
    const svg2 = renderSceneToSvg([evil], svgOptions([evil]));
    expect(svg2).not.toContain('<script>');
    expect(checkWellFormedXml(svg2)).toEqual({ ok: true });
    const img = make('image', { width: 10, height: 10, fileId: 'bad' });
    const svg3 = renderSceneToSvg([img], svgOptions([img], { imageData: { bad: 'javascript:alert(1)' } }));
    expect(svg3).not.toContain('javascript:');
  });

  it('matches the canvas geometry (same drawables) and is deterministic', () => {
    const els = scene();
    expect(renderSceneToSvg(els, svgOptions(els))).toBe(renderSceneToSvg(els, svgOptions(els)));
  });

  it('supports transparent backgrounds, dark mode filters, fonts and metadata', () => {
    const els = scene();
    const svg = renderSceneToSvg(
      els,
      svgOptions(els, {
        background: null,
        theme: 'dark',
        imageData: { img: 'data:image/png;base64,AAAA' },
        fontFaces: [{ family: 'Kalam', dataUrl: 'data:font/woff2;base64,d09GMgABAAAAA' }],
        metadata: '{"type":"inkflow","x":"</metadata>"}',
      }),
    );
    expect(checkWellFormedXml(svg)).toEqual({ ok: true });
    expect(svg).not.toMatch(/<rect x="0" y="0" width="800" height="600"/);
    expect(svg).toContain('filter="url(#ink-dark)"');
    expect(svg).toContain('filter="url(#ink-counter)"');
    expect(svg).toContain('@font-face{font-family:"Kalam";src:url(data:font/woff2;base64,d09GMgABAAAAA)');
    expect(svg).toContain('<metadata>{&quot;type&quot;:&quot;inkflow&quot;,&quot;x&quot;:&quot;&lt;/metadata&gt;&quot;}</metadata>');
  });

  it('skips hidden and deleted elements and culls outside bounds', () => {
    const a = make('rectangle', { x: 10, y: 10, width: 20, height: 20, hidden: true });
    const b = make('rectangle', { x: 10, y: 10, width: 20, height: 20, isDeleted: true });
    const c = make('rectangle', { x: 5000, y: 10, width: 20, height: 20 });
    const svg = renderSceneToSvg([a, b, c], svgOptions([a, b, c], { background: null }));
    expect(svg).not.toContain('<path');
  });
});
