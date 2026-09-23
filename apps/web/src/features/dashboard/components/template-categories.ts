import { TEMPLATE_CATEGORIES, type TemplateCategory } from '@inkflow/shared';

const LABELS: Record<TemplateCategory, string> = {
  architecture: 'Architecture',
  software: 'Software',
  database: 'Database',
  flowchart: 'Flowcharts',
  uml: 'UML',
  planning: 'Planning',
  brainstorm: 'Brainstorming',
  other: 'Other',
};

export function templateCategoryLabel(category: TemplateCategory): string {
  return LABELS[category] ?? 'Other';
}

export const TEMPLATE_CATEGORY_ORDER: readonly TemplateCategory[] = TEMPLATE_CATEGORIES;
