import type { FileMetadata, FrameElement, SceneElement } from '@inkflow/elements';
import {
  rectToBounds,
  rotatedRectCorners,
  rotatedRectBounds,
  type Path,
  type Rect,
} from '@inkflow/geometry';
import {
  DrawableCache,
  FRAME_NAME_COLOR,
  FRAME_NAME_FONT_SIZE,
  FRAME_NAME_GAP,
  frameTitleHeight,
  planRender,
  type DrawLayer,
  type ImageLayer,
  type ShapeLayer,
  type TextLayer,
} from '@inkflow/renderer';
import { orderedFrames } from '@inkflow/scene';
import { GState, jsPDF } from 'jspdf';
import { elementsForExport, getExportBounds } from './bounds';
import { darkModeColor, parseColor, type Rgba } from './color';
import { canvasToPngBlob, defaultCreateCanvas, exportToCanvas } from './raster';
import type { ExportCanvas, ExportScope, RasterExportOptions } from './types';

export type PdfExportOptions = RasterExportOptions & {
  mode: 'raster' | 'vector';
  pages: 'single' | 'frames';
  /** Presentation order of frames (defaults to `appState.frameOrder`). */
  frameOrder?: string[];
};

/** PDF points per world unit (world units are CSS pixels at 96 dpi). */
const PT_PER_UNIT = 0.75;
/** Largest page side allowed by the PDF specification (200 inches). */
const MAX_PAGE_PT = 14_400;

interface PageSpec {
  bounds: Rect;
  elements: SceneElement[];
  frameId: string | null;
  showFrameNames: boolean;
}

interface PreparedImage {
  data: string | Uint8Array;
  format: 'PNG' | 'JPEG';
  alias: string;
}

function pagesFor(scope: ExportScope, options: PdfExportOptions): PageSpec[] {
  if (options.pages === 'frames') {
    const frames = scope.elements.filter(
      (e): e is FrameElement => e.type === 'frame' && !e.isDeleted && !e.hidden,
    );
    const ordered = orderedFrames(frames, options.frameOrder ?? scope.appState.frameOrder);
    if (ordered.length > 0) {
      return ordered.map((frame) => {
        const b = rotatedRectBounds(
          { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          frame.angle,
        );
        return {
          bounds: { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY },
          elements: elementsForExport(scope, frame.id),
          frameId: frame.id,
          showFrameNames: false,
        };
      });
    }
  }
  return [
    {
      bounds: getExportBounds(scope, options),
      elements: elementsForExport(scope, options.frameId),
      frameId: options.frameId ?? null,
      showFrameNames: !options.frameId && !options.bounds,
    },
  ];
}

function pageSize(bounds: Rect): { k: number; w: number; h: number } {
  let k = PT_PER_UNIT;
  const w = Math.max(1, bounds.width);
  const h = Math.max(1, bounds.height);
  k = Math.min(k, MAX_PAGE_PT / w, MAX_PAGE_PT / h);
  return { k, w: Math.max(3, w * k), h: Math.max(3, h * k) };
}

const orientation = (w: number, h: number): 'l' | 'p' => (w > h ? 'l' : 'p');

async function canvasDataUrl(canvas: ExportCanvas): Promise<string | Uint8Array> {
  const html = canvas as HTMLCanvasElement;
  if (typeof html.toDataURL === 'function') return html.toDataURL('image/png');
  const blob = await canvasToPngBlob(canvas);
  return new Uint8Array(await blob.arrayBuffer());
}

async function prepareImages(
  elements: readonly SceneElement[],
  files: Record<string, FileMetadata>,
  options: PdfExportOptions,
): Promise<Map<string, PreparedImage>> {
  const out = new Map<string, PreparedImage>();
  const ids = new Set<string>();
  for (const el of elements) if (el.type === 'image' && el.fileId) ids.add(el.fileId);
  let n = 0;
  await Promise.all(
    [...ids].map(async (id) => {
      const file = files[id];
      if (!file) return;
      const alias = `img${++n}`;
      const url = file.url;
      if (/^data:image\/png[;,]/i.test(url))
        return void out.set(id, { data: url, format: 'PNG', alias });
      if (/^data:image\/jpe?g[;,]/i.test(url))
        return void out.set(id, { data: url, format: 'JPEG', alias });
      try {
        const img = await options.loadImage(file);
        const w = Math.max(1, Math.round(file.width || 1));
        const h = Math.max(1, Math.round(file.height || 1));
        const canvas = (options.createCanvas ?? defaultCreateCanvas)(w, h);
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        out.set(id, { data: await canvasDataUrl(canvas), format: 'PNG', alias });
      } catch {
        // Unavailable images are drawn as placeholders.
      }
    }),
  );
  return out;
}

/** Standard PDF font closest to each family. */
function pdfFont(layer: TextLayer): [string, string] {
  const name =
    layer.fontFamilyKey === 'serif'
      ? 'times'
      : layer.fontFamilyKey === 'mono'
        ? 'courier'
        : 'helvetica';
  const bold = layer.fontWeight === 'bold';
  const italic = layer.fontStyle === 'italic';
  return [name, bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal'];
}

const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Standard fonts only cover WinAnsi; other characters are replaced. */
function pdfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out +=
      (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)
        ? ch
        : code === 0x09
          ? ' '
          : '?';
  }
  return out;
}

class PdfPainter {
  private readonly gstates = new Map<string, GState>();
  private readonly cache = new DrawableCache();

  constructor(
    private readonly doc: jsPDF,
    private readonly dark: boolean,
    private readonly images: Map<string, PreparedImage>,
    private readonly getElement: (id: string) => SceneElement | undefined,
  ) {}

  private color(c: string): Rgba | null {
    const parsed = parseColor(c);
    if (!parsed || parsed.a <= 0) return null;
    return this.dark ? darkModeColor(parsed) : parsed;
  }

  private alpha(a: number): void {
    const key = (Math.round(Math.max(0, Math.min(1, a)) * 100) / 100).toFixed(2);
    let gs = this.gstates.get(key);
    if (!gs) {
      gs = new GState({ opacity: Number(key), 'stroke-opacity': Number(key) });
      this.gstates.set(key, gs);
    }
    this.doc.setGState(gs);
  }

  private trace(path: Path): boolean {
    let any = false;
    for (const c of path) {
      switch (c.type) {
        case 'M':
          this.doc.moveTo(c.x, c.y);
          any = true;
          break;
        case 'L':
          this.doc.lineTo(c.x, c.y);
          break;
        case 'C':
          this.doc.curveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
          break;
        case 'Z':
          this.doc.close();
          break;
      }
    }
    return any;
  }

  fillRect(rect: Rect, color: string): void {
    const c = this.color(color);
    if (!c) return;
    this.alpha(c.a);
    this.doc.setFillColor(c.r, c.g, c.b);
    this.doc.rect(rect.x, rect.y, rect.width, rect.height, 'F');
  }

  private shape(layer: ShapeLayer, alpha: number): void {
    const a = alpha * (layer.alpha ?? 1);
    for (const set of layer.sets) {
      if (set.type === 'fill') {
        const c = layer.fill ? this.color(layer.fill) : null;
        if (!c || !this.trace(set.path)) continue;
        this.alpha(a * c.a);
        this.doc.setFillColor(c.r, c.g, c.b);
        if (layer.fillRule === 'evenodd') this.doc.fillEvenOdd();
        else this.doc.fill();
      } else if (set.type === 'fillSketch') {
        const c = layer.sketch ? this.color(layer.sketch.color) : null;
        if (!c || !layer.sketch || !this.trace(set.path)) continue;
        this.alpha(a * c.a);
        this.doc.setDrawColor(c.r, c.g, c.b);
        this.doc.setLineWidth(layer.sketch.width);
        this.doc.setLineCap('round');
        this.doc.setLineJoin('round');
        this.doc.setLineDashPattern([], 0);
        this.doc.stroke();
      } else {
        const s = layer.stroke;
        const c = s ? this.color(s.color) : null;
        if (!s || !c || !this.trace(set.path)) continue;
        this.alpha(a * c.a);
        this.doc.setDrawColor(c.r, c.g, c.b);
        this.doc.setLineWidth(s.width);
        this.doc.setLineCap(s.cap);
        this.doc.setLineJoin(s.join);
        this.doc.setLineDashPattern(s.dash ?? [], 0);
        this.doc.stroke();
      }
    }
  }

  private text(layer: TextLayer, alpha: number): void {
    const c = this.color(layer.color);
    if (!c || layer.runs.length === 0) return;
    const [font, style] = pdfFont(layer);
    this.alpha(alpha * (layer.alpha ?? 1) * c.a);
    this.doc.setFont(font, style);
    this.doc.setFontSize(layer.fontSize);
    this.doc.setTextColor(c.r, c.g, c.b);
    this.doc.setCharSpace(layer.letterSpacing);
    for (const run of layer.runs) {
      const text = pdfText(run.text);
      if (!text) continue;
      this.doc.text(text, run.x, run.y, { align: layer.align, baseline: 'middle' });
      if (layer.decoration !== 'none') {
        const w =
          this.doc.getTextWidth(text) + Math.max(0, [...text].length - 1) * layer.letterSpacing;
        const left =
          layer.align === 'center' ? run.x - w / 2 : layer.align === 'right' ? run.x - w : run.x;
        const y =
          run.y +
          (layer.decoration === 'underline' ? layer.fontSize * 0.45 : layer.fontSize * 0.05);
        this.doc.setDrawColor(c.r, c.g, c.b);
        this.doc.setLineWidth(Math.max(1, layer.fontSize / 16));
        this.doc.setLineDashPattern([], 0);
        this.doc.setLineCap('butt');
        this.doc.moveTo(left, y);
        this.doc.lineTo(left + w, y);
        this.doc.stroke();
      }
    }
    this.doc.setCharSpace(0);
  }

  private image(layer: ImageLayer, alpha: number): void {
    const prepared = layer.fileId ? this.images.get(layer.fileId) : undefined;
    const { x, y, width: w, height: h } = layer;
    if (!prepared) {
      this.alpha(alpha);
      this.fillRect({ x, y, width: w, height: h }, '#f1f3f5');
      return;
    }
    const natW = layer.naturalWidth > 0 ? layer.naturalWidth : w;
    const natH = layer.naturalHeight > 0 ? layer.naturalHeight : h;
    const crop = layer.crop ?? { x: 0, y: 0, width: natW, height: natH };
    const sx = crop.width > 0 ? w / crop.width : 1;
    const sy = crop.height > 0 ? h / crop.height : 1;
    const d = this.doc;
    d.saveGraphicsState();
    d.rect(x, y, w, h, null);
    d.clip();
    d.discardPath();
    if (layer.flipX || layer.flipY) {
      d.setCurrentTransformationMatrix(
        d.Matrix(
          layer.flipX ? -1 : 1,
          0,
          0,
          layer.flipY ? -1 : 1,
          layer.flipX ? 2 * x + w : 0,
          layer.flipY ? 2 * y + h : 0,
        ),
      );
    }
    this.alpha(alpha);
    d.addImage(
      prepared.data as string,
      prepared.format,
      x - crop.x * sx,
      y - crop.y * sy,
      natW * sx,
      natH * sy,
      prepared.alias,
      'FAST',
    );
    d.restoreGraphicsState();
  }

  layers(layers: readonly DrawLayer[], alpha: number): void {
    for (const layer of layers) {
      switch (layer.kind) {
        case 'shape':
          this.shape(layer, alpha);
          break;
        case 'text':
          this.text(layer, alpha);
          break;
        case 'image':
          this.image(layer, alpha);
          break;
        case 'group':
          this.doc.saveGraphicsState();
          if (layer.clip && this.trace(layer.clip.path)) {
            this.doc.clip(layer.clip.rule === 'evenodd' ? 'evenodd' : undefined);
            this.doc.discardPath();
          }
          this.layers(layer.children, alpha * (layer.alpha ?? 1));
          this.doc.restoreGraphicsState();
          break;
      }
    }
  }

  private transform(el: Pick<SceneElement, 'x' | 'y' | 'width' | 'height' | 'angle'>): void {
    const d = this.doc;
    if (!el.angle) {
      d.setCurrentTransformationMatrix(d.Matrix(1, 0, 0, 1, el.x, el.y));
      return;
    }
    const cos = Math.cos(el.angle);
    const sin = Math.sin(el.angle);
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const e = cx + (-el.width / 2) * cos - (-el.height / 2) * sin;
    const f = cy + (-el.width / 2) * sin + (-el.height / 2) * cos;
    d.setCurrentTransformationMatrix(d.Matrix(cos, sin, -sin, cos, e, f));
  }

  element(el: SceneElement): void {
    if (el.isDeleted || el.hidden) return;
    const opacity = Math.max(0, Math.min(100, el.opacity)) / 100;
    if (opacity <= 0) return;
    const drawable = this.cache.get(el);
    this.doc.saveGraphicsState();
    this.transform(el);
    this.layers(drawable.layers, opacity);
    this.layers(drawable.labelLayers, opacity);
    this.doc.restoreGraphicsState();
  }

  frameName(frame: FrameElement): void {
    if (!frame.name) return;
    const c = this.color(FRAME_NAME_COLOR);
    if (!c) return;
    this.doc.saveGraphicsState();
    this.transform(frame);
    this.alpha(1);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(FRAME_NAME_FONT_SIZE);
    this.doc.setTextColor(c.r, c.g, c.b);
    this.doc.text(pdfText(frame.name), 0, -FRAME_NAME_GAP, {
      baseline: 'bottom',
      maxWidth: frame.width,
    });
    this.doc.restoreGraphicsState();
  }

  clipToFrame(frame: FrameElement): void {
    const corners = rotatedRectCorners(
      { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      frame.angle,
    );
    this.doc.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) this.doc.lineTo(corners[i]!.x, corners[i]!.y);
    this.doc.close();
    this.doc.clip();
    this.doc.discardPath();
  }

  page(page: PageSpec, k: number, background: string | null): void {
    const d = this.doc;
    const b = page.bounds;
    d.saveGraphicsState();
    d.setCurrentTransformationMatrix(d.Matrix(k, 0, 0, k, -b.x * k, -b.y * k));
    d.rect(b.x, b.y, b.width, b.height, null);
    d.clip();
    d.discardPath();
    if (background) this.fillRect(b, background);
    const plan = planRender(page.elements, {
      getElement: this.getElement,
      view: rectToBounds(b),
      frameTitleHeight: page.showFrameNames ? frameTitleHeight(1) : 0,
    });
    for (const frame of plan.frames) this.element(frame);
    let i = 0;
    while (i < plan.content.length) {
      const el = plan.content[i]!;
      const clip = plan.clipFrames.get(el.id);
      if (!clip) {
        this.element(el);
        i++;
        continue;
      }
      d.saveGraphicsState();
      this.clipToFrame(clip);
      while (i < plan.content.length && plan.clipFrames.get(plan.content[i]!.id) === clip) {
        this.element(plan.content[i]!);
        i++;
      }
      d.restoreGraphicsState();
    }
    if (page.showFrameNames) for (const frame of plan.frames) this.frameName(frame);
    d.restoreGraphicsState();
  }
}

/**
 * PDF export with jsPDF. `pages: 'frames'` → one page per frame in presentation order, sized to the
 * frame. `mode: 'raster'` embeds a high-resolution PNG per page; `mode: 'vector'` draws the same
 * hand-drawn op sets as vector paths (moveTo/lineTo/curveTo, fill/stroke, dash, opacity through
 * graphics states), text with the closest standard PDF font, and images embedded.
 */
export async function exportToPdfBlob(
  scope: ExportScope,
  options: PdfExportOptions,
): Promise<Blob> {
  const pages = pagesFor(scope, options);
  const sizes = pages.map((p) => pageSize(p.bounds));
  const first = sizes[0]!;
  const doc = new jsPDF({
    unit: 'pt',
    format: [first.w, first.h],
    orientation: orientation(first.w, first.h),
    compress: true,
  });
  doc.setProperties({ title: 'Inkflow export', creator: 'Inkflow' });
  const background = options.background ? scope.appState.viewBackgroundColor : null;

  if (options.mode === 'raster') {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      const size = sizes[i]!;
      if (i > 0) doc.addPage([size.w, size.h], orientation(size.w, size.h));
      const canvas = await exportToCanvas(
        { ...scope, elements: page.elements },
        {
          ...options,
          frameId: page.frameId,
          bounds: page.frameId ? null : (options.bounds ?? null),
        },
      );
      const data = await canvasDataUrl(canvas);
      doc.addImage(data as string, 'PNG', 0, 0, size.w, size.h, `page${i}`, 'FAST');
    }
  } else {
    const all = pages.flatMap((p) => p.elements);
    const images = await prepareImages(all, scope.files, options);
    const painter = new PdfPainter(doc, options.darkMode, images, scope.getElement);
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      const size = sizes[i]!;
      if (i > 0) doc.addPage([size.w, size.h], orientation(size.w, size.h));
      doc.advancedAPI(() => painter.page(page, size.k, background));
    }
  }
  const bytes = doc.output('arraybuffer');
  return new Blob([bytes], { type: 'application/pdf' });
}
