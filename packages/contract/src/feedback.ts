import { z } from 'zod';

export const FeedbackKindSchema = z.enum(['FEATURE', 'ISSUE', 'OTHER']);
export const FeedbackStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']);
export const FeedbackInputSchema = z.object({
  clientId: z.uuid(), kind: FeedbackKindSchema,
  title: z.string().trim().min(1).max(80), content: z.string().trim().min(5).max(3000),
}).strict();
export const FeedbackSchema = z.object({
  id: z.uuid(), kind: FeedbackKindSchema, status: FeedbackStatusSchema,
  title: z.string(), content: z.string(), createdAt: z.string(), updatedAt: z.string(),
});
export const FeedbackListQuerySchema = z.object({
  status: z.enum(['all', 'OPEN', 'IN_PROGRESS', 'RESOLVED']).default('all'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export const FeedbackListSchema = z.object({data: z.array(FeedbackSchema), total: z.number().int(), page: z.number().int(), pageSize: z.number().int()});
export const FeedbackUpdateSchema = z.object({status: FeedbackStatusSchema, expectedUpdatedAt: z.iso.datetime({offset:true})}).strict();
