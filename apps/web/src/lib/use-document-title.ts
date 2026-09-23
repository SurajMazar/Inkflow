import { useEffect } from 'react';

export const APP_NAME = 'Inkflow';

/** Sets `document.title` to `"<title> · Inkflow"` (or just "Inkflow") while mounted. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
