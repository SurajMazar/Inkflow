import * as React from 'react';
import { LayoutTemplate } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  EmptyState,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from '@inkflow/ui';
import { workspaceRoleAtLeast, type TemplateCategory, type TemplateSummaryDto } from '@inkflow/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useDocumentTitle } from '@/lib/use-document-title';
import { notify, toastApiError } from '@/features/notifications/notify';
import { TemplateCard } from '../components/TemplateCard';
import { TEMPLATE_CATEGORY_ORDER, templateCategoryLabel } from '../components/template-categories';
import { ViewContainer, ViewHeader } from '../components/ViewHeader';
import { useCreateFromTemplate } from '../components/useCreateFromTemplate';
import { useTemplates } from '../hooks';
import { useCurrentWorkspace } from '../WorkspaceContext';

export function TemplatesView() {
  const { workspace } = useCurrentWorkspace();
  useDocumentTitle('Templates');
  const templates = useTemplates(workspace.id);
  const { createFromTemplate, pendingId } = useCreateFromTemplate(workspace.id);
  const [category, setCategory] = React.useState<TemplateCategory | 'all'>('all');
  const [deleting, setDeleting] = React.useState<TemplateSummaryDto | null>(null);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (template: TemplateSummaryDto) => api.templates.remove(template.id),
    onSuccess: (_ok, template) => {
      queryClient.setQueryData<TemplateSummaryDto[]>(queryKeys.templates.list(workspace.id), (list) =>
        list?.filter((t) => t.id !== template.id),
      );
      notify.success('Template deleted');
    },
    onError: (error) => toastApiError(error, "Couldn't delete the template"),
  });
  const canDelete = workspaceRoleAtLeast(workspace.role, 'ADMIN');

  const groups = React.useMemo(() => {
    const list = templates.data ?? [];
    return TEMPLATE_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      items: list
        .filter((t) => t.category === cat)
        .sort((a, b) => Number(a.isSystem) - Number(b.isSystem) || a.name.localeCompare(b.name)),
    })).filter((g) => g.items.length > 0);
  }, [templates.data]);
  const visibleGroups = category === 'all' ? groups : groups.filter((g) => g.category === category);

  return (
    <ViewContainer>
      <ViewHeader title="Templates" description="Start from a proven structure — every template is fully editable." />
      {templates.isPending ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
          ))}
        </div>
      ) : templates.isError ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm" role="alert">
          Couldn't load templates.{' '}
          <button type="button" className="font-medium underline underline-offset-4" onClick={() => void templates.refetch()}>
            Retry
          </button>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={<LayoutTemplate />} title="No templates available" description="Templates saved in this workspace will appear here." />
      ) : (
        <>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={category}
            onValueChange={(value) => value && setCategory(value as TemplateCategory | 'all')}
            aria-label="Filter by category"
            className="flex-wrap"
          >
            <ToggleGroupItem value="all" className="px-3">
              All
            </ToggleGroupItem>
            {groups.map((g) => (
              <ToggleGroupItem key={g.category} value={g.category} className="px-3">
                {templateCategoryLabel(g.category)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {visibleGroups.map((group) => (
            <section key={group.category} aria-labelledby={`tpl-${group.category}`} className="grid gap-3">
              <h2 id={`tpl-${group.category}`} className="text-sm font-medium text-muted-foreground">
                {templateCategoryLabel(group.category)}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                {group.items.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onUse={createFromTemplate}
                    using={pendingId === template.id}
                    onDelete={canDelete ? setDeleting : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Boards created from it are not affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) remove.mutate(deleting);
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ViewContainer>
  );
}

export default TemplatesView;
