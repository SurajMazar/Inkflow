/**
 * Excalidraw scene (`.excalidraw`) → Inkflow document conversion. The input is untrusted: every
 * property is type-checked, clamped or defaulted, references are remapped, and the result is
 * validated again by `parseDocument`.
 */
import {
  DEFAULT_BINDING_GAP,
  DEFAULT_TEXT_STYLE,
  MAX_FONT_SIZE,
  MAX_POINTS,
  MAX_TEXT_LENGTH,
  MIN_FONT_SIZE,
  createBinding,
  createEdgeLabel,
  createElement,
  createLabel,
  measureTextElement,
  normalizeLinearPoints,
  type Arrowhead,
  type BaseElement,
  type Binding,
  type FileMetadata,
  type FillStyle,
  type FontFamily,
  type ImageCrop,
  type LocalPoint,
  type PressurePoint,
  type SceneElement,
  type StrokeStyle,
  type TextAlign,
  type TextStyle,
  type VerticalAlign,
} from '@inkflow/elements';
import {
  CURRENT_DOCUMENT_VERSION,
  generateNKeysBetween,
  parseDocument,
  type ParsedDocument,
  type ParseIssue,
} from '@inkflow/scene';
import { generateId } from '@inkflow/shared';
import { readImageDimensions, sniffImageMime } from './image';
import { MAX_DATA_URL_CHARS, MAX_EXCALIDRAW_ELEMENTS } from './limits';
import { base64ToBytes, svgToDataUrl } from './svg-sanitize';

type Raw = Record<string, unknown>;

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const COLOR_RE = /^[#A-Za-z0-9(),.%\s-]{1,64}$/;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=\s]*)$/;
const MAX_FILES = 10_000;

const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond']);

const ARROWHEAD_MAP: Record<string, Arrowhead> = {
  arrow: 'arrow',
  triangle: 'triangle',
  triangle_outline: 'triangle-outline',
  dot: 'dot',
  circle: 'dot',
  circle_outline: 'circle-outline',
  bar: 'bar',
  diamond: 'diamond',
  diamond_outline: 'diamond-outline',
  crowfoot_one: 'er-one',
  crowfoot_many: 'er-many',
  crowfoot_one_or_many: 'er-one-many',
};

/** Excalidraw numeric font ids → Inkflow families. */
const FONT_MAP: Record<number, FontFamily> = {
  1: 'hand', // Virgil
  2: 'sans', // Helvetica
  3: 'mono', // Cascadia
  5: 'hand', // Excalifont
  6: 'sans', // Nunito
  7: 'sans', // Lilita One
  8: 'mono', // Comic Shanns
};

const FILL_STYLES: readonly FillStyle[] = ['hachure', 'cross-hatch', 'zigzag', 'solid'];
const STROKE_STYLES: readonly StrokeStyle[] = ['solid', 'dashed', 'dotted'];
const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];
const VERTICAL_ALIGNS: readonly VerticalAlign[] = ['top', 'middle', 'bottom'];

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const finiteOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const colorOr = (v: unknown, fallback: string): string => (typeof v === 'string' && COLOR_RE.test(v) ? v.trim() : fallback);

/** Keeps web, mail and in-app links; drops script/data URLs and anything unusual. */
function sanitizeLink(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const link = v.trim();
  if (link === '' || link.length > 4096) return null;
  if (/^(?:https?:|mailto:)/i.test(link) || /^[/#?]/.test(link)) return link;
  return null;
}

function mapArrowhead(v: unknown, fallback: Arrowhead): Arrowhead {
  if (v === null) return 'none';
  if (typeof v !== 'string') return fallback;
  return ARROWHEAD_MAP[v] ?? fallback;
}

function readTextStyle(raw: Raw): Pick<TextStyle, 'fontFamily' | 'fontSize' | 'textAlign' | 'verticalAlign' | 'lineHeight'> {
  const family = typeof raw.fontFamily === 'number' ? FONT_MAP[raw.fontFamily] : undefined;
  return {
    fontFamily: family ?? 'sans',
    fontSize: clamp(finiteOr(raw.fontSize, DEFAULT_TEXT_STYLE.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE),
    textAlign: oneOf(raw.textAlign, TEXT_ALIGNS, 'left'),
    verticalAlign: oneOf(raw.verticalAlign, VERTICAL_ALIGNS, 'top'),
    lineHeight: clamp(finiteOr(raw.lineHeight, DEFAULT_TEXT_STYLE.lineHeight), 0.5, 5),
  };
}

function isPointTuple(p: unknown): p is [number, number, ...unknown[]] {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

interface ConversionContext {
  issues: ParseIssue[];
  /** Original Excalidraw id → Inkflow id (first occurrence wins). */
  idMap: Map<string, string>;
  /** Inkflow id → Excalidraw type, for every element that will be emitted. */
  emittedTypes: Map<string, string>;
}

type CommonProps = Pick<
  BaseElement,
  | 'id'
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'angle'
  | 'strokeColor'
  | 'backgroundColor'
  | 'strokeWidth'
  | 'strokeStyle'
  | 'fillStyle'
  | 'opacity'
  | 'roughness'
  | 'roundness'
  | 'locked'
  | 'groupIds'
  | 'frameId'
  | 'link'
> & { seed?: number };

function readCommon(raw: Raw, id: string, ctx: ConversionContext): CommonProps {
  const groupIds: string[] = [];
  if (Array.isArray(raw.groupIds)) {
    for (const g of raw.groupIds) {
      if (typeof g === 'string' && ID_RE.test(g) && !groupIds.includes(g)) groupIds.push(g);
      if (groupIds.length >= 64) break;
    }
  }
  let frameId: string | null = null;
  if (typeof raw.frameId === 'string') {
    const mapped = ctx.idMap.get(raw.frameId);
    if (mapped && ctx.emittedTypes.get(mapped) === 'frame') frameId = mapped;
  }
  const hasRoundness = isRecord(raw.roundness) || raw.strokeSharpness === 'round';
  const common: CommonProps = {
    id,
    x: finiteOr(raw.x, 0),
    y: finiteOr(raw.y, 0),
    width: Math.abs(finiteOr(raw.width, 0)),
    height: Math.abs(finiteOr(raw.height, 0)),
    angle: finiteOr(raw.angle, 0),
    strokeColor: colorOr(raw.strokeColor, '#1e1e1e'),
    backgroundColor: colorOr(raw.backgroundColor, 'transparent'),
    strokeWidth: clamp(finiteOr(raw.strokeWidth, 2), 0, 200),
    strokeStyle: oneOf(raw.strokeStyle, STROKE_STYLES, 'solid'),
    fillStyle: oneOf(raw.fillStyle, FILL_STYLES, 'hachure'),
    opacity: clamp(finiteOr(raw.opacity, 100), 0, 100),
    roughness: clamp(finiteOr(raw.roughness, 1), 0, 5),
    roundness: hasRoundness ? 'round' : 'sharp',
    locked: raw.locked === true,
    groupIds,
    frameId,
    link: sanitizeLink(raw.link),
  };
  if (typeof raw.seed === 'number' && Number.isInteger(raw.seed)) common.seed = raw.seed;
  return common;
}

function readPoints(raw: Raw, id: string, ctx: ConversionContext): LocalPoint[] {
  const source = Array.isArray(raw.points) ? raw.points : [];
  const points: LocalPoint[] = [];
  for (const p of source) {
    if (!isPointTuple(p)) continue;
    if (points.length >= MAX_POINTS) {
      ctx.issues.push({ elementId: id, message: `Too many points; truncated to ${MAX_POINTS}` });
      break;
    }
    points.push([p[0], p[1]]);
  }
  return points;
}

function readText(raw: Raw, prefer: 'text' | 'originalText'): string {
  const primary = raw[prefer];
  const secondary = raw[prefer === 'text' ? 'originalText' : 'text'];
  const text = typeof primary === 'string' ? primary : typeof secondary === 'string' ? secondary : '';
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
}

function readBinding(value: unknown, ctx: ConversionContext): Binding | null {
  if (!isRecord(value) || typeof value.elementId !== 'string') return null;
  const target = ctx.idMap.get(value.elementId);
  if (!target) return null;
  const targetType = ctx.emittedTypes.get(target);
  if (!targetType || targetType === 'arrow' || targetType === 'line' || targetType === 'freedraw') return null;
  return createBinding(target, { gap: clamp(finiteOr(value.gap, DEFAULT_BINDING_GAP), 0, 200) });
}

interface FileInfo {
  meta: Omit<FileMetadata, 'width' | 'height'>;
  natural: { width: number; height: number } | null;
}

function convertFiles(files: unknown, issues: ParseIssue[]): Map<string, FileInfo> {
  const out = new Map<string, FileInfo>();
  if (!isRecord(files)) return out;
  let count = 0;
  for (const [key, value] of Object.entries(files)) {
    if (++count > MAX_FILES) {
      issues.push({ elementId: null, message: `Too many files; only the first ${MAX_FILES} were imported` });
      break;
    }
    if (!ID_RE.test(key) || !isRecord(value)) {
      issues.push({ elementId: null, message: `Invalid file entry "${key.slice(0, 64)}" was skipped` });
      continue;
    }
    const dataURL = value.dataURL;
    if (typeof dataURL !== 'string' || dataURL.length > MAX_DATA_URL_CHARS) {
      issues.push({ elementId: null, message: `File ${key} has no usable image data and was skipped` });
      continue;
    }
    const match = DATA_URL_RE.exec(dataURL);
    if (!match) {
      issues.push({ elementId: null, message: `File ${key} is not an embedded PNG, JPEG, WebP, GIF or SVG image and was skipped` });
      continue;
    }
    const mimeType = match[1]!;
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(match[2]!);
    } catch {
      issues.push({ elementId: null, message: `File ${key} contains corrupt image data and was skipped` });
      continue;
    }
    if (sniffImageMime(bytes) !== mimeType) {
      issues.push({ elementId: null, message: `File ${key} content does not match its declared type and was skipped` });
      continue;
    }
    let url = dataURL.replace(/\s+/g, '');
    let size = bytes.length;
    if (mimeType === 'image/svg+xml') {
      try {
        url = svgToDataUrl(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
      } catch {
        issues.push({ elementId: null, message: `File ${key} contains an invalid SVG image and was skipped` });
        continue;
      }
      size = Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);
      if (url.length > MAX_DATA_URL_CHARS) {
        issues.push({ elementId: null, message: `File ${key} is too large and was skipped` });
        continue;
      }
    }
    const natural = readImageDimensions(bytes, mimeType);
    out.set(key, {
      meta: { id: key, mimeType, url, size, created: finiteOr(value.created, Date.now()) },
      natural: natural && natural.width > 0 && natural.height > 0 ? natural : null,
    });
  }
  return out;
}

/**
 * Converts an Excalidraw scene into an Inkflow document. Throws when the input is not an
 * Excalidraw scene; element-level problems are reported in `issues` instead.
 */
export function importExcalidraw(json: unknown): ParsedDocument {
  if (!isRecord(json)) throw new Error('Not an Excalidraw file');
  if (json.type !== undefined && json.type !== 'excalidraw' && json.type !== 'excalidraw/clipboard') {
    throw new Error('Not an Excalidraw file');
  }
  if (!Array.isArray(json.elements)) throw new Error('Not an Excalidraw file');

  const issues: ParseIssue[] = [];
  const live: Raw[] = [];
  for (const raw of json.elements) {
    if (!isRecord(raw) || raw.isDeleted === true) continue;
    if (live.length >= MAX_EXCALIDRAW_ELEMENTS) {
      issues.push({ elementId: null, message: `Too many elements; only the first ${MAX_EXCALIDRAW_ELEMENTS} were imported` });
      break;
    }
    live.push(raw);
  }

  // Assign Inkflow ids (keeping valid, unique Excalidraw ids) and remember references.
  const ctx: ConversionContext = { issues, idMap: new Map(), emittedTypes: new Map() };
  const used = new Set<string>();
  const ids: string[] = live.map((raw) => {
    const original = typeof raw.id === 'string' ? raw.id : '';
    const id = ID_RE.test(original) && !used.has(original) ? original : generateId();
    used.add(id);
    if (original && !ctx.idMap.has(original)) ctx.idMap.set(original, id);
    return id;
  });
  const rawById = new Map<string, Raw>();
  live.forEach((raw, i) => rawById.set(ids[i]!, raw));

  // Bound text becomes the label of its container.
  const shapeLabels = new Map<string, Raw>();
  const edgeLabels = new Map<string, Raw>();
  const consumed = new Set<number>();
  live.forEach((raw, i) => {
    if (raw.type !== 'text' || typeof raw.containerId !== 'string') return;
    const containerId = ctx.idMap.get(raw.containerId);
    const container = containerId ? rawById.get(containerId) : undefined;
    if (!containerId || !container) return;
    const target = SHAPE_TYPES.has(String(container.type))
      ? shapeLabels
      : container.type === 'arrow'
        ? edgeLabels
        : null;
    if (!target || target.has(containerId)) return;
    target.set(containerId, raw);
    consumed.add(i);
  });

  // Determine which elements will be emitted (needed to validate bindings and frame refs).
  const SUPPORTED = new Set(['rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'freedraw', 'text', 'image', 'frame', 'magicframe']);
  live.forEach((raw, i) => {
    if (consumed.has(i) || !SUPPORTED.has(String(raw.type))) return;
    ctx.emittedTypes.set(ids[i]!, raw.type === 'magicframe' ? 'frame' : String(raw.type));
  });

  const files = convertFiles(json.files, issues);
  const fileDims = new Map<string, { width: number; height: number }>();
  const elements: SceneElement[] = [];

  live.forEach((raw, i) => {
    if (consumed.has(i)) return;
    const id = ids[i]!;
    const type = String(raw.type);
    if (!SUPPORTED.has(type)) {
      const label = type === 'embeddable' || type === 'iframe' ? `Embedded web content (${type}) is not supported` : `Unsupported element type "${type.slice(0, 40)}"`;
      issues.push({ elementId: id, message: `${label}; the element was skipped` });
      return;
    }
    const common = readCommon(raw, id, ctx);
    switch (type) {
      case 'rectangle':
      case 'ellipse':
      case 'diamond': {
        const labelRaw = shapeLabels.get(id);
        const label = labelRaw
          ? createLabel(readText(labelRaw, 'originalText'), {
              ...readTextStyle(labelRaw),
              color: colorOr(labelRaw.strokeColor, common.strokeColor),
            })
          : null;
        elements.push(createElement(type, { ...common, label }));
        break;
      }
      case 'line':
      case 'arrow': {
        const points = readPoints(raw, id, ctx);
        if (points.length === 0) points.push([0, 0], [common.width, common.height]);
        const box = normalizeLinearPoints(common.x, common.y, points);
        const curved = isRecord(raw.roundness);
        if (type === 'line') {
          elements.push(
            createElement('line', {
              ...common,
              ...box,
              pathStyle: curved ? 'curved' : 'sharp',
              closed: raw.polygon === true,
              startArrowhead: mapArrowhead(raw.startArrowhead, 'none'),
              endArrowhead: mapArrowhead(raw.endArrowhead, 'none'),
            }),
          );
          break;
        }
        const labelRaw = edgeLabels.get(id);
        const label = labelRaw
          ? createEdgeLabel(readText(labelRaw, 'originalText'), {
              ...readTextStyle(labelRaw),
              color: colorOr(labelRaw.strokeColor, common.strokeColor),
              position: 0.5,
            })
          : null;
        elements.push(
          createElement('arrow', {
            ...common,
            ...box,
            pathStyle: raw.elbowed === true ? 'elbow' : curved ? 'curved' : 'sharp',
            startArrowhead: mapArrowhead(raw.startArrowhead, 'none'),
            endArrowhead: mapArrowhead(raw.endArrowhead, 'arrow'),
            startBinding: readBinding(raw.startBinding, ctx),
            endBinding: readBinding(raw.endBinding, ctx),
            label,
          }),
        );
        break;
      }
      case 'freedraw': {
        const pressures = Array.isArray(raw.pressures) ? raw.pressures : [];
        const points: PressurePoint[] = readPoints(raw, id, ctx).map((p, k) => [
          p[0],
          p[1],
          clamp(finiteOr(pressures[k], 0.5), 0, 1),
        ]);
        if (points.length === 0) points.push([0, 0, 0.5]);
        const box = normalizeLinearPoints(common.x, common.y, points);
        elements.push(
          createElement('freedraw', {
            ...common,
            ...box,
            simulatePressure: typeof raw.simulatePressure === 'boolean' ? raw.simulatePressure : pressures.length === 0,
          }),
        );
        break;
      }
      case 'text': {
        const autoResize = raw.autoResize !== false;
        const text = readText(raw, autoResize ? 'text' : 'originalText');
        const style = readTextStyle(raw);
        const el = createElement('text', { ...common, ...style, text, autoResize });
        if (el.width <= 0 || el.height <= 0) {
          const measured = measureTextElement(el);
          el.width = measured.width;
          el.height = measured.height;
        }
        elements.push(el);
        break;
      }
      case 'image': {
        const fileId = typeof raw.fileId === 'string' && ID_RE.test(raw.fileId) ? raw.fileId : null;
        const file = fileId ? files.get(fileId) : undefined;
        if (!file) issues.push({ elementId: id, message: 'Image file data is missing' });
        let crop: ImageCrop | null = null;
        let cropNatural: { width: number; height: number } | null = null;
        if (isRecord(raw.crop)) {
          const c = raw.crop;
          const values = [c.x, c.y, c.width, c.height].map((v) => finiteOr(v, -1));
          if (values.every((v) => v >= 0)) {
            crop = { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! };
          }
          const nw = finiteOr(c.naturalWidth, 0);
          const nh = finiteOr(c.naturalHeight, 0);
          if (nw > 0 && nh > 0) cropNatural = { width: nw, height: nh };
        }
        const natural = file?.natural ?? cropNatural ?? { width: common.width, height: common.height };
        if (fileId && file && !fileDims.has(fileId)) fileDims.set(fileId, natural);
        elements.push(
          createElement('image', {
            ...common,
            fileId: file ? fileId : null,
            status: file ? 'saved' : 'error',
            naturalWidth: natural.width,
            naturalHeight: natural.height,
            crop,
            lockAspectRatio: true,
          }),
        );
        break;
      }
      case 'frame':
      case 'magicframe': {
        const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.slice(0, 200) : 'Frame';
        elements.push(createElement('frame', { ...common, name }));
        break;
      }
    }
  });

  const keys = generateNKeysBetween(null, null, elements.length);
  elements.forEach((el, i) => {
    el.index = keys[i]!;
  });

  const fileMap: Record<string, FileMetadata> = {};
  for (const [key, info] of files) {
    const dims = info.natural ?? fileDims.get(key) ?? { width: 0, height: 0 };
    fileMap[key] = { ...info.meta, width: dims.width, height: dims.height };
  }

  const appState = isRecord(json.appState) ? json.appState : {};
  const inkflowAppState: Raw = {};
  if (typeof appState.viewBackgroundColor === 'string') inkflowAppState.viewBackgroundColor = colorOr(appState.viewBackgroundColor, '#ffffff');
  if (typeof appState.gridSize === 'number' && Number.isInteger(appState.gridSize)) inkflowAppState.gridSize = appState.gridSize;

  const parsed = parseDocument({
    type: 'inkflow',
    version: CURRENT_DOCUMENT_VERSION,
    elements,
    appState: inkflowAppState,
    files: fileMap,
  });
  return { ...parsed, issues: [...parsed.issues, ...issues] };
}
