import {
  createElement,
  validateElement,
  type ElementType,
  type FileMetadata,
  type SceneElement,
} from '@inkflow/elements';
import { z } from 'zod';
import {
  CURRENT_DOCUMENT_VERSION,
  DEFAULT_DOCUMENT_APP_STATE,
  type DocumentAppState,
  type SceneDocument,
} from './document';
import { compareOrder, generateNKeysBetween, isValidOrderKey } from './fractional-index';
import { migrateDocument } from './migrations';

const ELEMENT_TYPES: readonly ElementType[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'triangle',
  'polygon',
  'star',
  'line',
  'arrow',
  'connector',
  'freedraw',
  'text',
  'image',
  'frame',
  'node',
  'table',
  'uml-class',
  'sequence',
];

const appStateSchema = z.object({
  viewBackgroundColor: z.string().max(64).catch(DEFAULT_DOCUMENT_APP_STATE.viewBackgroundColor),
  gridType: z.enum(['dot', 'square', 'isometric']).catch(DEFAULT_DOCUMENT_APP_STATE.gridType),
  gridSize: z.number().int().min(4).max(200).catch(DEFAULT_DOCUMENT_APP_STATE.gridSize),
  frameOrder: z.array(z.string().max(128)).max(5000).catch([]),
});

const fileMetadataSchema = z.object({
  id: z.string().min(1).max(128),
  mimeType: z.string().max(100),
  url: z.string().max(10_000_000),
  width: z.number().min(0),
  height: z.number().min(0),
  size: z.number().min(0),
  created: z.number(),
});

export interface ParseIssue {
  elementId: string | null;
  message: string;
}

export interface ParsedDocument {
  document: SceneDocument;
  issues: ParseIssue[];
  migratedFrom: number;
}

/**
 * Fills defaults for missing properties so that partially specified elements (older files,
 * templates, imports) become complete. Unknown types return null.
 */
export function restoreElement(raw: unknown): SceneElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const type = obj.type as ElementType;
  if (!ELEMENT_TYPES.includes(type)) return null;
  const defined = Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
  return createElement(type, defined as never);
}

export function sanitizeAppState(raw: unknown): DocumentAppState {
  const base = raw && typeof raw === 'object' ? raw : {};
  return appStateSchema.parse({ ...DEFAULT_DOCUMENT_APP_STATE, ...base });
}

/** Ensures every element has a valid, unique fractional index, preserving relative order. */
export function repairIndices(elements: SceneElement[]): SceneElement[] {
  const seen = new Set<string>();
  const needsRepair = elements.some((el) => {
    const bad = !isValidOrderKey(el.index) || seen.has(el.index);
    seen.add(el.index);
    return bad;
  });
  if (!needsRepair) return elements;
  const keys = generateNKeysBetween(null, null, elements.length);
  return elements.map((el, i) => ({ ...el, index: keys[i]! }));
}

/**
 * Parses, migrates and validates an untrusted document. Invalid elements are dropped and
 * reported instead of failing the whole document.
 */
export function parseDocument(input: unknown): ParsedDocument {
  if (!input || typeof input !== 'object') throw new Error('Document must be a JSON object');
  const { document: migrated, fromVersion } = migrateDocument(input as Record<string, unknown>);
  const rawElements = Array.isArray(migrated.elements) ? migrated.elements : [];
  const issues: ParseIssue[] = [];
  const elements: SceneElement[] = [];
  const ids = new Set<string>();
  for (const raw of rawElements) {
    const restored = restoreElement(raw);
    const rawId = raw && typeof raw === 'object' ? String((raw as { id?: unknown }).id ?? '') : '';
    if (!restored) {
      issues.push({ elementId: rawId || null, message: 'Unknown or malformed element' });
      continue;
    }
    const result = validateElement(restored);
    if (!result.success) {
      issues.push({ elementId: rawId || null, message: result.error });
      continue;
    }
    if (ids.has(result.element.id)) {
      issues.push({ elementId: result.element.id, message: 'Duplicate element id' });
      continue;
    }
    ids.add(result.element.id);
    elements.push(result.element);
  }
  // Preserve file order for elements whose index was invalid, then sort by fractional order.
  const repaired = repairIndices(elements).sort(compareOrder);

  const files: Record<string, FileMetadata> = {};
  if (migrated.files && typeof migrated.files === 'object') {
    for (const [key, value] of Object.entries(migrated.files as Record<string, unknown>)) {
      const parsed = fileMetadataSchema.safeParse(value);
      if (parsed.success) files[key] = parsed.data;
      else issues.push({ elementId: null, message: `Invalid file metadata for ${key}` });
    }
  }
  return {
    document: {
      type: 'inkflow',
      version: CURRENT_DOCUMENT_VERSION,
      elements: repaired,
      appState: sanitizeAppState(migrated.appState),
      files,
    },
    issues,
    migratedFrom: fromVersion,
  };
}

export function createEmptyDocument(): SceneDocument {
  return {
    type: 'inkflow',
    version: CURRENT_DOCUMENT_VERSION,
    elements: [],
    appState: { ...DEFAULT_DOCUMENT_APP_STATE },
    files: {},
  };
}

export function serializeDocument(
  elements: readonly SceneElement[],
  appState: DocumentAppState,
  files: Record<string, FileMetadata>,
  options: { includeDeleted?: boolean; source?: string } = {},
): SceneDocument {
  const list = (options.includeDeleted ? [...elements] : elements.filter((e) => !e.isDeleted)).sort(
    compareOrder,
  );
  const usedFiles = new Set(
    list.flatMap((e) => (e.type === 'image' && e.fileId ? [e.fileId] : [])),
  );
  const filteredFiles = Object.fromEntries(
    Object.entries(files).filter(([id]) => usedFiles.has(id)),
  );
  return {
    type: 'inkflow',
    version: CURRENT_DOCUMENT_VERSION,
    source: options.source,
    elements: list,
    appState: { ...appState },
    files: filteredFiles,
  };
}
