import { CURRENT_DOCUMENT_VERSION } from './document';
import { generateNKeysBetween } from './fractional-index';

type RawDocument = {
  version?: unknown;
  elements?: unknown;
  appState?: unknown;
  files?: unknown;
  [k: string]: unknown;
};
type Migration = (doc: RawDocument) => RawDocument;

/**
 * Document migrations keyed by the version they upgrade FROM. Each migration must be pure and
 * tolerant of partially malformed input; validation happens after all migrations ran.
 */
const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2: explicit fractional z-order, visibility/flip flags, links and structured grid settings.
  1: (doc) => {
    const elements = Array.isArray(doc.elements) ? doc.elements : [];
    // v1 ordered elements by array position; translate that into fractional keys.
    const keys = generateNKeysBetween(null, null, elements.length);
    const migrated = elements.map((raw, i) => {
      if (!raw || typeof raw !== 'object') return raw;
      const el = { ...(raw as Record<string, unknown>) };
      el.index = keys[i];
      el.hidden ??= false;
      el.flipX ??= false;
      el.flipY ??= false;
      el.link ??= null;
      el.customData ??= null;
      if (typeof el.opacity === 'number' && el.opacity <= 1 && el.opacity > 0)
        el.opacity = el.opacity * 100;
      return el;
    });
    const appState = (
      doc.appState && typeof doc.appState === 'object' ? doc.appState : {}
    ) as Record<string, unknown>;
    const legacyGrid = appState.gridSize;
    const nextAppState: Record<string, unknown> = { ...appState };
    if (legacyGrid === null) {
      nextAppState.gridType = 'dot';
      nextAppState.gridSize = 20;
    }
    return { ...doc, version: 2, elements: migrated, appState: nextAppState };
  },
};

export interface MigrationResult {
  document: RawDocument;
  fromVersion: number;
  applied: number[];
}

export function migrateDocument(input: RawDocument): MigrationResult {
  let doc = { ...input };
  const fromVersion =
    typeof doc.version === 'number' && Number.isInteger(doc.version) ? doc.version : 1;
  if (fromVersion > CURRENT_DOCUMENT_VERSION) {
    throw new Error(
      `This board was saved by a newer version of Inkflow (format v${fromVersion}); please update the app.`,
    );
  }
  const applied: number[] = [];
  for (let v = fromVersion; v < CURRENT_DOCUMENT_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (!migration) throw new Error(`Missing document migration from v${v}`);
    doc = migration(doc);
    applied.push(v);
  }
  doc.version = CURRENT_DOCUMENT_VERSION;
  return { document: doc, fromVersion, applied };
}
