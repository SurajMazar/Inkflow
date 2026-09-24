import * as React from 'react';
import { cn } from '@inkflow/ui';
import type { BoardSummaryDto } from '@inkflow/shared';
import { BoardPlaceholder } from './BoardPlaceholder';

/** Board preview: the server thumbnail when available, otherwise a generated doodle. */
export function BoardThumbnail({
  board,
  className,
}: {
  board: Pick<BoardSummaryDto, 'id' | 'thumbnailUrl' | 'updatedAt'>;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const src = board.thumbnailUrl;
  React.useEffect(() => setFailed(false), [src]);
  return (
    // Fixed 16:10 box; the image is absolutely positioned so its intrinsic size (e.g. a tall
    // flowchart) can never stretch the card.
    <div className={cn('relative aspect-[16/10] w-full overflow-hidden bg-muted/40', className)}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-contain p-2 dark:[filter:invert(0.93)_hue-rotate(180deg)]"
        />
      ) : (
        <BoardPlaceholder seed={board.id} className="p-3" />
      )}
    </div>
  );
}
