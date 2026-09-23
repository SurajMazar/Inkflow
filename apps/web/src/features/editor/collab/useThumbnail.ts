import type { Editor } from '@inkflow/canvas-engine';
import { getCommonBounds, type FileMetadata } from '@inkflow/elements';
import { exportToPngBlob } from '@inkflow/exporters';
import * as React from 'react';
import { api } from '@/lib/api';

const THUMBNAIL_DELAY_MS = 8000;
const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_HEIGHT = 300;

function loadImage(file: FileMetadata): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'use-credentials';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${file.id}`));
    img.src = file.url;
  });
}

/** Regenerates and uploads the dashboard thumbnail a few seconds after edits settle. */
export function useThumbnail(editor: Editor, boardId: string, enabled: boolean, shareToken: string | null) {
  React.useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;
    let running = false;
    const generate = async () => {
      if (running || !dirty) return;
      running = true;
      dirty = false;
      try {
        const elements = editor.getElements().filter((e) => !e.hidden);
        const bounds = getCommonBounds(elements);
        if (!bounds) return;
        const w = Math.max(1, bounds.maxX - bounds.minX);
        const h = Math.max(1, bounds.maxY - bounds.minY);
        const scale = Math.min(2, THUMBNAIL_WIDTH / w, THUMBNAIL_HEIGHT / h);
        const blob = await exportToPngBlob(
          { elements, getElement: (id) => editor.getElement(id), files: editor.files, appState: editor.appState },
          { background: true, darkMode: false, padding: 24, scale, loadImage, maxPixels: 4_000_000 },
        );
        await api.boards.uploadThumbnail(boardId, blob, { shareToken });
      } catch (error) {
        console.warn('[inkflow] thumbnail update failed', error);
      } finally {
        running = false;
      }
    };
    const schedule = () => {
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void generate(), THUMBNAIL_DELAY_MS);
    };
    const off = editor.events.on('commit', schedule);
    const onHide = () => {
      if (document.visibilityState === 'hidden' && dirty) void generate();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onHide);
      if (timer) clearTimeout(timer);
      if (dirty) void generate();
    };
  }, [editor, boardId, enabled, shareToken]);
}
