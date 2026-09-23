import { validateElement, type SceneElement } from '@inkflow/elements';
import { describe, expect, it } from 'vitest';
import { importSvgAsElements } from '../src/svg-import';
import { sanitizeStyleAttribute, sanitizeSvg, svgToDataUrl } from '../src/svg-sanitize';
import { decodeXmlEntities, parseXml, tokenizeXml } from '../src/svg-tokenizer';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (body: string, attrs = '') => `<svg ${NS} ${attrs}>${body}</svg>`;

function only(elements: SceneElement[]): SceneElement {
  expect(elements).toHaveLength(1);
  return elements[0]!;
}

function importOne(body: string, attrs = ''): SceneElement {
  return only(importSvgAsElements(svg(body, attrs)).elements);
}

describe('svg tokenizer', () => {
  it('tokenizes tags, attributes, comments, CDATA, PIs and doctype', () => {
    const tokens = tokenizeXml(
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y>">]><!-- c --><svg a="1" b='2' c=3 d><![CDATA[<raw>]]><g/></svg>`,
    );
    expect(tokens.map((t) => t.kind)).toEqual([
      'pi',
      'doctype',
      'comment',
      'start',
      'cdata',
      'start',
      'end',
    ]);
    const start = tokens[3]!;
    expect(start.kind === 'start' && start.attrs).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'c', value: '3' },
      { name: 'd', value: '' },
    ]);
    expect(tokens[5]).toMatchObject({ kind: 'start', name: 'g', selfClosing: true });
  });

  it('decodes only XML entities and numeric references', () => {
    expect(decodeXmlEntities('&lt;a&gt; &amp; &quot;&apos; &#65;&#x42; &lol; &#0;')).toBe(
      '<a> & "\' AB &lol; \uFFFD',
    );
  });

  it('builds a lenient tree', () => {
    const nodes = parseXml('<svg><g><rect></g><circle/></svg></extra>');
    const root = nodes[0]!;
    expect(
      root.kind === 'element' && root.children.map((c) => (c.kind === 'element' ? c.name : 'text')),
    ).toEqual(['g', 'circle']);
  });

  it('rejects absurd nesting depth', () => {
    expect(() => parseXml('<g>'.repeat(10_000))).toThrow(/nested too deeply/);
  });
});

describe('sanitizeSvg', () => {
  const malicious = `<?xml version="1.0"?>
<!DOCTYPE svg [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100" onload="alert('onload')" ONLOAD="alert('upper')">
  <script>alert('script')</script>
  <SCRIPT>alert('upper-script')</SCRIPT>
  <script><![CDATA[ alert('cdata') ]]></script>
  <style>rect { fill: url(http://evil.example/style.png); }</style>
  <text x="1" y="10">&lol3;</text>
  <a href="javascript:alert('a-href')"><rect id="inside-a" width="5" height="5"/></a>
  <use href="javascript:alert('use-href')"/>
  <use xlink:href="jav&#x61;script:alert('use-entity')"/>
  <use href="http://evil.example/sprite.svg#icon"/>
  <foreignObject width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><iframe src="http://evil.example"></iframe>html-content</div></foreignObject>
  <image href="http://evil.example/track.png" width="10" height="10"/>
  <image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" width="10" height="10"/>
  <iframe src="http://evil.example/frame"></iframe>
  <animate attributeName="href" to="javascript:alert('animate')"/>
  <set attributeName="onmouseover" to="alert('set')"/>
  <rect id="ok" x="10" y="10" width="20" height="20" fill="#ff0000" onclick="alert('click')"
    style="fill: url(http://evil.example/x); stroke: blue; background: expression(alert('expr')); stroke-width: 2"/>
  <circle cx="50" cy="50" r="10" fill="url( 'http://evil.example/grad' )" stroke="#00ff00"/>
  <path d="M0 0 L10 10" stroke="black" filter="url(#f)" fill="java&#x0A;script:alert('newline')"/>
  <rect width="1" height="1" style="fill:red;behavior:url(evil.htc);-moz-binding:url(http://evil.example/xbl)"/>
  <rect width="2" height="2" style="fill:\\72 ed" mask="url(#m)"/>
  <g onmouseover="alert('g')"><ellipse cx="5" cy="5" rx="2" ry="3" fill="teal"/></g>
</svg>`;

  const clean = sanitizeSvg(malicious);

  it('removes every dangerous construct', () => {
    for (const needle of [
      'alert',
      'script',
      'onload',
      'onclick',
      'onmouseover',
      'javascript',
      'evil',
      'ENTITY',
      'DOCTYPE',
      'lollol',
      'foreignObject',
      'iframe',
      'html-content',
      '<style',
      '<a',
      'animate',
      '<set',
      'expression',
      'behavior',
      'binding',
      'data:image/svg',
      'filter',
      '\\',
    ]) {
      expect(clean.toLowerCase(), needle).not.toContain(needle.toLowerCase());
    }
  });

  it('keeps benign shapes and safe styling', () => {
    expect(clean.startsWith(`<svg ${NS}`)).toBe(true);
    expect(clean).toContain(
      '<rect id="ok" x="10" y="10" width="20" height="20" fill="#ff0000" style="stroke:blue;stroke-width:2"/>',
    );
    expect(clean).toContain('<circle cx="50" cy="50" r="10" stroke="#00ff00"/>');
    expect(clean).toContain('<path d="M0 0 L10 10" stroke="black"/>');
    expect(clean).toContain('<rect width="2" height="2" mask="url(#m)"/>');
    expect(clean).toContain('<ellipse cx="5" cy="5" rx="2" ry="3" fill="teal"/>');
    expect(clean).toContain('<text x="1" y="10">&amp;lol3;</text>');
    expect(clean).toContain('style="fill:red"');
  });

  it('keeps local references and safe raster data URLs', () => {
    const out = sanitizeSvg(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><rect id="r" width="1" height="1"/></defs>' +
          '<use xlink:href="#r" x="5"/><rect width="3" height="3" fill="url(#g)"/>' +
          '<image href="data:image/png;base64,iVBORw0KGgo=" width="4" height="4"/>',
        'xmlns:xlink="http://www.w3.org/1999/xlink"',
      ),
    );
    expect(out).toContain('<use xlink:href="#r" x="5"/>');
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain(
      '<image href="data:image/png;base64,iVBORw0KGgo=" width="4" height="4"/>',
    );
  });

  it('escapes text content and attribute values', () => {
    const out = sanitizeSvg(
      svg('<text id="a&quot;b">1 &lt; 2 &amp; <![CDATA[<b>]]></text><title>T&amp;C</title>'),
    );
    expect(out).toContain('<text id="a&quot;b">1 &lt; 2 &amp; &lt;b&gt;</text>');
    expect(out).toContain('<title>T&amp;C</title>');
  });

  it('canonicalizes names and forces the SVG namespace', () => {
    const out = sanitizeSvg(
      '<SVG xmlns="http://evil.example" VIEWBOX="0 0 10 10"><RECT WIDTH="1" HEIGHT="1"/></SVG>',
    );
    expect(out).toBe(`<svg ${NS} viewBox="0 0 10 10"><rect width="1" height="1"/></svg>`);
  });

  it('throws without an svg root or when too large', () => {
    expect(() => sanitizeSvg('<html><svg></svg></html>')).toThrow(/missing <svg>/);
    expect(() => sanitizeSvg('just text')).toThrow(/missing <svg>/);
    expect(() => sanitizeSvg(`<svg>${' '.repeat(5 * 1024 * 1024)}</svg>`)).toThrow(/too large/);
  });

  it('sanitizes style declarations', () => {
    expect(sanitizeStyleAttribute('fill: red; stroke: url(#a); color: blue')).toBe(
      'fill:red;stroke:url(#a);color:blue',
    );
    expect(sanitizeStyleAttribute('fill: url("#a")')).toBe('fill:url("#a")');
    expect(sanitizeStyleAttribute('fill: url(https://x)')).toBeNull();
    expect(sanitizeStyleAttribute('fill: ex/**/pression(1)')).toBeNull();
    expect(sanitizeStyleAttribute('@import "x"; fill: red')).toBe('fill:red');
    expect(sanitizeStyleAttribute('position: fixed')).toBeNull();
  });

  it('builds a UTF-8 safe base64 data URL of the sanitized markup', () => {
    const url = svgToDataUrl(
      svg('<text x="0" y="10">h\u00e9llo \u2713 \u{1F600}</text><script>x()</script>'),
    );
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const decoded = Buffer.from(url.slice('data:image/svg+xml;base64,'.length), 'base64').toString(
      'utf8',
    );
    expect(decoded).toContain('h\u00e9llo \u2713 \u{1F600}');
    expect(decoded).not.toContain('script');
  });
});

describe('importSvgAsElements', () => {
  it('converts rectangles, rounded rectangles, circles and ellipses', () => {
    const { elements, issues } = importSvgAsElements(
      svg(
        '<rect x="10" y="20" width="30" height="40" fill="#ff0000"/>' +
          '<rect x="0" y="0" width="10" height="10" rx="3" fill="none" stroke="blue"/>' +
          '<circle cx="50" cy="50" r="10" fill="green"/>' +
          '<ellipse cx="100" cy="50" rx="20" ry="10" fill="rgb(1, 2, 3)"/>',
      ),
    );
    expect(issues).toEqual([]);
    expect(elements.map((e) => e.type)).toEqual(['rectangle', 'rectangle', 'ellipse', 'ellipse']);
    expect(elements[0]).toMatchObject({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      backgroundColor: '#ff0000',
      strokeColor: 'transparent',
      roundness: 'sharp',
      roughness: 0,
      fillStyle: 'solid',
      opacity: 100,
    });
    expect(elements[1]).toMatchObject({
      roundness: 'round',
      backgroundColor: 'transparent',
      strokeColor: 'blue',
      strokeWidth: 1,
    });
    expect(elements[2]).toMatchObject({
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      backgroundColor: 'green',
    });
    expect(elements[3]).toMatchObject({
      x: 80,
      y: 40,
      width: 40,
      height: 20,
      backgroundColor: 'rgb(1, 2, 3)',
    });
  });

  it('groups multiple elements and assigns ascending indices', () => {
    const { elements } = importSvgAsElements(
      svg('<rect width="1" height="1"/><rect width="2" height="2"/><rect width="3" height="3"/>'),
    );
    const groupId = elements[0]!.groupIds[0];
    expect(groupId).toBeTruthy();
    for (const el of elements) expect(el.groupIds).toEqual([groupId]);
    expect(new Set(elements.map((e) => e.id)).size).toBe(3);
    expect(elements[0]!.index < elements[1]!.index && elements[1]!.index < elements[2]!.index).toBe(
      true,
    );
    expect(importOne('<rect width="1" height="1"/>').groupIds).toEqual([]);
  });

  it('converts lines, polylines and polygons', () => {
    const { elements } = importSvgAsElements(
      svg(
        '<line x1="5" y1="5" x2="15" y2="25" stroke="#000"/>' +
          '<polyline points="0,0 10,0 10,10" fill="none" stroke="blue"/>' +
          '<polygon points="0,0 10,0 5,10" fill="green"/>',
      ),
    );
    const [line, polyline, polygon] = elements;
    expect(line).toMatchObject({
      type: 'line',
      x: 5,
      y: 5,
      width: 10,
      height: 20,
      closed: false,
      strokeColor: '#000',
      backgroundColor: 'transparent',
    });
    expect(line!.type === 'line' && line!.points).toEqual([
      [0, 0],
      [10, 20],
    ]);
    expect(polyline).toMatchObject({ type: 'line', closed: false, width: 10, height: 10 });
    expect(polyline!.type === 'line' && polyline!.points).toHaveLength(3);
    expect(polygon).toMatchObject({
      type: 'line',
      closed: true,
      backgroundColor: 'green',
      strokeColor: 'transparent',
    });
    expect(polygon!.type === 'line' && polygon!.points).toEqual([
      [0, 0],
      [10, 0],
      [5, 10],
    ]);
  });

  it('samples paths with curves, arcs and multiple subpaths', () => {
    const { elements } = importSvgAsElements(
      svg(
        '<path d="M0 0 C 10 0 10 10 0 10 Z M 20 0 h 10 v 10" fill="none" stroke="#333" stroke-width="3"/>',
      ),
    );
    expect(elements).toHaveLength(2);
    const [curve, open] = elements;
    if (curve!.type !== 'line' || open!.type !== 'line') throw new Error('expected lines');
    expect(curve!.closed).toBe(true);
    expect(curve!.points).toHaveLength(13);
    expect(curve).toMatchObject({
      x: 0,
      y: 0,
      width: 7.5,
      height: 10,
      strokeWidth: 3,
      strokeColor: '#333',
    });
    expect(open).toMatchObject({ x: 20, y: 0, width: 10, height: 10, closed: false });
    expect(open!.points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    // Filled open subpaths are closed (SVG fills them implicitly); arcs are sampled.
    const arc = importOne('<path d="M0 50 A 50 50 0 0 1 100 50" fill="#123456"/>');
    expect(arc).toMatchObject({
      type: 'line',
      closed: true,
      backgroundColor: '#123456',
      width: 100,
    });
    expect(arc.y).toBeCloseTo(0, 5);
    expect(arc.height).toBeCloseTo(50, 5);
  });

  it('converts text with font mapping, anchors and tspans', () => {
    const { elements } = importSvgAsElements(
      svg(
        '<text x="10" y="30" font-size="20" font-family="Menlo, monospace" fill="#222">Hi  there</text>' +
          '<text x="100" y="50" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-style="italic">Mid</text>' +
          '<text x="0" y="100" font-family="cursive" font-size="10">First<tspan x="0" dy="20">Second</tspan></text>',
      ),
    );
    expect(elements.map((e) => (e.type === 'text' ? e.text : e.type))).toEqual([
      'Hi there',
      'Mid',
      'First',
      'Second',
    ]);
    const [a, b, c, d] = elements;
    if (a!.type !== 'text' || b!.type !== 'text' || c!.type !== 'text' || d!.type !== 'text')
      throw new Error('expected text');
    expect(a).toMatchObject({
      fontFamily: 'mono',
      fontSize: 20,
      textAlign: 'left',
      x: 10,
      strokeColor: '#222',
      autoResize: true,
    });
    // Baseline 30 − (ascent 0.8 + half leading 0.125) × 20.
    expect(a!.y).toBeCloseTo(11.5, 5);
    expect(a!.width).toBeGreaterThan(0);
    expect(b).toMatchObject({
      fontFamily: 'serif',
      fontWeight: 'bold',
      fontStyle: 'italic',
      textAlign: 'center',
      strokeColor: '#000000',
    });
    expect(b!.x + b!.width / 2).toBeCloseTo(100, 5);
    expect(c).toMatchObject({ fontFamily: 'hand', fontSize: 10, x: 0 });
    expect(d!.y - c!.y).toBeCloseTo(20, 5);
    for (const el of elements) expect(validateElement(el).success).toBe(true);
  });

  it('applies group translate + scale and scales stroke widths', () => {
    const el = importOne(
      '<g transform="translate(100,50) scale(2)"><rect x="5" y="5" width="10" height="10" stroke="#000" stroke-width="2" fill="none"/></g>',
    );
    expect(el).toMatchObject({
      type: 'rectangle',
      x: 110,
      y: 60,
      width: 20,
      height: 20,
      strokeWidth: 4,
      backgroundColor: 'transparent',
    });
  });

  it('turns rotations into angles', () => {
    const el = importOne(
      '<rect x="0" y="0" width="20" height="10" transform="rotate(90 10 5)" fill="red"/>',
    );
    expect(el.type).toBe('rectangle');
    expect(el.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(el.x).toBeCloseTo(0, 9);
    expect(el.y).toBeCloseTo(0, 9);
    expect(el).toMatchObject({ width: 20, height: 10 });

    const nested = importOne(
      '<g transform="translate(50 50)"><g transform="rotate(45)"><ellipse rx="10" ry="5" transform="scale(2)" fill="blue"/></g></g>',
    );
    expect(nested.type).toBe('ellipse');
    expect(nested.angle).toBeCloseTo(Math.PI / 4, 9);
    expect(nested).toMatchObject({ x: 30, y: 40, width: 40, height: 20 });
  });

  it('applies matrix transforms, converting skews to polygons', () => {
    const scaled = importOne(
      '<rect width="10" height="5" transform="matrix(2 0 0 3 10 20)" fill="red"/>',
    );
    expect(scaled).toMatchObject({ type: 'rectangle', x: 10, y: 20, width: 20, height: 15 });

    const skewed = importOne(
      '<rect width="20" height="10" transform="matrix(1 0 0.5 1 0 0)" fill="red"/>',
    );
    expect(skewed).toMatchObject({
      type: 'line',
      closed: true,
      x: 0,
      y: 0,
      width: 25,
      height: 10,
      backgroundColor: 'red',
    });
    expect(skewed.type === 'line' && skewed.points).toEqual([
      [0, 0],
      [20, 0],
      [25, 10],
      [5, 10],
    ]);

    const flipped = importOne(
      '<rect x="0" y="0" width="10" height="10" transform="scale(-1, 1)" fill="red"/>',
    );
    expect(flipped).toMatchObject({ type: 'rectangle', x: -10, y: 0, width: 10, height: 10 });

    const skewedEllipse = importOne(
      '<ellipse cx="0" cy="0" rx="10" ry="5" transform="skewX(30)" fill="red"/>',
    );
    expect(skewedEllipse).toMatchObject({ type: 'line', closed: true });
  });

  it('scales the root viewBox to the viewport', () => {
    const el = importOne(
      '<rect x="10" y="10" width="10" height="10"/>',
      'viewBox="0 0 50 50" width="100" height="100"',
    );
    expect(el).toMatchObject({ x: 20, y: 20, width: 20, height: 20, backgroundColor: '#000000' });
    const meet = importOne(
      '<rect x="0" y="0" width="10" height="10"/>',
      'viewBox="0 0 100 50" width="100" height="100"',
    );
    expect(meet).toMatchObject({ x: 0, y: 25, width: 10, height: 10 });
    const offset = importOne(
      '<rect x="10" y="10" width="10" height="10"/>',
      'viewBox="10 10 20 20"',
    );
    expect(offset).toMatchObject({ x: 0, y: 0, width: 10, height: 10 });
    const none = importOne(
      '<rect x="0" y="0" width="10" height="10"/>',
      'viewBox="0 0 10 10" width="100" height="50" preserveAspectRatio="none"',
    );
    expect(none).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('inherits fill, stroke and opacity and lets style override attributes', () => {
    const { elements } = importSvgAsElements(
      svg(
        '<g fill="#00ff00" stroke="#0000ff" opacity="0.5">' +
          '<rect width="10" height="10" opacity="0.5"/>' +
          '<rect width="10" height="10" fill="#abcdef" style="fill: #123456; stroke-dasharray: 4 2"/>' +
          '<g stroke="none" fill-opacity="0.4"><circle r="5" cx="5" cy="5"/></g>' +
          '</g>' +
          '<rect width="5" height="5" fill="currentColor"/>',
      ),
    );
    const [a, b, c, d] = elements;
    expect(a).toMatchObject({ backgroundColor: '#00ff00', strokeColor: '#0000ff', opacity: 25 });
    expect(b).toMatchObject({
      backgroundColor: '#123456',
      strokeColor: '#0000ff',
      strokeStyle: 'dashed',
      opacity: 50,
    });
    expect(c).toMatchObject({
      type: 'ellipse',
      backgroundColor: '#00ff00',
      strokeColor: 'transparent',
      opacity: 20,
    });
    expect(d).toMatchObject({ backgroundColor: '#1e1e1e' });
  });

  it('resolves gradients to a solid color', () => {
    const { elements } = importSvgAsElements(
      svg(
        '<defs><linearGradient id="base"><stop offset="0" style="stop-color:#abcdef"/><stop offset="1" stop-color="#000"/></linearGradient>' +
          '<radialGradient id="ref" href="#base"/></defs>' +
          '<rect width="1" height="1" fill="url(#base)"/>' +
          '<rect width="1" height="1" fill="url(#ref)"/>' +
          '<rect width="1" height="1" fill="url(#missing)"/>' +
          '<rect width="1" height="1" fill="url(#missing) #ff00ff"/>',
      ),
    );
    expect(elements.map((e) => e.backgroundColor)).toEqual([
      '#abcdef',
      '#abcdef',
      '#868e96',
      '#ff00ff',
    ]);
  });

  it('expands <use> references and guards against recursion', () => {
    const { elements } = importSvgAsElements(
      svg(
        '<defs><rect id="r" width="10" height="10" fill="red"/>' +
          '<symbol id="s" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="blue"/></symbol></defs>' +
          '<use href="#r" x="5" y="5"/><use href="#r" x="50"/>' +
          '<use href="#s" x="100" y="0" width="20" height="20"/>',
      ),
    );
    expect(elements.map((e) => [e.type, e.x, e.y, e.width])).toEqual([
      ['rectangle', 5, 5, 10],
      ['rectangle', 50, 0, 10],
      ['ellipse', 100, 0, 20],
    ]);

    const recursive = importSvgAsElements(
      svg('<g id="a"><rect width="1" height="1"/><use href="#a"/></g>'),
    );
    expect(recursive.elements).toHaveLength(1);
    expect(recursive.issues.join()).toMatch(/recursive/);

    // Exponential <use> fan-out is bounded by the depth and element limits.
    let bomb = '<defs><rect id="l0" width="1" height="1"/>';
    for (let i = 1; i <= 12; i++)
      bomb += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`;
    bomb += '</defs><use href="#l12"/>';
    const started = Date.now();
    const bombed = importSvgAsElements(svg(bomb));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(bombed.elements.length).toBeLessThanOrEqual(2000);
  });

  it('caps the number of elements', () => {
    const { elements, issues } = importSvgAsElements(
      svg('<rect width="1" height="1"/>'.repeat(10)),
      { maxElements: 3 },
    );
    expect(elements).toHaveLength(3);
    expect(issues.join()).toMatch(/only the first 3/);
  });

  it('ignores hidden, invisible and non-rendering content and reports unsupported elements', () => {
    const { elements, issues } = importSvgAsElements(
      svg(
        '<rect width="1" height="1" display="none"/>' +
          '<g style="display:none"><rect width="1" height="1"/></g>' +
          '<rect width="1" height="1" visibility="hidden"/>' +
          '<rect width="1" height="1" fill="none"/>' +
          '<rect width="0" height="10"/>' +
          '<clipPath id="c"><rect width="1" height="1"/></clipPath>' +
          '<mask id="m"><rect width="1" height="1"/></mask>' +
          '<image href="data:image/png;base64,iVBORw0KGgo=" width="4" height="4"/>' +
          '<path d="M 0 0 L" stroke="red"/>' +
          '<rect x="7" width="1" height="1"/>',
      ),
    );
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ x: 7 });
    expect(issues.join('\n')).toMatch(/bitmap/);
    expect(issues.join('\n')).toMatch(/malformed/);
  });

  it('never lets dangerous content through and produces valid elements only', () => {
    const { elements } = importSvgAsElements(
      svg(
        '<script>alert(1)</script><foreignObject><rect width="9" height="9"/></foreignObject><rect width="3" height="3" fill="red" onclick="x()"/>',
      ),
    );
    expect(elements).toHaveLength(1);
    for (const el of elements) expect(validateElement(el).success).toBe(true);
    expect(JSON.stringify(elements)).not.toMatch(/alert|onclick/);
  });

  it('caps points per element at MAX_POINTS', () => {
    const coords = Array.from(
      { length: 60_000 },
      (_, i) => `${i % 1000},${Math.floor(i / 1000)}`,
    ).join(' ');
    const { elements, issues } = importSvgAsElements(
      svg(`<polyline points="${coords}" fill="none" stroke="red"/>`),
    );
    const line = only(elements);
    expect(line.type === 'line' && line.points.length).toBeLessThanOrEqual(50_000);
    expect(issues.join()).toMatch(/simplified/);
  });
});
