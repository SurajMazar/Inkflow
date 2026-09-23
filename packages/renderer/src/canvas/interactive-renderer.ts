import type { Point, Rect } from '@inkflow/geometry';
import type { InteractiveRenderState, OverlayHandle, RenderTheme, ViewportState } from '../types';

type Ctx = CanvasRenderingContext2D;

export interface OverlayPalette {
  handleFill: string;
  canvasBackground: string;
  snap: string;
  snapPoint: string;
  eraser: string;
  eraserTargetStroke: string;
  laser: string;
  laserCore: string;
  searchFill: string;
  searchStroke: string;
  pinOpen: string;
  pinResolved: string;
  pinText: string;
  cropDim: string;
  cropLine: string;
}

export const OVERLAY_PALETTES: Record<RenderTheme, OverlayPalette> = {
  light: {
    handleFill: '#ffffff',
    canvasBackground: '#ffffff',
    snap: '#fa5252',
    snapPoint: '#e64980',
    eraser: 'rgba(0, 0, 0, 0.22)',
    eraserTargetStroke: 'rgba(73, 80, 87, 0.7)',
    laser: '#ff2d2d',
    laserCore: '#ffe3e3',
    searchFill: 'rgba(255, 212, 59, 0.35)',
    searchStroke: '#f59f00',
    pinOpen: '#f59f00',
    pinResolved: '#adb5bd',
    pinText: '#ffffff',
    cropDim: 'rgba(0, 0, 0, 0.45)',
    cropLine: '#ffffff',
  },
  dark: {
    handleFill: '#1e1e1e',
    canvasBackground: '#121212',
    snap: '#ff6b6b',
    snapPoint: '#f783ac',
    eraser: 'rgba(255, 255, 255, 0.25)',
    eraserTargetStroke: 'rgba(206, 212, 218, 0.7)',
    laser: '#ff4d4d',
    laserCore: '#fff0f0',
    searchFill: 'rgba(255, 212, 59, 0.28)',
    searchStroke: '#fcc419',
    pinOpen: '#fab005',
    pinResolved: '#5c636a',
    pinText: '#ffffff',
    cropDim: 'rgba(0, 0, 0, 0.6)',
    cropLine: '#f8f9fa',
  },
};

const HANDLE_SIZE = 8;
const ROTATE_RADIUS = 5;
const POINT_RADIUS = 5;
const MIDPOINT_RADIUS = 3.5;
const PORT_RADIUS = 4;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Draws editor chrome on the (unfiltered) overlay canvas: all geometry is world space, all sizes
 * (line widths, handles, labels) are constant in screen pixels, colors follow the theme.
 */
export class InteractiveRenderer {
  private readonly ctx: Ctx | null;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  render(state: InteractiveRenderState): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    const vp = state.viewport;
    const ratio = state.pixelRatio > 0 ? state.pixelRatio : 1;
    const pw = Math.max(1, Math.round(vp.width * ratio));
    const ph = Math.max(1, Math.round(vp.height * ratio));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const palette = OVERLAY_PALETTES[state.theme];
    const d = new OverlayDrawer(ctx, vp, state.accentColor, palette);

    if (state.frameHighlight) d.frameHighlight(state.frameHighlight);
    for (const poly of state.searchHighlights) d.searchHighlight(poly);
    for (const sel of state.remoteSelections) d.remoteSelection(sel.outlines, sel.color, sel.name);
    if (state.hoverOutline) d.polygon(state.hoverOutline, state.accentColor, 1.5, null, 0.65);
    for (const poly of state.eraserTargets) d.eraserTarget(poly);
    if (state.bindingHighlight) d.bindingHighlight(state.bindingHighlight);
    for (const poly of state.selectionOutlines) d.polygon(poly, state.accentColor, 1, null);
    for (const poly of state.groupOutlines) d.polygon(poly, state.accentColor, 1, [4, 3]);
    if (state.selectionBox) d.polygon(state.selectionBox, state.accentColor, 1, null);
    if (state.cropEditor) d.cropEditor(state.cropEditor);
    if (state.linearEditor) d.linearEditor(state.linearEditor);
    for (const h of state.handles) d.handle(h);
    if (state.marquee) d.marquee(state.marquee);
    if (state.lasso && state.lasso.length > 1) d.lasso(state.lasso);
    for (const line of state.snapLines) d.snapLine(line.from, line.to);
    for (const p of state.snapPoints) d.snapCross(p);
    for (const port of state.ports) d.port(port.point, port.active);
    if (state.eraserTrail.length > 1) d.fadingTrail(state.eraserTrail, palette.eraser, 3, 7, null);
    if (state.laserTrail.length > 1) d.fadingTrail(state.laserTrail, palette.laser, 2, 5, palette.laserCore);
    for (const pin of state.commentPins) d.commentPin(pin);
    for (const cursor of state.remoteCursors) d.remoteCursor(cursor.x, cursor.y, cursor.color, cursor.name, cursor.active);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  dispose(): void {
    this.disposed = true;
    if (this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

class OverlayDrawer {
  constructor(
    private readonly ctx: Ctx,
    private readonly vp: ViewportState,
    private readonly accent: string,
    private readonly palette: OverlayPalette,
  ) {}

  s(p: Point): Point {
    return { x: (p.x - this.vp.x) * this.vp.zoom, y: (p.y - this.vp.y) * this.vp.zoom };
  }

  private trace(points: readonly Point[], closed: boolean): void {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((p, i) => {
      const q = this.s(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    if (closed) ctx.closePath();
  }

  polygon(points: readonly Point[], color: string, width: number, dash: number[] | null, alpha = 1, closed = true): void {
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash ?? []);
    this.trace(points, closed);
    ctx.stroke();
    ctx.restore();
  }

  private fillPolygon(points: readonly Point[], color: string, alpha: number): void {
    if (points.length < 3) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    this.trace(points, true);
    ctx.fill();
    ctx.restore();
  }

  frameHighlight(poly: readonly Point[]): void {
    this.fillPolygon(poly, this.accent, 0.06);
    this.polygon(poly, this.accent, 2, null);
  }

  searchHighlight(poly: readonly Point[]): void {
    this.fillPolygon(poly, this.palette.searchFill, 1);
    this.polygon(poly, this.palette.searchStroke, 1.5, null);
  }

  remoteSelection(outlines: readonly Point[][], color: string, name: string): void {
    let top: Point | null = null;
    for (const poly of outlines) {
      this.polygon(poly, color, 1.5, null);
      for (const p of poly) {
        const q = this.s(p);
        if (!top || q.y < top.y || (q.y === top.y && q.x < top.x)) top = q;
      }
    }
    if (top && name) this.nameTag(top.x, top.y - 20, name, color, 11);
  }

  eraserTarget(poly: readonly Point[]): void {
    this.fillPolygon(poly, this.palette.canvasBackground, 0.55);
    this.polygon(poly, this.palette.eraserTargetStroke, 1, [3, 3]);
  }

  bindingHighlight(poly: readonly Point[]): void {
    this.polygon(poly, this.accent, 8, null, 0.28);
    this.polygon(poly, this.accent, 1.5, null, 0.9);
  }

  handle(h: OverlayHandle): void {
    const ctx = this.ctx;
    const c = this.s(h);
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.accent;
    ctx.fillStyle = h.active ? this.accent : this.palette.handleFill;
    switch (h.kind) {
      case 'resize':
      case 'crop': {
        const size = h.kind === 'crop' ? HANDLE_SIZE + 2 : HANDLE_SIZE;
        ctx.translate(c.x, c.y);
        if (h.angle) ctx.rotate(h.angle);
        ctx.beginPath();
        ctx.rect(-size / 2, -size / 2, size, size);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'rotate':
        ctx.beginPath();
        ctx.arc(c.x, c.y, ROTATE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'point':
        ctx.beginPath();
        ctx.arc(c.x, c.y, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'midpoint':
        ctx.globalAlpha = h.active ? 1 : 0.55;
        ctx.beginPath();
        ctx.arc(c.x, c.y, MIDPOINT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
    }
    ctx.restore();
  }

  linearEditor(editor: NonNullable<InteractiveRenderState['linearEditor']>): void {
    this.polygon(editor.points, this.accent, 1, [2, 3], 0.6, false);
    const selected = new Set(editor.selectedIndices);
    editor.midpoints.forEach((p, i) => this.handle({ id: `mid-${i}`, kind: 'midpoint', x: p.x, y: p.y, angle: 0 }));
    editor.points.forEach((p, i) =>
      this.handle({ id: `pt-${i}`, kind: 'point', x: p.x, y: p.y, angle: 0, active: selected.has(i) }),
    );
  }

  marquee(r: Rect): void {
    const ctx = this.ctx;
    const a = this.s({ x: r.x, y: r.y });
    const b = this.s({ x: r.x + r.width, y: r.y + r.height });
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = this.accent;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.restore();
  }

  lasso(points: readonly Point[]): void {
    this.fillPolygon(points, this.accent, 0.08);
    this.polygon(points, this.accent, 1, [5, 4], 1, false);
  }

  snapLine(from: Point, to: Point): void {
    const ctx = this.ctx;
    const a = this.s(from);
    const b = this.s(to);
    ctx.save();
    ctx.strokeStyle = this.palette.snap;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  snapCross(p: Point): void {
    const ctx = this.ctx;
    const c = this.s(p);
    const k = 3.5;
    ctx.save();
    ctx.strokeStyle = this.palette.snapPoint;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(c.x - k, c.y - k);
    ctx.lineTo(c.x + k, c.y + k);
    ctx.moveTo(c.x + k, c.y - k);
    ctx.lineTo(c.x - k, c.y + k);
    ctx.stroke();
    ctx.restore();
  }

  port(p: Point, active: boolean): void {
    const ctx = this.ctx;
    const c = this.s(p);
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.accent;
    ctx.fillStyle = active ? this.accent : this.palette.handleFill;
    ctx.beginPath();
    ctx.arc(c.x, c.y, active ? PORT_RADIUS + 1.5 : PORT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Polyline whose older segments fade out and get thinner (eraser, laser pointer). */
  fadingTrail(points: readonly Point[], color: string, minWidth: number, maxWidth: number, core: string | null): void {
    const ctx = this.ctx;
    const n = points.length;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    for (let i = 1; i < n; i++) {
      const t = i / (n - 1);
      const a = this.s(points[i - 1]!);
      const b = this.s(points[i]!);
      ctx.globalAlpha = 0.15 + 0.85 * t;
      ctx.strokeStyle = color;
      ctx.lineWidth = minWidth + (maxWidth - minWidth) * t;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (core) {
        ctx.strokeStyle = core;
        ctx.lineWidth = Math.max(0.5, (minWidth + (maxWidth - minWidth) * t) * 0.35);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  commentPin(pin: InteractiveRenderState['commentPins'][number]): void {
    const ctx = this.ctx;
    const c = this.s(pin);
    const r = pin.active ? 13 : 11;
    const color = pin.resolved ? this.palette.pinResolved : pin.active ? this.accent : this.palette.pinOpen;
    // Speech bubble whose tail points at the pinned location (bubble above-right of the point).
    const bx = c.x + r;
    const by = c.y - r;
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.strokeStyle = this.palette.handleFill;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    // Circle with a gap around 135° (towards the tip) → tail from the gap edges to the point.
    ctx.arc(bx, by, r, (160 * Math.PI) / 180, (110 * Math.PI) / 180 + Math.PI * 2, false);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = pin.resolved ? 0.85 : 1;
    ctx.fillStyle = this.palette.pinText;
    ctx.font = `bold ${pin.active ? 12 : 11}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pin.resolved ? '✓' : String(Math.max(1, pin.count)), bx, by + 0.5);
    ctx.restore();
  }

  private nameTag(x: number, y: number, name: string, color: string, fontSize: number): void {
    const ctx = this.ctx;
    const label = name.length > 32 ? `${name.slice(0, 31)}…` : name;
    ctx.save();
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const tw = ctx.measureText(label).width;
    const padX = 6;
    const h = fontSize + 8;
    const w = tw + padX * 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + padX, y + h / 2 + 0.5);
    ctx.restore();
  }

  remoteCursor(wx: number, wy: number, color: string, name: string, active: boolean): void {
    const ctx = this.ctx;
    const c = this.s({ x: wx, y: wy });
    if (c.x < -50 || c.y < -50 || c.x > this.vp.width + 50 || c.y > this.vp.height + 50) return;
    ctx.save();
    ctx.setLineDash([]);
    if (active) {
      const phase = (now() % 1200) / 1200;
      ctx.globalAlpha = 0.6 * (1 - phase);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6 + phase * 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Arrow pointer (tip at the cursor position).
    ctx.translate(c.x, c.y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4.2, 12.2);
    ctx.lineTo(7, 18.5);
    ctx.lineTo(9.6, 17.3);
    ctx.lineTo(6.9, 11.2);
    ctx.lineTo(12, 11.2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (name) this.nameTag(c.x + 12, c.y + 18, name, color, 12);
  }

  cropEditor(editor: NonNullable<InteractiveRenderState['cropEditor']>): void {
    const ctx = this.ctx;
    const z = this.vp.zoom;
    const c = this.s(editor.center);
    const toLocal = (r: Rect): Rect => ({
      x: (r.x - editor.center.x) * z,
      y: (r.y - editor.center.y) * z,
      width: r.width * z,
      height: r.height * z,
    });
    const img = toLocal(editor.imageRect);
    const crop = toLocal(editor.cropRect);
    ctx.save();
    ctx.translate(c.x, c.y);
    if (editor.angle) ctx.rotate(editor.angle);
    // Dim everything of the full image outside the crop rectangle.
    ctx.fillStyle = this.palette.cropDim;
    ctx.beginPath();
    ctx.rect(img.x, img.y, img.width, img.height);
    ctx.rect(crop.x, crop.y, crop.width, crop.height);
    ctx.fill('evenodd');
    ctx.setLineDash([]);
    ctx.strokeStyle = this.palette.cropLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
    // Rule-of-thirds guides.
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(crop.x + (crop.width * i) / 3, crop.y);
      ctx.lineTo(crop.x + (crop.width * i) / 3, crop.y + crop.height);
      ctx.moveTo(crop.x, crop.y + (crop.height * i) / 3);
      ctx.lineTo(crop.x + crop.width, crop.y + (crop.height * i) / 3);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // L-shaped corner handles.
    const len = Math.min(14, crop.width / 3, crop.height / 3);
    ctx.lineWidth = 3;
    ctx.lineCap = 'square';
    ctx.beginPath();
    const corners: [number, number, number, number][] = [
      [crop.x, crop.y, 1, 1],
      [crop.x + crop.width, crop.y, -1, 1],
      [crop.x + crop.width, crop.y + crop.height, -1, -1],
      [crop.x, crop.y + crop.height, 1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.moveTo(x + sx * len, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * len);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}
