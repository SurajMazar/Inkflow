import {
  FONT_FAMILIES,
  getFontString,
  type FrameElement,
  type SceneElement,
} from '@inkflow/elements';
import { rectToBounds, type Path } from '@inkflow/geometry';
import { frameTitleHeight } from '../canvas/scene';
import { FRAME_NAME_COLOR, FRAME_NAME_FONT_SIZE, FRAME_NAME_GAP } from '../canvas/draw';
import { DrawableCache } from '../drawable/generate';
import { truncateText } from '../drawable/text';
import type { DrawLayer, ImageLayer, ShapeLayer, TextLayer } from '../drawable/types';
import { planRender } from '../plan';
import type { SvgRenderOptions } from '../types';

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text and attribute values (also strips characters that are invalid in XML 1.0). */
export function escapeXml(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);
}

const SAFE_COLOR = /^[#a-zA-Z0-9(),.%\s-]{1,64}$/;

function color(c: string): string {
  return SAFE_COLOR.test(c) ? c : '#000000';
}

function num(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

export function pathData(path: Path): string {
  let out = '';
  for (const c of path) {
    switch (c.type) {
      case 'M':
      case 'L':
        out += `${c.type}${num(c.x)} ${num(c.y)}`;
        break;
      case 'C':
        out += `C${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`;
        break;
      case 'Z':
        out += 'Z';
        break;
    }
  }
  return out;
}

const SAFE_IMAGE_URL =
  /^(data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)(;[a-z0-9=.+-]+)*(;base64)?,[a-z0-9+/=%._~:-]*$|https?:\/\/[^\s"'<>]+$)/i;

class SvgWriter {
  private counter = 0;
  readonly defs: string[] = [];

  constructor(
    private readonly prefix: string,
    private readonly options: SvgRenderOptions,
    readonly dark: boolean,
  ) {}

  id(kind: string): string {
    return `${this.prefix}-${kind}-${++this.counter}`;
  }

  clip(path: string, rule: 'nonzero' | 'evenodd', transform?: string): string {
    const id = this.id('clip');
    const t = transform ? ` transform="${transform}"` : '';
    this.defs.push(`<clipPath id="${id}"><path d="${path}" clip-rule="${rule}"${t}/></clipPath>`);
    return id;
  }

  layers(layers: readonly DrawLayer[]): string {
    let out = '';
    for (const layer of layers) {
      switch (layer.kind) {
        case 'shape':
          out += this.shape(layer);
          break;
        case 'text':
          out += this.text(layer);
          break;
        case 'image':
          out += this.image(layer);
          break;
        case 'group': {
          const clip = layer.clip
            ? ` clip-path="url(#${this.clip(pathData(layer.clip.path), layer.clip.rule)})"`
            : '';
          const alpha =
            layer.alpha !== undefined && layer.alpha < 1 ? ` opacity="${num(layer.alpha)}"` : '';
          out += `<g${clip}${alpha}>${this.layers(layer.children)}</g>`;
          break;
        }
      }
    }
    return out;
  }

  private shape(layer: ShapeLayer): string {
    let out = '';
    for (const set of layer.sets) {
      const d = pathData(set.path);
      if (!d) continue;
      if (set.type === 'fill') {
        if (!layer.fill) continue;
        out += `<path d="${d}" fill="${escapeXml(color(layer.fill))}" fill-rule="${layer.fillRule}" stroke="none"/>`;
      } else if (set.type === 'fillSketch') {
        if (!layer.sketch) continue;
        out += `<path d="${d}" fill="none" stroke="${escapeXml(color(layer.sketch.color))}" stroke-width="${num(layer.sketch.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      } else {
        const s = layer.stroke;
        if (!s) continue;
        const dash = s.dash ? ` stroke-dasharray="${s.dash.map(num).join(' ')}"` : '';
        out += `<path d="${d}" fill="none" stroke="${escapeXml(color(s.color))}" stroke-width="${num(s.width)}" stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"${dash}/>`;
      }
    }
    if (layer.alpha !== undefined && layer.alpha < 1 && out)
      return `<g opacity="${num(layer.alpha)}">${out}</g>`;
    return out;
  }

  private text(layer: TextLayer): string {
    if (layer.runs.length === 0) return '';
    const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
    const attrs =
      `font-family="${escapeXml(layer.fontFamilyCss)}" font-size="${num(layer.fontSize)}"` +
      (layer.fontWeight === 'bold' ? ' font-weight="bold"' : '') +
      (layer.fontStyle === 'italic' ? ' font-style="italic"' : '') +
      ` fill="${escapeXml(color(layer.color))}" text-anchor="${anchor}" dominant-baseline="central"` +
      (layer.letterSpacing ? ` letter-spacing="${num(layer.letterSpacing)}"` : '');
    let out = '';
    for (const run of layer.runs) {
      if (!run.text) continue;
      out += `<text x="${num(run.x)}" y="${num(run.y)}" ${attrs} xml:space="preserve">${escapeXml(run.text)}</text>`;
    }
    if (layer.decoration !== 'none') {
      let d = '';
      for (const run of layer.runs) {
        if (run.width <= 0) continue;
        const left =
          layer.align === 'center'
            ? run.x - run.width / 2
            : layer.align === 'right'
              ? run.x - run.width
              : run.x;
        const y =
          run.y +
          (layer.decoration === 'underline' ? layer.fontSize * 0.45 : layer.fontSize * 0.05);
        d += `M${num(left)} ${num(y)}L${num(left + run.width)} ${num(y)}`;
      }
      if (d)
        out += `<path d="${d}" fill="none" stroke="${escapeXml(color(layer.color))}" stroke-width="${num(Math.max(1, layer.fontSize / 16))}"/>`;
    }
    if (layer.alpha !== undefined && layer.alpha < 1 && out)
      return `<g opacity="${num(layer.alpha)}">${out}</g>`;
    return out;
  }

  private image(layer: ImageLayer): string {
    const href = layer.fileId ? this.options.imageData[layer.fileId] : undefined;
    const { x, y, width: w, height: h } = layer;
    if (!href || !SAFE_IMAGE_URL.test(href)) {
      return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="#f1f3f5" stroke="#ced4da" stroke-dasharray="4 3"/>`;
    }
    const meta = layer.fileId ? this.options.files[layer.fileId] : undefined;
    const natW = layer.naturalWidth > 0 ? layer.naturalWidth : (meta?.width ?? w);
    const natH = layer.naturalHeight > 0 ? layer.naturalHeight : (meta?.height ?? h);
    const crop = layer.crop ?? { x: 0, y: 0, width: natW, height: natH };
    const sx = crop.width > 0 ? w / crop.width : 1;
    const sy = crop.height > 0 ? h / crop.height : 1;
    const ix = x - crop.x * sx;
    const iy = y - crop.y * sy;
    const clip = this.clip(
      pathData([
        { type: 'M', x, y },
        { type: 'L', x: x + w, y },
        { type: 'L', x: x + w, y: y + h },
        { type: 'L', x, y: y + h },
        { type: 'Z' },
      ]),
      'nonzero',
    );
    const flip =
      layer.flipX || layer.flipY
        ? ` transform="translate(${num(layer.flipX ? 2 * x + w : 0)} ${num(layer.flipY ? 2 * y + h : 0)}) scale(${layer.flipX ? -1 : 1} ${layer.flipY ? -1 : 1})"`
        : '';
    const filter = this.dark ? ` filter="url(#${this.prefix}-counter)"` : '';
    const safe = escapeXml(href);
    return (
      `<g clip-path="url(#${clip})"><g${flip}>` +
      `<image x="${num(ix)}" y="${num(iy)}" width="${num(natW * sx)}" height="${num(natH * sy)}" preserveAspectRatio="none" href="${safe}" xlink:href="${safe}"${filter}/>` +
      `</g></g>`
    );
  }
}

function elementTransform(el: SceneElement): string {
  const t = `translate(${num(el.x)} ${num(el.y)})`;
  if (!el.angle) return t;
  return `${t} rotate(${num((el.angle * 180) / Math.PI)} ${num(el.width / 2)} ${num(el.height / 2)})`;
}

function frameName(frame: FrameElement, scale: number): string {
  const fontSize = FRAME_NAME_FONT_SIZE / Math.max(1e-3, scale);
  const font = getFontString({
    fontFamily: 'sans',
    fontSize,
    fontWeight: 'normal',
    fontStyle: 'normal',
  });
  const text = truncateText(frame.name, font, frame.width);
  if (!text) return '';
  return (
    `<g transform="${elementTransform(frame)}"><text x="0" y="${num(-FRAME_NAME_GAP / scale)}" font-family="${escapeXml(FONT_FAMILIES.sans.css)}" ` +
    `font-size="${num(fontSize)}" fill="${FRAME_NAME_COLOR}" dominant-baseline="text-after-edge" xml:space="preserve">${escapeXml(text)}</text></g>`
  );
}

const FONT_DATA_URL =
  /^data:(font\/[a-z0-9.+-]+|application\/(font-[a-z0-9.+-]+|x-font-[a-z0-9.+-]+|octet-stream|vnd\.ms-fontobject))(;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=]+$/i;

function fontFaceCss(faces: NonNullable<SvgRenderOptions['fontFaces']>): string {
  let css = '';
  for (const f of faces) {
    const family = f.family.replace(/["'<>&;{}\\]/g, '').trim();
    if (!family || !FONT_DATA_URL.test(f.dataUrl)) continue;
    const weight =
      f.weight && /^[a-z0-9 ]{1,20}$/i.test(f.weight) ? `font-weight:${f.weight};` : '';
    const style = f.style && /^[a-z ]{1,20}$/i.test(f.style) ? `font-style:${f.style};` : '';
    css += `@font-face{font-family:"${family}";src:url(${f.dataUrl});${weight}${style}font-display:block;}`;
  }
  return css;
}

/**
 * Standalone vector SVG of the elements within `bounds`: the same hand-drawn op sets as the
 * canvas renderer as `<path>`s, text as `<text>`, images as `<image href=data:…>`, clip paths for
 * frames/crops/knockouts, `<g transform>` for rotation and flips. All user text is escaped.
 */
export function renderSceneToSvg(
  elements: readonly SceneElement[],
  options: SvgRenderOptions,
): string {
  const { bounds, scale } = options;
  const prefix = (options.idPrefix ?? 'ink').replace(/[^a-zA-Z0-9_-]/g, '') || 'ink';
  const dark = options.theme === 'dark';
  const w = new SvgWriter(prefix, options, dark);
  const cache = new DrawableCache();
  const plan = planRender(elements, {
    getElement: options.getElement,
    view: rectToBounds(bounds),
    frameTitleHeight: options.showFrameNames ? frameTitleHeight(scale) : 0,
  });

  const body: string[] = [];
  if (options.background) {
    body.push(
      `<rect x="${num(bounds.x)}" y="${num(bounds.y)}" width="${num(bounds.width)}" height="${num(bounds.height)}" fill="${escapeXml(color(options.background))}"/>`,
    );
  }
  const elementSvg = (el: SceneElement): string => {
    if (el.isDeleted || el.hidden) return '';
    const opacity = Math.max(0, Math.min(100, el.opacity)) / 100;
    if (opacity <= 0) return '';
    const d = cache.get(el);
    const inner = w.layers(d.layers) + w.layers(d.labelLayers);
    if (!inner) return '';
    const op = opacity < 1 ? ` opacity="${num(opacity)}"` : '';
    return `<g transform="${elementTransform(el)}"${op}>${inner}</g>`;
  };
  for (const frame of plan.frames) body.push(elementSvg(frame));
  let i = 0;
  while (i < plan.content.length) {
    const el = plan.content[i]!;
    const frame = plan.clipFrames.get(el.id);
    if (!frame) {
      body.push(elementSvg(el));
      i++;
      continue;
    }
    const clipPathData = `M0 0L${num(frame.width)} 0L${num(frame.width)} ${num(frame.height)}L0 ${num(frame.height)}Z`;
    const clip = w.clip(clipPathData, 'nonzero', elementTransform(frame));
    let group = '';
    while (i < plan.content.length && plan.clipFrames.get(plan.content[i]!.id) === frame) {
      group += elementSvg(plan.content[i]!);
      i++;
    }
    body.push(`<g clip-path="url(#${clip})">${group}</g>`);
  }
  if (options.showFrameNames) for (const frame of plan.frames) body.push(frameName(frame, scale));

  const defs: string[] = [];
  if (options.fontFaces && options.fontFaces.length > 0) {
    const css = fontFaceCss(options.fontFaces);
    if (css) defs.push(`<style>${css}</style>`);
  }
  if (dark) {
    defs.push(
      `<filter id="${prefix}-dark" filterUnits="userSpaceOnUse" x="${num(bounds.x)}" y="${num(bounds.y)}" width="${num(bounds.width)}" height="${num(bounds.height)}" color-interpolation-filters="sRGB">` +
        `<feComponentTransfer><feFuncR type="linear" slope="-0.86" intercept="0.93"/><feFuncG type="linear" slope="-0.86" intercept="0.93"/><feFuncB type="linear" slope="-0.86" intercept="0.93"/></feComponentTransfer>` +
        `<feColorMatrix type="hueRotate" values="180"/></filter>`,
      `<filter id="${prefix}-counter" color-interpolation-filters="sRGB">` +
        `<feComponentTransfer><feFuncR type="linear" slope="-1" intercept="1"/><feFuncG type="linear" slope="-1" intercept="1"/><feFuncB type="linear" slope="-1" intercept="1"/></feComponentTransfer>` +
        `<feColorMatrix type="hueRotate" values="180"/></filter>`,
    );
  }
  defs.push(...w.defs);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const content = body.join('');
  const wrapped = dark ? `<g filter="url(#${prefix}-dark)">${content}</g>` : content;
  const metadata = options.metadata ? `<metadata>${escapeXml(options.metadata)}</metadata>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ` +
    `width="${width}" height="${height}" viewBox="${num(bounds.x)} ${num(bounds.y)} ${num(bounds.width)} ${num(bounds.height)}">` +
    metadata +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    wrapped +
    `</svg>`
  );
}
