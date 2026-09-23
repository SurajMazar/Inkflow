import { shapeRegistry } from '@inkflow/diagram-engine';
import { createElement, isElementInsideBounds, type ElementType, type SceneElement } from '@inkflow/elements';
import type { Point } from '@inkflow/geometry';
import type { InteractiveRenderState } from '@inkflow/renderer';
import { indicesAbove } from '@inkflow/scene';
import { EMPTY_GUIDES, type SnapGuides } from '../snapping';
import type { CanvasPointerEvent, ToolType } from '../types';
import { BaseTool, DRAG_THRESHOLD_PX, snapDrawingPoint } from './base';

type ShapeToolType = Extract<
  ToolType,
  'rectangle' | 'roundedRectangle' | 'ellipse' | 'diamond' | 'triangle' | 'polygon' | 'star' | 'frame' | 'node'
>;

const ELEMENT_TYPE: Record<ShapeToolType, ElementType> = {
  rectangle: 'rectangle',
  roundedRectangle: 'rectangle',
  ellipse: 'ellipse',
  diamond: 'diamond',
  triangle: 'triangle',
  polygon: 'polygon',
  star: 'star',
  frame: 'frame',
  node: 'node',
};

const CLICK_SIZE: Record<ShapeToolType, { width: number; height: number }> = {
  rectangle: { width: 140, height: 90 },
  roundedRectangle: { width: 140, height: 90 },
  ellipse: { width: 130, height: 90 },
  diamond: { width: 130, height: 110 },
  triangle: { width: 110, height: 100 },
  polygon: { width: 110, height: 110 },
  star: { width: 110, height: 110 },
  frame: { width: 480, height: 320 },
  node: { width: 160, height: 80 },
};

/** Draws box-like elements: basic shapes, frames and diagram nodes. */
export class ShapeTool extends BaseTool {
  private drawing: { id: string; origin: Point; down: CanvasPointerEvent; moved: boolean; guides: SnapGuides } | null = null;

  constructor(
    editor: ConstructorParameters<typeof BaseTool>[0],
    readonly id: ShapeToolType,
  ) {
    super(editor);
  }

  override isBusy(): boolean {
    return this.drawing !== null;
  }

  private buildElement(origin: Point): SceneElement {
    const editor = this.editor;
    const style = editor.state.style;
    const type = ELEMENT_TYPE[this.id];
    const props: Record<string, unknown> = { ...editor.styleProps(type), x: origin.x, y: origin.y, width: 0, height: 0 };
    switch (this.id) {
      case 'rectangle':
        props.roundness = 'sharp';
        break;
      case 'roundedRectangle':
        props.roundness = 'round';
        break;
      case 'polygon':
        props.sides = style.polygonSides;
        break;
      case 'star':
        props.spikes = style.starSpikes;
        break;
      case 'frame': {
        const count = editor.getFrames().length + 1;
        props.name = `Frame ${count}`;
        break;
      }
      case 'node': {
        const def = shapeRegistry.get(style.nodeShape) ?? shapeRegistry.get('rounded-rectangle');
        props.shape = def?.key ?? 'rectangle';
        props.icon = def?.defaultIcon ?? null;
        props.roughness = style.roughness;
        if (def?.defaultStyle) Object.assign(props, def.defaultStyle);
        if (style.backgroundColor !== 'transparent') props.backgroundColor = style.backgroundColor;
        break;
      }
      default:
        break;
    }
    return createElement(type, props as never);
  }

  override onPointerDown(e: CanvasPointerEvent): void {
    const editor = this.editor;
    const tx = editor.beginGesture(`Create ${this.id}`);
    if (!tx) return;
    const origin = snapDrawingPoint(editor, e.world, new Set(), e.mod).point;
    const el = this.buildElement(origin);
    const [index] = indicesAbove(editor.scene.getElementsIncludingDeleted(), 1);
    tx.create({ ...el, index: index! });
    editor.setState({ selectedIds: [], interaction: 'creating' });
    this.drawing = { id: el.id, origin, down: e, moved: false, guides: EMPTY_GUIDES };
  }

  override onPointerMove(e: CanvasPointerEvent): void {
    const d = this.drawing;
    const tx = this.editor.activeGesture;
    if (!d || !tx) return;
    if (!d.moved && Math.hypot(e.screen.x - d.down.screen.x, e.screen.y - d.down.screen.y) < DRAG_THRESHOLD_PX[e.pointerType]) return;
    d.moved = true;
    const snap = snapDrawingPoint(this.editor, e.world, new Set([d.id]), e.mod);
    d.guides = snap;
    let w = snap.point.x - d.origin.x;
    let h = snap.point.y - d.origin.y;
    if (e.shift) {
      const size = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * size;
      h = Math.sign(h || 1) * size;
    }
    let x = w < 0 ? d.origin.x + w : d.origin.x;
    let y = h < 0 ? d.origin.y + h : d.origin.y;
    let width = Math.abs(w);
    let height = Math.abs(h);
    if (e.alt) {
      x = d.origin.x - width;
      y = d.origin.y - height;
      width *= 2;
      height *= 2;
    }
    tx.update(d.id, { x, y, width, height });
  }

  override onPointerUp(): void {
    const d = this.drawing;
    const editor = this.editor;
    this.drawing = null;
    const tx = editor.activeGesture;
    if (!d || !tx) return;
    const el = editor.scene.getElement(d.id);
    if (!el) {
      editor.cancelGesture();
      return;
    }
    if (!d.moved || el.width < 2 || el.height < 2) {
      const size = this.id === 'node' ? (shapeRegistry.get(editor.state.style.nodeShape)?.defaultSize ?? CLICK_SIZE.node) : CLICK_SIZE[this.id];
      tx.update(d.id, { x: d.origin.x - size.width / 2, y: d.origin.y - size.height / 2, width: size.width, height: size.height });
    }
    const created = editor.scene.getElement(d.id)!;
    if (created.type === 'frame') {
      const inside = editor.scene
        .queryBounds({ minX: created.x, minY: created.y, maxX: created.x + created.width, maxY: created.y + created.height })
        .filter((other) => other.id !== created.id && other.type !== 'frame' && !other.frameId && isElementInsideBounds(other, {
          minX: created.x,
          minY: created.y,
          maxX: created.x + created.width,
          maxY: created.y + created.height,
        }));
      if (inside.length) tx.updateMany(inside.map((o) => [o.id, { frameId: created.id }] as const));
    } else {
      editor.refreshFrameMembership(tx, [created.id]);
    }
    editor.commitGesture({ selectionAfter: [d.id] });
    editor.setState({ interaction: 'idle' });
    editor.finishToolUse();
  }

  override onDoubleClick(e: CanvasPointerEvent): void {
    this.onPointerDown(e);
  }

  override onCancel(): void {
    if (this.drawing) this.editor.cancelGesture();
    this.drawing = null;
    this.editor.setState({ interaction: 'idle' });
  }

  override overlay(): Partial<InteractiveRenderState> {
    if (!this.drawing) return {};
    return { snapLines: this.drawing.guides.lines, snapPoints: this.drawing.guides.points };
  }
}
