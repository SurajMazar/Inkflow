import { isShapeElement, type SceneElement } from '@inkflow/elements';
import type { Bounds } from '@inkflow/geometry';
import { pathCommandBounds, rectPath } from '../paths';
import type { DrawOpSet } from '../rough/types';
import { frameLayers, freedrawLayers, imageLayers, textLayers } from './basic';
import { nodeLayers, sequenceLayers, tableLayers, umlClassLayers } from './diagram';
import { linearLayers } from './linear';
import { shapeLabelBox, shapeLabelLayers, shapeLayers } from './shapes';
import { strokePaint } from './style';
import type { DrawLayer, ElementDrawable } from './types';

function layersFor(el: SceneElement): { layers: DrawLayer[]; labelLayers: DrawLayer[] } {
  if (isShapeElement(el)) {
    return {
      layers: shapeLayers(el),
      labelLayers: shapeLabelLayers(el.label, el.strokeColor, shapeLabelBox(el)),
    };
  }
  switch (el.type) {
    case 'line':
    case 'arrow':
    case 'connector':
      return linearLayers(el);
    case 'freedraw':
      return { layers: freedrawLayers(el), labelLayers: [] };
    case 'text':
      return { layers: textLayers(el), labelLayers: [] };
    case 'image':
      return { layers: imageLayers(el), labelLayers: [] };
    case 'frame':
      return { layers: frameLayers(el), labelLayers: [] };
    case 'node':
      return nodeLayers(el);
    case 'table':
      return { layers: tableLayers(el), labelLayers: [] };
    case 'uml-class':
      return { layers: umlClassLayers(el), labelLayers: [] };
    case 'sequence':
      return { layers: sequenceLayers(el), labelLayers: [] };
    default:
      return { layers: [], labelLayers: [] };
  }
}

interface Stats {
  sets: DrawOpSet[];
  bounds: Bounds;
  complexity: number;
  hasSketchFill: boolean;
  hasImage: boolean;
}

function walk(layers: readonly DrawLayer[], stats: Stats, collectSets: boolean): void {
  for (const layer of layers) {
    switch (layer.kind) {
      case 'shape': {
        const pad =
          Math.max(
            layer.stroke ? layer.stroke.width / 2 : 0,
            layer.sketch ? layer.sketch.width / 2 : 0,
          ) + 1;
        for (const set of layer.sets) {
          if (collectSets) stats.sets.push(set);
          stats.complexity += set.path.length;
          if (set.type === 'fillSketch' && layer.sketch) stats.hasSketchFill = true;
          const b = pathCommandBounds(set.path);
          if (b.minX <= b.maxX) {
            stats.bounds.minX = Math.min(stats.bounds.minX, b.minX - pad);
            stats.bounds.minY = Math.min(stats.bounds.minY, b.minY - pad);
            stats.bounds.maxX = Math.max(stats.bounds.maxX, b.maxX + pad);
            stats.bounds.maxY = Math.max(stats.bounds.maxY, b.maxY + pad);
          }
        }
        break;
      }
      case 'text':
        for (const run of layer.runs) {
          stats.complexity += Math.ceil(run.text.length / 2) + 1;
          const left =
            layer.align === 'center'
              ? run.x - run.width / 2
              : layer.align === 'right'
                ? run.x - run.width
                : run.x;
          const half = layer.fontSize * 0.75;
          stats.bounds.minX = Math.min(stats.bounds.minX, left - 2);
          stats.bounds.maxX = Math.max(stats.bounds.maxX, left + run.width + 2);
          stats.bounds.minY = Math.min(stats.bounds.minY, run.y - half);
          stats.bounds.maxY = Math.max(stats.bounds.maxY, run.y + half);
        }
        break;
      case 'image':
        stats.hasImage = true;
        stats.complexity += 1;
        stats.bounds.minX = Math.min(stats.bounds.minX, layer.x);
        stats.bounds.minY = Math.min(stats.bounds.minY, layer.y);
        stats.bounds.maxX = Math.max(stats.bounds.maxX, layer.x + layer.width);
        stats.bounds.maxY = Math.max(stats.bounds.maxY, layer.y + layer.height);
        break;
      case 'group':
        walk(layer.children, stats, collectSets);
        break;
    }
  }
}

/**
 * Malformed data (e.g. a custom node path that cannot be parsed) must never break rendering of the
 * whole scene: such an element falls back to its plain bounding box outline.
 */
function safeLayersFor(el: SceneElement): { layers: DrawLayer[]; labelLayers: DrawLayer[] } {
  try {
    return layersFor(el);
  } catch (error) {
    console.warn(`[renderer] could not build drawable for ${el.type} ${el.id}`, error);
    const stroke = strokePaint(el) ?? {
      color: '#868e96',
      width: 1,
      dash: [4, 4],
      cap: 'round',
      join: 'round',
    };
    return {
      layers: [
        {
          kind: 'shape',
          sets: [
            { type: 'stroke', path: rectPath(0, 0, Math.max(1, el.width), Math.max(1, el.height)) },
          ],
          stroke,
          fill: null,
          sketch: null,
          fillRule: 'nonzero',
        },
      ],
      labelLayers: [],
    };
  }
}

/** Builds the zoom-independent drawable of an element in element-local coordinates. */
export function generateElementDrawable(el: SceneElement): ElementDrawable {
  const { layers, labelLayers } = safeLayersFor(el);
  const stats: Stats = {
    sets: [],
    bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    complexity: 0,
    hasSketchFill: false,
    hasImage: false,
  };
  walk(layers, stats, true);
  walk(labelLayers, stats, false);
  const b = stats.bounds;
  const localBounds =
    b.minX <= b.maxX
      ? b
      : { minX: 0, minY: 0, maxX: Math.max(0, el.width), maxY: Math.max(0, el.height) };
  return {
    sets: stats.sets,
    layers,
    labelLayers,
    width: el.width,
    height: el.height,
    localBounds,
    complexity: stats.complexity,
    hasSketchFill: stats.hasSketchFill,
    hasImage: stats.hasImage,
  };
}

interface CacheEntry {
  version: number;
  versionNonce: number;
  ref: SceneElement;
  drawable: ElementDrawable;
}

/** Drawables cached by element id + version (+ nonce); zoom independent. */
export class DrawableCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(el: SceneElement): ElementDrawable {
    const hit = this.entries.get(el.id);
    if (
      hit &&
      (hit.ref === el || (hit.version === el.version && hit.versionNonce === el.versionNonce))
    ) {
      hit.ref = el;
      return hit.drawable;
    }
    const drawable = generateElementDrawable(el);
    this.entries.set(el.id, {
      version: el.version,
      versionNonce: el.versionNonce,
      ref: el,
      drawable,
    });
    return drawable;
  }

  /** True when a drawable for this exact element version is cached. */
  has(el: SceneElement): boolean {
    const hit = this.entries.get(el.id);
    return !!hit && hit.version === el.version && hit.versionNonce === el.versionNonce;
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
