import { Trash2 } from 'lucide-react';
import { Badge, Button, SimpleTooltip, Spinner } from '@inkflow/ui';
import type { TemplateSummaryDto } from '@inkflow/shared';
import { pluralize } from '@/lib/format';
import { LazyTemplatePreview as TemplatePreview } from './LazyTemplatePreview';
import { templateCategoryLabel } from './template-categories';

export function TemplateCard({
  template,
  onUse,
  using,
  onDelete,
  compact,
}: {
  template: TemplateSummaryDto;
  onUse: (template: TemplateSummaryDto) => void;
  using?: boolean;
  onDelete?: (template: TemplateSummaryDto) => void;
  compact?: boolean;
}) {
  return (
    <article
      className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-foreground/15"
      data-testid="template-card"
      data-template-id={template.id}
    >
      <button
        type="button"
        className="relative block aspect-[16/10] border-b text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        onClick={() => onUse(template)}
        aria-label={`Use template ${template.name}`}
        disabled={using}
      >
        <TemplatePreview templateId={template.id} />
        {using ? (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Spinner label="Creating board" />
          </span>
        ) : null}
      </button>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-medium">{template.name}</h3>
          {!template.isSystem ? <Badge variant="outline">Workspace</Badge> : null}
        </div>
        {!compact && template.description ? (
          <p className="line-clamp-2 text-[13px] text-muted-foreground">{template.description}</p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground">
            {templateCategoryLabel(template.category)} ·{' '}
            {pluralize(template.elementCount, 'element')}
          </span>
          <div className="flex items-center gap-1">
            {onDelete && !template.isSystem ? (
              <SimpleTooltip content="Delete template">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete template ${template.name}`}
                  onClick={() => onDelete(template)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </SimpleTooltip>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onUse(template)}
              disabled={using}
              data-testid="template-use"
            >
              Use template
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
