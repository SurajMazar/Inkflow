import * as React from 'react';
import { Star } from 'lucide-react';
import { Button, cn } from '@inkflow/ui';
import type { BoardSummaryDto } from '@inkflow/shared';
import { useBoardMutations } from '../hooks';

export function FavoriteButton({
  board,
  className,
  onClick,
  ...props
}: { board: BoardSummaryDto } & Omit<React.ComponentProps<typeof Button>, 'children'>) {
  const { toggleFavorite } = useBoardMutations();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={board.isFavorite}
      aria-label={
        board.isFavorite
          ? `Remove ${board.title} from favorites`
          : `Add ${board.title} to favorites`
      }
      data-testid="board-favorite"
      {...props}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite.mutate(board);
      }}
      className={cn(
        board.isFavorite ? 'text-amber-500 hover:text-amber-600' : 'text-muted-foreground',
        className,
      )}
    >
      <Star className={cn('size-4', board.isFavorite && 'fill-current')} aria-hidden />
    </Button>
  );
}
