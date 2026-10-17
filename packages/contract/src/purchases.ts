import { z } from 'zod';
export const PurchaseStatusSchema=z.enum(['PENDING','APPROVED','REJECTED']);
export const PurchaseClaimInputSchema=z.object({orderNo:z.string().trim().min(6).max(64).regex(/^[0-9A-Za-z-]+$/).transform(v=>v.toUpperCase())}).strict();
export const PurchaseClaimSchema=z.object({id:z.uuid(),orderNo:z.string(),status:PurchaseStatusSchema,createdAt:z.iso.datetime(),submittedAt:z.iso.datetime(),deadlineAt:z.iso.datetime(),reviewedAt:z.iso.datetime().nullable(),creditedRmb:z.number().nonnegative().nullable(),reason:z.string().nullable(),attempt:z.number().int().positive()});
export const PurchaseClaimsSchema=z.object({data:z.array(PurchaseClaimSchema),total:z.number().int().nonnegative(),page:z.number().int(),pageSize:z.number().int()});
export const PurchaseTicketSchema=z.object({id:z.uuid(),url:z.url(),expiresAt:z.iso.datetime(),maskedAccount:z.string()});
export const PurchaseTicketStatusSchema=z.object({state:z.enum(['WAITING','SUBMITTED','EXPIRED']),claim:PurchaseClaimSchema.nullable()});
export const PurchaseMobileSchema=z.object({ticketId:z.uuid(),maskedAccount:z.string(),expiresAt:z.iso.datetime(),claim:PurchaseClaimSchema.nullable()});
export const PurchaseReviewSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('APPROVED'),paidRmb:z.string().regex(/^\d{1,6}(?:\.\d{1,2})?$/),verified:z.literal(true),reason:z.string().trim().max(300).optional()}).strict(),
 z.object({status:z.literal('REJECTED'),reason:z.string().trim().min(1).max(300)}).strict()
]);
export type PurchaseClaim=z.infer<typeof PurchaseClaimSchema>;
export type PurchaseTicket=z.infer<typeof PurchaseTicketSchema>;
export type PurchaseClaims=z.infer<typeof PurchaseClaimsSchema>;
