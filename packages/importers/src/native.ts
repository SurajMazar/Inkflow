import { parseDocument, type ParsedDocument } from '@inkflow/scene';
import { MAX_NATIVE_JSON_CHARS } from './limits';

/**
 * Parses a native Inkflow JSON document (`.inkflow` / `.json`). The `type: 'inkflow'` marker is
 * optional; migration and per-element validation are delegated to `parseDocument`.
 */
export function importNativeJson(text: string): ParsedDocument {
  if (typeof text !== 'string') throw new Error('Expected the file contents as text');
  if (text.length > MAX_NATIVE_JSON_CHARS) {
    throw new Error(`This file is too large to import (max ${MAX_NATIVE_JSON_CHARS / (1024 * 1024)} MB)`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('This file is not valid JSON, so it cannot be opened as an Inkflow board');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('This file does not contain an Inkflow board');
  }
  const type = (data as { type?: unknown }).type;
  if (type !== undefined && type !== 'inkflow') {
    if (type === 'excalidraw') throw new Error('This is an Excalidraw file; import it as Excalidraw instead');
    throw new Error('This file does not contain an Inkflow board');
  }
  const elements = (data as { elements?: unknown }).elements;
  if (elements !== undefined && !Array.isArray(elements)) {
    throw new Error('This file does not contain an Inkflow board');
  }
  return parseDocument(data);
}
