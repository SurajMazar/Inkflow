import type { Path } from '@inkflow/geometry';
import type { FillRule } from '../drawable/types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const path2dCache = new WeakMap<Path, Path2D>();

function hasPath2D(): boolean {
  return typeof Path2D !== 'undefined';
}

/** Cached Path2D for an (immutable) command list; null when Path2D is unavailable. */
export function getPath2D(path: Path): Path2D | null {
  if (!hasPath2D()) return null;
  let p = path2dCache.get(path);
  if (!p) {
    p = new Path2D();
    tracePathInto(p, path);
    path2dCache.set(path, p);
  }
  return p;
}

interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  closePath(): void;
}

function tracePathInto(sink: PathSink, path: Path): void {
  for (const c of path) {
    switch (c.type) {
      case 'M':
        sink.moveTo(c.x, c.y);
        break;
      case 'L':
        sink.lineTo(c.x, c.y);
        break;
      case 'C':
        sink.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
        break;
      case 'Z':
        sink.closePath();
        break;
    }
  }
}

/** Starts a new current path on the context and traces the commands into it. */
export function tracePath(ctx: Ctx, path: Path): void {
  ctx.beginPath();
  tracePathInto(ctx, path);
}

export function fillPath(ctx: Ctx, path: Path, rule: FillRule): void {
  const p = getPath2D(path);
  if (p) ctx.fill(p, rule);
  else {
    tracePath(ctx, path);
    ctx.fill(rule);
  }
}

export function strokePath(ctx: Ctx, path: Path): void {
  const p = getPath2D(path);
  if (p) ctx.stroke(p);
  else {
    tracePath(ctx, path);
    ctx.stroke();
  }
}

export function clipPath(ctx: Ctx, path: Path, rule: FillRule): void {
  const p = getPath2D(path);
  if (p) ctx.clip(p, rule);
  else {
    tracePath(ctx, path);
    ctx.clip(rule);
  }
}
