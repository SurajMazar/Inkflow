import { transformPath, type Path, type Rect } from '@inkflow/geometry';
import type { NodeElement } from '@inkflow/elements';
import type { NodeShapeDefinition, ShapeCategory, ShapeGeometry } from '../types';
import { BUILTIN_SHAPES, customGeometry } from './catalog';

/** Extensible registry of node shapes, keyed by `NodeElement.shape`. */
export class ShapeRegistry {
  private readonly shapes = new Map<string, NodeShapeDefinition>();

  constructor(definitions: readonly NodeShapeDefinition[] = []) {
    for (const def of definitions) this.register(def);
  }

  /** Adds or replaces a shape definition. */
  register(def: NodeShapeDefinition): void {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(def.key)) throw new Error(`Invalid shape key "${def.key}"`);
    if (!(def.defaultSize.width > 0 && def.defaultSize.height > 0)) throw new Error(`Shape "${def.key}" needs a positive default size`);
    this.shapes.set(def.key, def);
  }

  get(key: string): NodeShapeDefinition | undefined {
    return this.shapes.get(key);
  }

  has(key: string): boolean {
    return this.shapes.has(key);
  }

  /** Definitions in registration order, optionally filtered by category. */
  list(category?: ShapeCategory): NodeShapeDefinition[] {
    const all = [...this.shapes.values()];
    return category ? all.filter((d) => d.category === category) : all;
  }
}

/** Registry pre-populated with every built-in shape. */
export const shapeRegistry = new ShapeRegistry(BUILTIN_SHAPES);

function mirrorRect(r: Rect, w: number, h: number, flipX: boolean, flipY: boolean): Rect {
  return {
    x: flipX ? w - r.x - r.width : r.x,
    y: flipY ? h - r.y - r.height : r.y,
    width: r.width,
    height: r.height,
  };
}

function mirrorPath(p: Path, w: number, h: number, flipX: boolean, flipY: boolean): Path {
  return transformPath(p, flipX ? -1 : 1, flipY ? -1 : 1, flipX ? w : 0, flipY ? h : 0);
}

/** Icon size reserved above the label when a node shows an icon and its shape has no icon box. */
export function defaultIconSize(labelBox: Rect): number {
  return Math.max(0, Math.min(32, labelBox.width, labelBox.height * 0.5));
}

/**
 * Geometry of a node in its local box (0..width × 0..height), ready to draw:
 * - resolves the shape from the registry (unknown keys fall back to `rectangle`, `custom` uses
 *   `node.customPath` in a 0–100 box scaled to the node size);
 * - mirrors every path and box for `flipX` / `flipY` (rotation is applied by the caller around the
 *   box centre, exactly like other elements);
 * - when the node has an `icon` and the shape reserves no icon box, carves an icon area out of the
 *   top of the label box (icon above the label), so `labelBox` is always the final text area.
 */
export function getNodeGeometry(node: NodeElement): ShapeGeometry {
  const w = Math.max(0, node.width);
  const h = Math.max(0, node.height);
  let geometry: ShapeGeometry;
  if (node.shape === 'custom') {
    geometry = customGeometry(w, h, node);
  } else {
    const def = shapeRegistry.get(node.shape) ?? shapeRegistry.get('rectangle')!;
    geometry = def.geometry(w, h, node);
    if (def.elliptical && geometry.elliptical === undefined) geometry = { ...geometry, elliptical: true };
  }
  let labelBox = geometry.labelBox ?? { x: 8, y: 8, width: Math.max(0, w - 16), height: Math.max(0, h - 16) };
  let iconBox = geometry.iconBox;
  if (node.icon && !iconBox) {
    const hasText = !!node.label && node.label.text.trim().length > 0;
    const size = hasText ? defaultIconSize(labelBox) : Math.max(0, Math.min(48, labelBox.width, labelBox.height));
    iconBox = {
      x: labelBox.x + (labelBox.width - size) / 2,
      y: hasText ? labelBox.y : labelBox.y + (labelBox.height - size) / 2,
      width: size,
      height: size,
    };
    if (hasText) {
      const used = size + 4;
      labelBox = { x: labelBox.x, y: labelBox.y + used, width: labelBox.width, height: Math.max(0, labelBox.height - used) };
    }
  }
  const out: ShapeGeometry = { ...geometry, labelBox, ...(iconBox ? { iconBox } : {}) };
  if (!node.flipX && !node.flipY) return out;
  const fx = node.flipX;
  const fy = node.flipY;
  return {
    outline: mirrorPath(out.outline, w, h, fx, fy),
    ...(out.details ? { details: out.details.map((d) => mirrorPath(d, w, h, fx, fy)) } : {}),
    ...(out.fills ? { fills: out.fills.map((d) => mirrorPath(d, w, h, fx, fy)) } : {}),
    ...(out.connectionOutline ? { connectionOutline: mirrorPath(out.connectionOutline, w, h, fx, fy) } : {}),
    ...(out.labelBox ? { labelBox: mirrorRect(out.labelBox, w, h, fx, fy) } : {}),
    ...(out.iconBox ? { iconBox: mirrorRect(out.iconBox, w, h, fx, fy) } : {}),
    ...(out.subtitleBox ? { subtitleBox: mirrorRect(out.subtitleBox, w, h, fx, fy) } : {}),
    ...(out.elliptical ? { elliptical: true } : {}),
  };
}
