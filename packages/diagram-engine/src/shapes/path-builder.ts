import {
  ellipsePath,
  polygonPath,
  roundedRectPath,
  type Path,
  type PathCommand,
  type Point,
  type Rect,
} from '@inkflow/geometry';

/**
 * Corner radius used for `roundness: 'round'` boxes. Adaptive like Excalidraw: a quarter of the
 * shorter side for small boxes, capped at 32 world units for large ones. Renderers must use the
 * same function so outlines, hit tests and drawings agree.
 */
export function getCornerRadius(width: number, height: number): number {
  const side = Math.min(Math.abs(width), Math.abs(height));
  return side <= 128 ? side * 0.25 : 32;
}

/** Tiny fluent builder for normalized absolute paths. */
export class PathBuilder {
  private readonly commands: PathCommand[] = [];
  private cursor: Point = { x: 0, y: 0 };

  moveTo(x: number, y: number): this {
    this.commands.push({ type: 'M', x, y });
    this.cursor = { x, y };
    return this;
  }

  lineTo(x: number, y: number): this {
    this.commands.push({ type: 'L', x, y });
    this.cursor = { x, y };
    return this;
  }

  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.commands.push({ type: 'C', x1, y1, x2, y2, x, y });
    this.cursor = { x, y };
    return this;
  }

  /** Quadratic curve expressed as a cubic. */
  quadTo(qx: number, qy: number, x: number, y: number): this {
    const c = this.cursor;
    return this.curveTo(
      c.x + (2 / 3) * (qx - c.x),
      c.y + (2 / 3) * (qy - c.y),
      x + (2 / 3) * (qx - x),
      y + (2 / 3) * (qy - y),
      x,
      y,
    );
  }

  /**
   * Elliptical arc around (cx, cy) from angle `a0` to `a1` (radians, screen space: 0 = +x,
   * π/2 = +y). Emits a line to the arc start when the cursor is elsewhere, then ≤ 90° cubic pieces.
   */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): this {
    const start = { x: cx + rx * Math.cos(a0), y: cy + ry * Math.sin(a0) };
    if (this.commands.length === 0) this.moveTo(start.x, start.y);
    else if (Math.abs(this.cursor.x - start.x) > 1e-9 || Math.abs(this.cursor.y - start.y) > 1e-9)
      this.lineTo(start.x, start.y);
    const delta = a1 - a0;
    const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
    const step = delta / segments;
    const k = (4 / 3) * Math.tan(step / 4);
    let a = a0;
    for (let i = 0; i < segments; i++) {
      const b = a + step;
      const p1 = { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
      const p2 = { x: cx + rx * Math.cos(b), y: cy + ry * Math.sin(b) };
      this.curveTo(
        p1.x - k * rx * Math.sin(a),
        p1.y + k * ry * Math.cos(a),
        p2.x + k * rx * Math.sin(b),
        p2.y - k * ry * Math.cos(b),
        p2.x,
        p2.y,
      );
      a = b;
    }
    return this;
  }

  close(): this {
    this.commands.push({ type: 'Z' });
    return this;
  }

  build(): Path {
    return this.commands.slice();
  }
}

export const path = () => new PathBuilder();

export function rectPath(x: number, y: number, w: number, h: number): Path {
  return polygonPath([
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]);
}

export function roundRect(x: number, y: number, w: number, h: number, r: number): Path {
  return roundedRectPath(x, y, w, h, r);
}

export function circlePath(cx: number, cy: number, r: number): Path {
  return ellipsePath(cx, cy, r, r);
}

export function linePath(...points: Point[]): Path {
  return polygonPath(points, false);
}

export function polyline(points: readonly [number, number][]): Path {
  return polygonPath(
    points.map(([x, y]) => ({ x, y })),
    false,
  );
}

export function polygon(points: readonly [number, number][]): Path {
  return polygonPath(points.map(([x, y]) => ({ x, y })));
}

/** Concatenates several paths into one (multiple subpaths). */
export function joinPaths(...paths: Path[]): Path {
  return paths.flat();
}

export function insetRect(r: Rect, dx: number, dy = dx): Rect {
  return {
    x: r.x + dx,
    y: r.y + dy,
    width: Math.max(0, r.width - dx * 2),
    height: Math.max(0, r.height - dy * 2),
  };
}

export function box(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}
