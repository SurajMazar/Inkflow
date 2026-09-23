import type { GridOptions, RenderTheme, ViewportState } from '../types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MIN_SPACING = 6;
const MAJOR_EVERY = 5;
const MAX_LEVELS = 3;
const MAX_DOTS = 60_000;

const GRID_COLORS: Record<RenderTheme, { dot: string; minor: string; major: string }> = {
  light: { dot: '#c4c8cc', minor: 'rgba(0, 0, 0, 0.06)', major: 'rgba(0, 0, 0, 0.13)' },
  dark: { dot: '#4b4f55', minor: 'rgba(255, 255, 255, 0.06)', major: 'rgba(255, 255, 255, 0.13)' },
};

/** Grid step actually drawn (coarsened ×5 while the on-screen spacing is below 6px); null = hidden. */
export function effectiveGridSize(size: number, zoom: number): number | null {
  if (!(size > 0) || !(zoom > 0)) return null;
  let s = size;
  let levels = 0;
  while (s * zoom < MIN_SPACING) {
    s *= MAJOR_EVERY;
    if (++levels > MAX_LEVELS) return null;
  }
  return s;
}

const crisp = (v: number) => Math.round(v) + 0.5;

/**
 * Draws the background grid. `ctx` must be in screen space (CSS pixels, i.e. only the device pixel
 * ratio applied). Dot, square and isometric grids are aligned to world multiples of the grid size
 * and adapt to the zoom: spacing below 6px coarsens the grid ×5 (up to 3 times), then hides it.
 * The static renderer always passes the light palette (dark mode is a CSS filter on that canvas).
 */
export function drawGrid(ctx: Ctx, viewport: ViewportState, grid: GridOptions, theme: RenderTheme): void {
  if (!grid.visible) return;
  const zoom = viewport.zoom;
  const step = effectiveGridSize(grid.size, zoom);
  if (step === null) return;
  const colors = GRID_COLORS[theme];
  const worldW = viewport.width / zoom;
  const worldH = viewport.height / zoom;
  const x0 = viewport.x;
  const y0 = viewport.y;
  const toSX = (wx: number) => (wx - x0) * zoom;
  const toSY = (wy: number) => (wy - y0) * zoom;
  ctx.save();
  ctx.setLineDash([]);
  if (grid.type === 'dot') {
    let s = step;
    let cols = Math.ceil(worldW / s) + 1;
    let rows = Math.ceil(worldH / s) + 1;
    while (cols * rows > MAX_DOTS) {
      s *= MAJOR_EVERY;
      cols = Math.ceil(worldW / s) + 1;
      rows = Math.ceil(worldH / s) + 1;
    }
    const size = Math.max(1, Math.min(2.5, (s * zoom) / 14));
    const half = size / 2;
    ctx.fillStyle = colors.dot;
    ctx.beginPath();
    const startX = Math.ceil(x0 / s) * s;
    const startY = Math.ceil(y0 / s) * s;
    for (let wy = startY; wy <= y0 + worldH; wy += s) {
      const sy = toSY(wy);
      for (let wx = startX; wx <= x0 + worldW; wx += s) {
        ctx.rect(toSX(wx) - half, sy - half, size, size);
      }
    }
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.lineWidth = 1;
  const minor: [number, number, number, number][] = [];
  const major: [number, number, number, number][] = [];
  const majorStep = step * MAJOR_EVERY;
  const isMajor = (v: number) => Math.abs(v / majorStep - Math.round(v / majorStep)) < 1e-6;
  if (grid.type === 'square') {
    for (let wx = Math.ceil(x0 / step) * step; wx <= x0 + worldW; wx += step) {
      const sx = crisp(toSX(wx));
      (isMajor(wx) ? major : minor).push([sx, 0, sx, viewport.height]);
    }
    for (let wy = Math.ceil(y0 / step) * step; wy <= y0 + worldH; wy += step) {
      const sy = crisp(toSY(wy));
      (isMajor(wy) ? major : minor).push([0, sy, viewport.width, sy]);
    }
  } else {
    // Isometric: triangle lattice with side `step` → verticals every step·√3/2 and ±30° diagonals
    // whose vertical intercepts are `step` apart.
    const dx = (step * Math.sqrt(3)) / 2;
    const t = Math.tan(Math.PI / 6);
    const xMin = x0;
    const xMax = x0 + worldW;
    for (let i = Math.ceil(x0 / dx); i * dx <= xMax; i++) {
      const sx = crisp(toSX(i * dx));
      (i % MAJOR_EVERY === 0 ? major : minor).push([sx, 0, sx, viewport.height]);
    }
    for (const sign of [1, -1]) {
      // Lines y = sign·t·x + k·step; find k range covering the viewport corners.
      const cs = [
        y0 - sign * t * xMin,
        y0 - sign * t * xMax,
        y0 + worldH - sign * t * xMin,
        y0 + worldH - sign * t * xMax,
      ];
      const kMin = Math.floor(Math.min(...cs) / step);
      const kMax = Math.ceil(Math.max(...cs) / step);
      for (let k = kMin; k <= kMax; k++) {
        const c = k * step;
        const ya = sign * t * xMin + c;
        const yb = sign * t * xMax + c;
        (k % MAJOR_EVERY === 0 ? major : minor).push([toSX(xMin), toSY(ya), toSX(xMax), toSY(yb)]);
      }
    }
  }
  const strokeAll = (lines: [number, number, number, number][], color: string) => {
    if (lines.length === 0) return;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const [ax, ay, bx, by] of lines) {
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  };
  strokeAll(minor, colors.minor);
  strokeAll(major, colors.major);
  ctx.restore();
}
