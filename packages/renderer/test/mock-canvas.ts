/**
 * Recording CanvasRenderingContext2D double for Node tests: tracks state (styles, transform,
 * save/restore stack) and records every call with the style snapshot relevant to it.
 */
type M = [number, number, number, number, number, number];

export interface RecordedCall {
  name: string;
  args: unknown[];
  /** Style snapshot for paint operations. */
  style?: {
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    globalAlpha: number;
    dash: number[];
    filter: string;
    font: string;
  };
  /** Device-space points of the current path for fill/stroke/clip. */
  points?: [number, number][];
  /** Current transform at call time. */
  transform?: M;
}

interface State {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  lineCap: string;
  lineJoin: string;
  filter: string;
  globalCompositeOperation: string;
  letterSpacing: string;
  dash: number[];
  transform: M;
}

const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export class RecordingContext {
  calls: RecordedCall[] = [];
  canvas: MockCanvas;
  private state: State = RecordingContext.initial();
  private stack: State[] = [];
  private path: [number, number][] = [];
  /** When false only paint calls are recorded (performance tests). */
  recordAll = true;

  constructor(canvas: MockCanvas) {
    this.canvas = canvas;
  }

  static initial(): State {
    return {
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      globalAlpha: 1,
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      lineCap: 'butt',
      lineJoin: 'miter',
      filter: 'none',
      globalCompositeOperation: 'source-over',
      letterSpacing: '0px',
      dash: [],
      transform: [1, 0, 0, 1, 0, 0],
    };
  }

  get depth(): number {
    return this.stack.length;
  }

  get currentTransform(): M {
    return this.state.transform;
  }

  // --- state properties
  get fillStyle(): string {
    return this.state.fillStyle;
  }
  set fillStyle(v: string) {
    this.state.fillStyle = v;
  }
  get strokeStyle(): string {
    return this.state.strokeStyle;
  }
  set strokeStyle(v: string) {
    this.state.strokeStyle = v;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(v: number) {
    this.state.lineWidth = v;
  }
  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(v: number) {
    this.state.globalAlpha = v;
  }
  get font(): string {
    return this.state.font;
  }
  set font(v: string) {
    this.state.font = v;
  }
  get textAlign(): string {
    return this.state.textAlign;
  }
  set textAlign(v: string) {
    this.state.textAlign = v;
  }
  get textBaseline(): string {
    return this.state.textBaseline;
  }
  set textBaseline(v: string) {
    this.state.textBaseline = v;
  }
  get lineCap(): string {
    return this.state.lineCap;
  }
  set lineCap(v: string) {
    this.state.lineCap = v;
  }
  get lineJoin(): string {
    return this.state.lineJoin;
  }
  set lineJoin(v: string) {
    this.state.lineJoin = v;
  }
  get filter(): string {
    return this.state.filter;
  }
  set filter(v: string) {
    this.state.filter = v;
  }
  get globalCompositeOperation(): string {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(v: string) {
    this.state.globalCompositeOperation = v;
  }
  get letterSpacing(): string {
    return this.state.letterSpacing;
  }
  set letterSpacing(v: string) {
    this.state.letterSpacing = v;
  }

  private rec(name: string, args: unknown[], paint = false): void {
    if (!this.recordAll && !paint) return;
    const call: RecordedCall = { name, args };
    if (paint) {
      const s = this.state;
      call.style = {
        fillStyle: s.fillStyle,
        strokeStyle: s.strokeStyle,
        lineWidth: s.lineWidth,
        globalAlpha: s.globalAlpha,
        dash: [...s.dash],
        filter: s.filter,
        font: s.font,
      };
      call.transform = [...s.transform] as M;
    }
    this.calls.push(call);
  }

  private tp(x: number, y: number): [number, number] {
    const m = this.state.transform;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  save(): void {
    this.stack.push({ ...this.state, dash: [...this.state.dash] });
    this.rec('save', []);
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) this.state = s;
    this.rec('restore', []);
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.transform = [a, b, c, d, e, f];
    this.rec('setTransform', [a, b, c, d, e, f]);
  }
  resetTransform(): void {
    this.setTransform(1, 0, 0, 1, 0, 0);
  }
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a, b, c, d, e, f] = this.state.transform;
    return { a, b, c, d, e, f };
  }
  translate(x: number, y: number): void {
    this.state.transform = mul(this.state.transform, [1, 0, 0, 1, x, y]);
    this.rec('translate', [x, y]);
  }
  rotate(a: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.state.transform = mul(this.state.transform, [c, s, -s, c, 0, 0]);
    this.rec('rotate', [a]);
  }
  scale(x: number, y: number): void {
    this.state.transform = mul(this.state.transform, [x, 0, 0, y, 0, 0]);
    this.rec('scale', [x, y]);
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.transform = mul(this.state.transform, [a, b, c, d, e, f]);
    this.rec('transform', [a, b, c, d, e, f]);
  }
  setLineDash(d: number[]): void {
    this.state.dash = [...d];
    this.rec('setLineDash', [[...d]]);
  }
  getLineDash(): number[] {
    return [...this.state.dash];
  }
  beginPath(): void {
    this.path = [];
    this.rec('beginPath', []);
  }
  moveTo(x: number, y: number): void {
    this.path.push(this.tp(x, y));
    this.rec('moveTo', [x, y]);
  }
  lineTo(x: number, y: number): void {
    this.path.push(this.tp(x, y));
    this.rec('lineTo', [x, y]);
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.path.push(this.tp(x, y));
    this.rec('bezierCurveTo', [x1, y1, x2, y2, x, y]);
  }
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void {
    this.path.push(this.tp(x, y));
    this.rec('quadraticCurveTo', [x1, y1, x, y]);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void {
    this.path.push(this.tp(x + r * Math.cos(a0), y + r * Math.sin(a0)));
    this.rec('arc', [x, y, r, a0, a1, ccw]);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this.path.push(this.tp(x2, y2));
    this.rec('arcTo', [x1, y1, x2, y2, r]);
  }
  ellipse(...args: number[]): void {
    this.rec('ellipse', args);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.path.push(this.tp(x, y), this.tp(x + w, y), this.tp(x + w, y + h), this.tp(x, y + h));
    this.rec('rect', [x, y, w, h]);
  }
  closePath(): void {
    this.rec('closePath', []);
  }
  fill(rule?: unknown): void {
    const call: RecordedCall = { name: 'fill', args: rule === undefined ? [] : [rule] };
    this.recPaint(call);
  }
  stroke(): void {
    this.recPaint({ name: 'stroke', args: [] });
  }
  clip(rule?: unknown): void {
    this.recPaint({ name: 'clip', args: rule === undefined ? [] : [rule] });
  }
  private recPaint(call: RecordedCall): void {
    const s = this.state;
    call.style = {
      fillStyle: s.fillStyle,
      strokeStyle: s.strokeStyle,
      lineWidth: s.lineWidth,
      globalAlpha: s.globalAlpha,
      dash: [...s.dash],
      filter: s.filter,
      font: s.font,
    };
    call.points = this.path.slice();
    call.transform = [...s.transform] as M;
    this.calls.push(call);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rec('fillRect', [x, y, w, h], true);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.rec('strokeRect', [x, y, w, h], true);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.rec('clearRect', [x, y, w, h]);
  }
  fillText(text: string, x: number, y: number): void {
    this.rec('fillText', [text, x, y], true);
  }
  strokeText(text: string, x: number, y: number): void {
    this.rec('strokeText', [text, x, y], true);
  }
  measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }
  drawImage(...args: unknown[]): void {
    this.rec('drawImage', args, true);
  }
  getImageData(
    _x: number,
    _y: number,
    w: number,
    h: number,
  ): { data: Uint8ClampedArray; width: number; height: number } {
    this.rec('getImageData', [w, h]);
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  putImageData(...args: unknown[]): void {
    this.rec('putImageData', args.slice(1));
  }

  // --- analysis helpers
  count(name: string): number {
    let n = 0;
    for (const c of this.calls) if (c.name === name) n++;
    return n;
  }

  named(name: string): RecordedCall[] {
    return this.calls.filter((c) => c.name === name);
  }

  reset(): void {
    this.calls = [];
  }
}

export class MockCanvas {
  width = 300;
  height = 150;
  style: Record<string, string> = {};
  readonly ctx: RecordingContext;

  constructor(width = 300, height = 150) {
    this.width = width;
    this.height = height;
    this.ctx = new RecordingContext(this);
  }

  getContext(type: string): RecordingContext | null {
    return type === '2d' ? this.ctx : null;
  }
}

export function mockCanvas(
  width = 800,
  height = 600,
): { canvas: HTMLCanvasElement; ctx: RecordingContext; mock: MockCanvas } {
  const mock = new MockCanvas(width, height);
  return { canvas: mock as unknown as HTMLCanvasElement, ctx: mock.ctx, mock };
}

export const asCtx = (ctx: RecordingContext): CanvasRenderingContext2D =>
  ctx as unknown as CanvasRenderingContext2D;
