import {
  FONT_FAMILIES,
  type FileMetadata,
  type FontFamily,
  type SceneElement,
} from '@inkflow/elements';
import { renderSceneToSvg } from '@inkflow/renderer';
import { elementsForExport, getExportBounds } from './bounds';
import { sceneJsonForEmbedding } from './json';
import type { ExportFontSource, ExportScope, RasterExportOptions } from './types';

export type SvgExportOptions = Omit<RasterExportOptions, 'scale'> & {
  scale?: number;
  embedFonts: boolean;
  fontSources?: ExportFontSource[];
  loadImageDataUrl: (file: FileMetadata) => Promise<string>;
  /** Font loader (defaults to fetch). */
  fetchFont?: (url: string) => Promise<ArrayBuffer>;
};

/** Font families used by the elements (text, labels, diagram text, frame names). */
export function usedFontFamilies(elements: readonly SceneElement[]): Set<FontFamily> {
  const used = new Set<FontFamily>();
  for (const el of elements) {
    if (el.isDeleted || el.hidden) continue;
    switch (el.type) {
      case 'text':
        if (el.text) used.add(el.fontFamily);
        break;
      case 'table':
      case 'uml-class':
      case 'sequence':
        used.add(el.fontFamily);
        break;
      case 'frame':
        if (el.name) used.add('sans');
        break;
      default:
        if ('label' in el && el.label && el.label.text) used.add(el.label.fontFamily);
    }
  }
  return used;
}

function fontMime(url: string): string {
  const path = url.split(/[?#]/)[0]!.toLowerCase();
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.woff')) return 'font/woff';
  if (path.endsWith('.otf')) return 'font/otf';
  if (path.endsWith('.ttf')) return 'font/ttf';
  return 'font/woff2';
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function defaultFetchFont(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Font request failed (${res.status})`);
  return res.arrayBuffer();
}

/** Standalone SVG (vector shapes, embedded images, optional embedded fonts and scene metadata). */
export async function exportToSvgString(
  scope: ExportScope,
  options: SvgExportOptions,
): Promise<string> {
  const bounds = getExportBounds(scope, options);
  const elements = elementsForExport(scope, options.frameId);
  const imageData: Record<string, string> = {};
  const ids = new Set<string>();
  for (const el of elements) if (el.type === 'image' && el.fileId) ids.add(el.fileId);
  await Promise.all(
    [...ids].map(async (id) => {
      const file = scope.files[id];
      if (!file) return;
      try {
        imageData[id] = await options.loadImageDataUrl(file);
      } catch {
        // Unavailable images render as placeholders.
      }
    }),
  );

  let fontFaces: { family: string; dataUrl: string; weight?: string; style?: string }[] | undefined;
  if (options.embedFonts && options.fontSources && options.fontSources.length > 0) {
    const used = usedFontFamilies(elements);
    const css = [...used].map((f) => FONT_FAMILIES[f].css.toLowerCase());
    const wanted = options.fontSources.filter((src) =>
      css.some(
        (c) => c.includes(`"${src.family.toLowerCase()}"`) || c.includes(src.family.toLowerCase()),
      ),
    );
    const fetchFont = options.fetchFont ?? defaultFetchFont;
    const loaded = await Promise.all(
      wanted.map(async (src) => {
        try {
          const buf = await fetchFont(src.url);
          return {
            family: src.family,
            dataUrl: `data:${fontMime(src.url)};base64,${bytesToBase64(new Uint8Array(buf))}`,
            ...(src.weight ? { weight: src.weight } : {}),
            ...(src.style ? { style: src.style } : {}),
          };
        } catch {
          return null;
        }
      }),
    );
    fontFaces = loaded.filter((f): f is NonNullable<typeof f> => f !== null);
  }

  return renderSceneToSvg(elements, {
    bounds,
    scale: options.scale && options.scale > 0 ? options.scale : 1,
    background: options.background ? scope.appState.viewBackgroundColor : null,
    theme: options.darkMode ? 'dark' : 'light',
    imageData,
    files: scope.files,
    ...(fontFaces && fontFaces.length > 0 ? { fontFaces } : {}),
    showFrameNames: !options.frameId && !options.bounds,
    getElement: scope.getElement,
    ...(options.embedScene ? { metadata: sceneJsonForEmbedding(scope) } : {}),
  });
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Scene JSON embedded in an SVG exported with `embedScene`, or null. */
export function extractSceneFromSvg(svg: string): string | null {
  const m = /<metadata>([\s\S]*?)<\/metadata>/.exec(svg);
  if (!m) return null;
  return m[1]!.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? all;
  });
}
