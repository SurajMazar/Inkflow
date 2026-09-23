import { z } from 'zod';
import type { IsoDate } from './common';
import { serializedDocumentSchema, type SerializedDocument } from './boards';

export const TEMPLATE_CATEGORIES = [
  'architecture',
  'software',
  'database',
  'flowchart',
  'uml',
  'planning',
  'brainstorm',
  'other',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  category: z.enum(TEMPLATE_CATEGORIES).default('other'),
  workspaceId: z.string().min(1),
  document: serializedDocumentSchema,
});
export type CreateTemplateRequest = z.input<typeof createTemplateSchema>;

export interface TemplateSummaryDto {
  id: string;
  /** Stable key for built-in templates (e.g. `microservices`), null for user templates. */
  key: string | null;
  name: string;
  description: string;
  category: TemplateCategory;
  isSystem: boolean;
  workspaceId: string | null;
  elementCount: number;
  createdAt: IsoDate;
}

export interface TemplateDetailDto extends TemplateSummaryDto {
  document: SerializedDocument;
}
