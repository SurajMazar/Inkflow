import * as React from 'react';
import { cn } from '@inkflow/ui';
import { BoardPlaceholder } from './BoardPlaceholder';

const TemplatePreviewImpl = React.lazy(async () => ({
  default: (await import('./TemplatePreview')).TemplatePreview,
}));

/**
 * Template preview that loads the renderer on demand, so dashboard views paint before the
 * (large) scene/renderer chunk arrives.
 */
export function LazyTemplatePreview({
  templateId,
  className,
}: {
  templateId: string;
  className?: string;
}) {
  return (
    <React.Suspense
      fallback={
        <div className={cn('relative size-full overflow-hidden bg-muted/30', className)}>
          <BoardPlaceholder seed={templateId} className="p-4" />
        </div>
      }
    >
      <TemplatePreviewImpl templateId={templateId} className={className} />
    </React.Suspense>
  );
}
