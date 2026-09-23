import type { Point } from '@inkflow/geometry';
import type { Editor } from '../editor';
import { hitTestTop, hitTolerancePx } from '../hit-test';
import type { CanvasPointerEvent } from '../types';
import { normalizeWheel, panBy, screenToWorld, zoomAtPoint } from '../viewport';

const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_DISTANCE = 8;
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE = 8;

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

interface PanState {
  pointerId: number;
  last: Point;
}

interface PinchState {
  startDistance: number;
  startZoom: number;
  lastCenter: Point;
}

/**
 * Normalizes DOM input into editor gestures: tool pointer events, panning (hand tool, space,
 * middle mouse, touch), pinch-zoom, wheel/trackpad zoom, double-click/tap and long-press.
 */
export class InteractionController {
  private readonly touches = new Map<number, Point>();
  private pan: PanState | null = null;
  private pinch: PinchState | null = null;
  private spaceDown = false;
  private lastClick: { time: number; point: Point } | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressOrigin: Point | null = null;
  private toolPointerId: number | null = null;
  private safariGestureZoom: number | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly container: HTMLElement,
    private readonly surface: HTMLCanvasElement,
  ) {}

  attach(): () => void {
    const s = this.surface;
    const opts: AddEventListenerOptions = { passive: false };
    s.addEventListener('pointerdown', this.onPointerDown, opts);
    s.addEventListener('pointermove', this.onPointerMove, opts);
    s.addEventListener('pointerup', this.onPointerUp, opts);
    s.addEventListener('pointercancel', this.onPointerCancel, opts);
    s.addEventListener('pointerleave', this.onPointerLeave);
    s.addEventListener('lostpointercapture', this.onLostCapture);
    s.addEventListener('contextmenu', this.onContextMenu);
    this.container.addEventListener('wheel', this.onWheel, opts);
    // Safari trackpad pinch
    this.container.addEventListener('gesturestart', this.onGestureStart as EventListener, opts);
    this.container.addEventListener('gesturechange', this.onGestureChange as EventListener, opts);
    this.container.addEventListener('gestureend', this.onGestureEnd as EventListener, opts);
    const win = this.container.ownerDocument.defaultView ?? window;
    win.addEventListener('keydown', this.onKeyDown);
    win.addEventListener('keyup', this.onKeyUp);
    win.addEventListener('blur', this.onBlur);
    s.style.touchAction = 'none';
    return () => {
      s.removeEventListener('pointerdown', this.onPointerDown);
      s.removeEventListener('pointermove', this.onPointerMove);
      s.removeEventListener('pointerup', this.onPointerUp);
      s.removeEventListener('pointercancel', this.onPointerCancel);
      s.removeEventListener('pointerleave', this.onPointerLeave);
      s.removeEventListener('lostpointercapture', this.onLostCapture);
      s.removeEventListener('contextmenu', this.onContextMenu);
      this.container.removeEventListener('wheel', this.onWheel);
      this.container.removeEventListener('gesturestart', this.onGestureStart as EventListener);
      this.container.removeEventListener('gesturechange', this.onGestureChange as EventListener);
      this.container.removeEventListener('gestureend', this.onGestureEnd as EventListener);
      win.removeEventListener('keydown', this.onKeyDown);
      win.removeEventListener('keyup', this.onKeyUp);
      win.removeEventListener('blur', this.onBlur);
      this.clearLongPress();
    };
  }

  private toScreen(e: { clientX: number; clientY: number }): Point {
    const rect = this.surface.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private toCanvasEvent(e: PointerEvent): CanvasPointerEvent {
    const screen = this.toScreen(e);
    const pointerType = (e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse') as CanvasPointerEvent['pointerType'];
    const hasPressure = pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5;
    return {
      pointerId: e.pointerId,
      pointerType,
      button: e.button,
      buttons: e.buttons,
      screen,
      world: screenToWorld(this.editor.state.viewport, screen),
      pressure: hasPressure ? e.pressure : 0.5,
      hasPressure,
      timeStamp: e.timeStamp,
      isPrimary: e.isPrimary,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      mod: isMac() ? e.metaKey : e.ctrlKey,
    };
  }

  private shouldPan(e: PointerEvent): boolean {
    const { tool, penMode } = this.editor.state;
    if (e.button === 1) return true;
    if (this.spaceDown) return true;
    if (tool === 'hand') return true;
    if (penMode && e.pointerType === 'touch') return true;
    return false;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.editor.closeContextMenu();
    this.focusSurface();
    if (e.pointerType === 'touch') this.touches.set(e.pointerId, this.toScreen(e));

    if (this.touches.size >= 2) {
      // Second finger: abort any tool interaction and start pinch/pan.
      this.clearLongPress();
      this.cancelToolInteraction();
      this.startPinch();
      e.preventDefault();
      return;
    }
    if (e.button === 2) return; // context menu handles right clicks
    this.surface.setPointerCapture(e.pointerId);

    if (this.shouldPan(e)) {
      this.pan = { pointerId: e.pointerId, last: this.toScreen(e) };
      this.editor.setState({ interaction: 'panning', cursor: 'grabbing' });
      e.preventDefault();
      return;
    }

    const ev = this.toCanvasEvent(e);
    if (e.pointerType === 'touch') this.startLongPress(ev);

    if (this.isDoubleClick(ev)) {
      this.lastClick = null;
      this.editor.activeTool.onDoubleClick(ev);
      e.preventDefault();
      return;
    }
    this.lastClick = { time: ev.timeStamp, point: ev.screen };
    this.toolPointerId = e.pointerId;
    this.editor.activeTool.onPointerDown(ev);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, this.toScreen(e));
    if (this.pinch && this.touches.size >= 2) {
      this.updatePinch();
      return;
    }
    if (this.pan && this.pan.pointerId === e.pointerId) {
      const p = this.toScreen(e);
      const dx = p.x - this.pan.last.x;
      const dy = p.y - this.pan.last.y;
      this.pan.last = p;
      this.editor.setViewport(panBy(this.editor.state.viewport, dx, dy));
      return;
    }
    const ev = this.toCanvasEvent(e);
    if (this.longPressOrigin && Math.hypot(ev.screen.x - this.longPressOrigin.x, ev.screen.y - this.longPressOrigin.y) > LONG_PRESS_MOVE_TOLERANCE) {
      this.clearLongPress();
    }
    if (e.pointerType !== 'touch' || this.toolPointerId === e.pointerId) {
      this.editor.reportCursor(ev.world);
    }
    if (this.toolPointerId !== null && this.toolPointerId !== e.pointerId) return;
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (coalesced.length > 1 && this.toolPointerId === e.pointerId) {
      for (const c of coalesced) this.editor.activeTool.onPointerMove(this.toCanvasEvent(c));
    } else {
      this.editor.activeTool.onPointerMove(ev);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.clearLongPress();
    if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
    if (this.pinch) {
      if (this.touches.size < 2) {
        this.pinch = null;
        this.editor.setState({ interaction: 'idle' });
      }
      return;
    }
    if (this.pan && this.pan.pointerId === e.pointerId) {
      this.pan = null;
      this.editor.setState({ interaction: 'idle', cursor: this.editor.activeTool.cursor() });
      return;
    }
    if (this.toolPointerId === e.pointerId) {
      this.toolPointerId = null;
      this.editor.activeTool.onPointerUp(this.toCanvasEvent(e));
    }
    if (this.surface.hasPointerCapture(e.pointerId)) this.surface.releasePointerCapture(e.pointerId);
  };

  private onPointerCancel = (e: PointerEvent) => {
    this.clearLongPress();
    this.touches.delete(e.pointerId);
    if (this.pan?.pointerId === e.pointerId) this.pan = null;
    if (this.toolPointerId === e.pointerId) {
      this.toolPointerId = null;
      this.editor.activeTool.onCancel();
    }
    if (this.touches.size < 2) this.pinch = null;
    this.editor.setState({ interaction: 'idle' });
  };

  private onLostCapture = (e: PointerEvent) => {
    if (this.toolPointerId === e.pointerId && e.buttons === 0) {
      // Pointer released outside the window: finish the interaction gracefully.
      this.toolPointerId = null;
      this.editor.activeTool.onPointerUp(this.toCanvasEvent(e));
    }
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && this.toolPointerId === null) {
      this.editor.reportCursor(null);
      if (this.editor.state.hoveredId) this.editor.setState({ hoveredId: null });
    }
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (this.editor.state.presentation.active) return;
    const screen = this.toScreen(e);
    this.openContextMenuAt(screen, 'mouse');
  };

  private openContextMenuAt(screen: Point, pointerType: 'mouse' | 'touch' | 'pen') {
    const world = screenToWorld(this.editor.state.viewport, screen);
    const tolerance = hitTolerancePx(pointerType) / this.editor.state.viewport.zoom;
    const hit = hitTestTop(this.editor.scene, world, { tolerance, includeLocked: true });
    this.editor.openContextMenu(screen, world, hit?.id ?? null, !!hit?.locked);
  }

  private startLongPress(ev: CanvasPointerEvent) {
    this.clearLongPress();
    this.longPressOrigin = ev.screen;
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      if (!this.longPressOrigin) return;
      // Cancel whatever the tool started, then open the context menu.
      this.cancelToolInteraction();
      this.openContextMenuAt(this.longPressOrigin, 'touch');
      this.longPressOrigin = null;
    }, LONG_PRESS_MS);
  }

  private clearLongPress() {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressOrigin = null;
  }

  private cancelToolInteraction() {
    if (this.toolPointerId !== null) {
      this.toolPointerId = null;
      this.editor.activeTool.onCancel();
    }
  }

  private isDoubleClick(ev: CanvasPointerEvent): boolean {
    if (!this.lastClick) return false;
    const dt = ev.timeStamp - this.lastClick.time;
    const d = Math.hypot(ev.screen.x - this.lastClick.point.x, ev.screen.y - this.lastClick.point.y);
    const maxDistance = ev.pointerType === 'touch' ? DOUBLE_CLICK_DISTANCE * 3 : DOUBLE_CLICK_DISTANCE;
    return dt > 0 && dt < DOUBLE_CLICK_MS && d < maxDistance;
  }

  private startPinch() {
    const pts = [...this.touches.values()];
    if (pts.length < 2) return;
    const [a, b] = pts as [Point, Point];
    this.pan = null;
    this.pinch = {
      startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startZoom: this.editor.state.viewport.zoom,
      lastCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
    this.editor.setState({ interaction: 'pinching' });
  }

  private updatePinch() {
    const pinch = this.pinch;
    if (!pinch) return;
    const pts = [...this.touches.values()];
    const [a, b] = pts as [Point, Point];
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    let vp = panBy(this.editor.state.viewport, center.x - pinch.lastCenter.x, center.y - pinch.lastCenter.y);
    vp = zoomAtPoint(vp, pinch.startZoom * (distance / pinch.startDistance), center);
    pinch.lastCenter = center;
    this.editor.setViewport(vp);
  }

  private onWheel = (e: WheelEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && target !== this.surface && target.closest('[data-inkflow-ui]')) return;
    e.preventDefault();
    const { dx, dy } = normalizeWheel(e);
    const vp = this.editor.state.viewport;
    const screen = this.toScreen(e);
    const pinchZoom = e.ctrlKey || e.metaKey;
    if (pinchZoom || (this.editor.state.zoomWithWheel && !e.shiftKey)) {
      // Trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels send larger steps.
      const intensity = pinchZoom && Math.abs(dy) < 50 ? 0.01 : 0.0025;
      const factor = Math.exp(-dy * intensity);
      this.editor.setViewport(zoomAtPoint(vp, vp.zoom * factor, screen));
      return;
    }
    if (e.shiftKey && dx === 0) {
      this.editor.setViewport(panBy(vp, -dy, 0));
    } else {
      this.editor.setViewport(panBy(vp, -dx, -dy));
    }
  };

  private onGestureStart = (e: Event & { scale?: number }) => {
    e.preventDefault();
    this.safariGestureZoom = this.editor.state.viewport.zoom;
  };

  private onGestureChange = (e: Event & { scale?: number; clientX?: number; clientY?: number }) => {
    e.preventDefault();
    if (this.safariGestureZoom === null || typeof e.scale !== 'number') return;
    const screen = this.toScreen({ clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 });
    this.editor.setViewport(zoomAtPoint(this.editor.state.viewport, this.safariGestureZoom * e.scale, screen));
  };

  private onGestureEnd = (e: Event) => {
    e.preventDefault();
    this.safariGestureZoom = null;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !isEditableTarget(e.target) && !this.editor.state.textEdit) {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.editor.setState({ cursor: 'grab' });
      }
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' && this.spaceDown) {
      this.spaceDown = false;
      if (!this.pan) this.editor.setState({ cursor: this.editor.activeTool.cursor() });
    }
  };

  private onBlur = () => {
    this.spaceDown = false;
    this.touches.clear();
    this.pinch = null;
    if (this.pan) {
      this.pan = null;
      this.editor.setState({ interaction: 'idle' });
    }
  };

  private focusSurface() {
    const active = this.container.ownerDocument.activeElement as HTMLElement | null;
    if (active && active !== this.container && isEditableTarget(active) && !this.editor.state.textEdit) active.blur();
    if (this.container.tabIndex >= 0 && this.container.ownerDocument.activeElement !== this.container) {
      this.container.focus({ preventScroll: true });
    }
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}
