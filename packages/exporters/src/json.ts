import { serializeDocument } from '@inkflow/scene';
import type { ExportScope } from './types';

/** Serialized document (type "inkflow"), pretty-printed JSON. */
export function exportToJson(scope: ExportScope, options: { includeDeleted?: boolean } = {}): string {
  const doc = serializeDocument(scope.elements, scope.appState, scope.files, {
    includeDeleted: options.includeDeleted ?? false,
    source: 'inkflow',
  });
  return JSON.stringify(doc, null, 2);
}

/** Compact JSON used for embedding the scene into PNG/SVG files. */
export function sceneJsonForEmbedding(scope: ExportScope): string {
  return JSON.stringify(serializeDocument(scope.elements, scope.appState, scope.files, { source: 'inkflow' }));
}
