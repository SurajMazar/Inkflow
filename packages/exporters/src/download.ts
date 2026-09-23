/** Browser helpers to save or copy exported files. */

export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Downloads require a browser environment');
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the download had a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadText(text: string, fileName: string, mime: string): void {
  downloadBlob(new Blob([text], { type: mime }), fileName);
}

/** Copies an image blob (PNG) to the system clipboard. */
export async function copyBlobToClipboard(blob: Blob): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('The clipboard API is not available');
  }
  const type = blob.type || 'image/png';
  await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
}

const EXTENSIONS = { png: 'png', svg: 'svg', pdf: 'pdf', inkflow: 'inkflow', json: 'json' } as const;

/** Safe file name from a board title (reserved characters stripped, length capped). */
export function suggestFileName(title: string, ext: 'png' | 'svg' | 'pdf' | 'inkflow' | 'json'): string {
  let base = title
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .trim()
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `${base}-board`;
  const chars = [...base];
  if (chars.length > 100) base = chars.slice(0, 100).join('').trim();
  if (!base) base = 'Untitled';
  return `${base}.${EXTENSIONS[ext]}`;
}
