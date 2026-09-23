import { z } from 'zod';
import { ARROWHEADS, MAX_FONT_SIZE, MAX_POINTS, MAX_TEXT_LENGTH, MIN_FONT_SIZE } from './constants';
import type { SceneElement } from './types';

const finite = z.number().finite();
const coord = finite.min(-1e8).max(1e8);
const size = finite.min(0).max(1e8);
const color = z.string().max(64);
const id = z.string().min(1).max(128);
const shortText = z.string().max(2000);

const textStyleShape = {
  fontFamily: z.enum(['hand', 'sans', 'serif', 'mono']),
  fontSize: finite.min(MIN_FONT_SIZE).max(MAX_FONT_SIZE),
  fontWeight: z.enum(['normal', 'bold']),
  fontStyle: z.enum(['normal', 'italic']),
  textDecoration: z.enum(['none', 'underline', 'line-through']),
  textAlign: z.enum(['left', 'center', 'right']),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  lineHeight: finite.min(0.5).max(5),
  letterSpacing: finite.min(-50).max(200),
};

export const shapeLabelSchema = z.object({
  ...textStyleShape,
  text: z.string().max(MAX_TEXT_LENGTH),
  color: color.nullable(),
});

export const edgeLabelSchema = z.object({
  ...textStyleShape,
  text: z.string().max(MAX_TEXT_LENGTH),
  position: finite.min(0).max(1),
  color: color.nullable(),
});

export const bindingSchema = z.object({
  elementId: id,
  portId: z.string().max(200).nullable(),
  anchor: z.tuple([finite.min(-1).max(2), finite.min(-1).max(2)]).nullable(),
  gap: finite.min(0).max(200),
});

const baseShape = {
  id,
  x: coord,
  y: coord,
  width: size,
  height: size,
  angle: finite,
  strokeColor: color,
  backgroundColor: color,
  strokeWidth: finite.min(0).max(200),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']),
  fillStyle: z.enum(['hachure', 'cross-hatch', 'zigzag', 'solid']),
  opacity: finite.min(0).max(100),
  roughness: finite.min(0).max(5),
  roundness: z.enum(['sharp', 'round']),
  locked: z.boolean(),
  hidden: z.boolean(),
  groupIds: z.array(id).max(64),
  frameId: id.nullable(),
  index: z.string().min(1).max(256),
  version: z.number().int().min(0),
  versionNonce: z.number().int(),
  seed: z.number().int(),
  isDeleted: z.boolean(),
  updated: finite,
  flipX: z.boolean(),
  flipY: z.boolean(),
  link: z.string().max(4096).nullable(),
  customData: z.record(z.string(), z.unknown()).nullable(),
};

const localPoint = z.tuple([coord, coord]);
const pressurePoint = z.tuple([coord, coord, finite.min(0).max(1)]);
const arrowhead = z.enum(ARROWHEADS as unknown as [string, ...string[]]);

const linearShape = {
  ...baseShape,
  points: z.array(localPoint).min(1).max(MAX_POINTS),
  startArrowhead: arrowhead,
  endArrowhead: arrowhead,
  startBinding: bindingSchema.nullable(),
  endBinding: bindingSchema.nullable(),
  label: edgeLabelSchema.nullable(),
};

const pathStyle = z.enum(['sharp', 'curved', 'elbow']);
const labelled = { label: shapeLabelSchema.nullable() };

const portSchema = z.object({
  id: z.string().min(1).max(128),
  side: z.enum(['top', 'right', 'bottom', 'left']),
  offset: finite.min(0).max(1),
});

const tableColumnSchema = z.object({
  id,
  name: z.string().max(200),
  dataType: z.string().max(100),
  primaryKey: z.boolean(),
  foreignKey: z.boolean(),
  nullable: z.boolean(),
  unique: z.boolean(),
  references: z.string().max(400).nullable(),
});

const fontFamily = textStyleShape.fontFamily;
const fontSize = textStyleShape.fontSize;

export const elementSchema = z.discriminatedUnion('type', [
  z.object({ ...baseShape, ...labelled, type: z.literal('rectangle') }),
  z.object({ ...baseShape, ...labelled, type: z.literal('ellipse') }),
  z.object({ ...baseShape, ...labelled, type: z.literal('diamond') }),
  z.object({ ...baseShape, ...labelled, type: z.literal('triangle') }),
  z.object({ ...baseShape, ...labelled, type: z.literal('polygon'), sides: z.number().int().min(3).max(64) }),
  z.object({
    ...baseShape,
    ...labelled,
    type: z.literal('star'),
    spikes: z.number().int().min(3).max(64),
    innerRatio: finite.min(0.05).max(0.95),
  }),
  z.object({ ...linearShape, type: z.literal('line'), pathStyle, closed: z.boolean() }),
  z.object({ ...linearShape, type: z.literal('arrow'), pathStyle }),
  z.object({
    ...linearShape,
    type: z.literal('connector'),
    routing: z.enum(['straight', 'curved', 'bezier', 'orthogonal', 'elbow']),
    edgeKind: z.enum([
      'flow',
      'association',
      'dependency',
      'inheritance',
      'realization',
      'aggregation',
      'composition',
      'relationship',
      'message',
      'transition',
    ]),
    waypoints: z.array(localPoint).max(200),
  }),
  z.object({
    ...baseShape,
    type: z.literal('freedraw'),
    points: z.array(pressurePoint).min(1).max(MAX_POINTS),
    brush: z.enum(['pencil', 'brush', 'highlighter']),
    simulatePressure: z.boolean(),
  }),
  z.object({
    ...baseShape,
    ...textStyleShape,
    type: z.literal('text'),
    text: z.string().max(MAX_TEXT_LENGTH),
    autoResize: z.boolean(),
  }),
  z.object({
    ...baseShape,
    type: z.literal('image'),
    fileId: id.nullable(),
    status: z.enum(['pending', 'saved', 'error']),
    naturalWidth: size,
    naturalHeight: size,
    crop: z.object({ x: size, y: size, width: size, height: size }).nullable(),
    lockAspectRatio: z.boolean(),
  }),
  z.object({ ...baseShape, type: z.literal('frame'), name: z.string().max(200), clip: z.boolean() }),
  z.object({
    ...baseShape,
    ...labelled,
    type: z.literal('node'),
    shape: z.string().min(1).max(64),
    icon: z.string().max(64).nullable(),
    metadata: z.record(z.string().max(100), z.string().max(2000)),
    ports: z.array(portSchema).max(64).nullable(),
    customPath: z.string().max(20_000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/).nullable(),
  }),
  z.object({
    ...baseShape,
    type: z.literal('table'),
    name: z.string().max(200),
    columns: z.array(tableColumnSchema).max(500),
    fontFamily,
    fontSize,
    headerColor: color,
  }),
  z.object({
    ...baseShape,
    type: z.literal('uml-class'),
    name: z.string().max(200),
    stereotype: z.string().max(100).nullable(),
    attributes: z.array(shortText).max(500),
    methods: z.array(shortText).max(500),
    isAbstract: z.boolean(),
    fontFamily,
    fontSize,
  }),
  z.object({
    ...baseShape,
    type: z.literal('sequence'),
    participants: z
      .array(
        z.object({
          id,
          name: z.string().max(200),
          kind: z.enum(['participant', 'actor', 'database', 'boundary', 'control', 'entity']),
        }),
      )
      .max(100),
    messages: z
      .array(
        z.object({
          id,
          from: id,
          to: id,
          label: shortText,
          kind: z.enum(['sync', 'async', 'return', 'create', 'destroy']),
        }),
      )
      .max(1000),
    notes: z
      .array(
        z.object({
          id,
          participants: z.array(id).min(1).max(2),
          afterMessage: z.number().int().min(-1),
          text: shortText,
        }),
      )
      .max(500),
    fontFamily,
    fontSize,
    participantSpacing: finite.min(40).max(2000),
    messageSpacing: finite.min(20).max(1000),
  }),
]);

export type ElementValidationResult =
  | { success: true; element: SceneElement }
  | { success: false; error: string };

/** Validates an untrusted element (imports, network payloads). */
export function validateElement(value: unknown): ElementValidationResult {
  const result = elementSchema.safeParse(value);
  if (result.success) return { success: true, element: result.data as SceneElement };
  const issue = result.error.issues[0];
  return {
    success: false,
    error: issue ? `${issue.path.join('.') || 'element'}: ${issue.message}` : 'Invalid element',
  };
}
