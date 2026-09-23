import type { SerializedDocument } from '@inkflow/shared';

/** File extensions accepted by "Import board". */
export const IMPORT_ACCEPT =
  '.inkflow,.json,.excalidraw,application/json,application/vnd.inkflow+json';

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export interface ImportedBoardFile {
  title: string;
  document: SerializedDocument;
  /** Number of elements/files that could not be imported. */
  skipped: number;
  format: 'inkflow' | 'excalidraw';
}

function titleFromFileName(name: string): string {
  const base = name.replace(/\.(inkflow|excalidraw|json)$/i, '').trim();
  return (base || 'Imported board').slice(0, 200);
}

/** `Blob.text()` with a FileReader fallback (older browsers, jsdom). */
function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error("We couldn't read this file."));
    reader.readAsText(file);
  });
}

/**
 * Reads an `.inkflow`/`.json` (native) or `.excalidraw` file into a document for
 * `POST /boards { document }`. Throws an `Error` with a user-facing message on failure.
 */
export async function readBoardFile(file: File): Promise<ImportedBoardFile> {
  if (file.size > MAX_IMPORT_BYTES)
    throw new Error('This file is too large to import (max 50 MB).');
  const text = await readText(file);
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error("This file isn't valid JSON, so it can't be imported.");
  }
  const type = json && typeof json === 'object' ? (json as { type?: unknown }).type : undefined;
  const isExcalidraw =
    /\.excalidraw$/i.test(file.name) || type === 'excalidraw' || type === 'excalidraw/clipboard';
  // Loaded on demand: the importers are only needed when a file is actually imported.
  const { importExcalidraw, importNativeJson } = await import('@inkflow/importers');
  const parsed = isExcalidraw ? importExcalidraw(json) : importNativeJson(text);
  const rawCount =
    json && typeof json === 'object' && Array.isArray((json as { elements?: unknown }).elements)
      ? (json as { elements: unknown[] }).elements.length
      : 0;
  if (parsed.document.elements.length === 0 && rawCount > 0) {
    throw new Error("We couldn't read any shapes from this file.");
  }
  const { version, elements, appState, files } = parsed.document;
  return {
    title: titleFromFileName(file.name),
    document: {
      version,
      elements: elements as unknown[],
      appState: appState as unknown as Record<string, unknown>,
      files: files as Record<string, unknown>,
    },
    skipped: parsed.issues.length,
    format: isExcalidraw ? 'excalidraw' : 'inkflow',
  };
}
