/**
 * Size and complexity limits applied to untrusted import input. They bound memory and CPU use
 * so that hostile files fail fast with a friendly error instead of freezing the tab.
 */

/** Maximum length (UTF-16 code units) of a native `.inkflow` JSON document. */
export const MAX_NATIVE_JSON_CHARS = 50 * 1024 * 1024;

/** Maximum number of Excalidraw elements converted; the rest is dropped with an issue. */
export const MAX_EXCALIDRAW_ELEMENTS = 100_000;

/** Maximum length (UTF-16 code units) of SVG markup accepted by the sanitizer and importer. */
export const MAX_SVG_CHARS = 5 * 1024 * 1024;

/** Maximum number of markup tokens (tags, text runs, comments…) the XML tokenizer produces. */
export const MAX_XML_TOKENS = 500_000;

/** Maximum element nesting depth; deeper markup is rejected. */
export const MAX_XML_DEPTH = 256;

/** Default cap on native elements produced from one SVG. */
export const DEFAULT_SVG_MAX_ELEMENTS = 2000;

/** Maximum nesting of `<use>` references expanded while importing an SVG. */
export const MAX_SVG_USE_DEPTH = 8;

/** Maximum number of SVG nodes visited while importing (bounds `<use>` fan-out bombs). */
export const MAX_SVG_VISITED_NODES = 200_000;

/** Largest accepted image width or height in pixels. */
export const MAX_IMAGE_DIMENSION = 32_768;

/** Largest accepted raster image area (decompression-bomb guard). */
export const MAX_IMAGE_PIXELS = 100_000_000;

/** Longest data URL kept for an imported file (matches the document file-metadata schema). */
export const MAX_DATA_URL_CHARS = 10_000_000;
