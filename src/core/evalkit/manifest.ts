import { z } from 'zod';
import { RULE_IDS } from '../finding';
export const splitSchema = z.enum(['dev', 'heldout']);
export type Split = z.infer<typeof splitSchema>;
export const fileNameSchema = z.string().regex(/^(dev|heldout)\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/);
export const spanSchema = z.object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1) }).strict()
  .refine((span) => span.endLine >= span.startLine, 'reversed span');
export const itemSchema = z.object({
  file: fileNameSchema, split: splitSchema, rule: z.enum(RULE_IDS as unknown as [typeof RULE_IDS[number], ...typeof RULE_IDS[number][]]),
  jobId: z.string().min(1).nullable(), stepIndex: z.number().int().min(0).nullable(), span: spanSchema,
  label: z.enum(['positive', 'lookalike_excluded', 'lookalike_flagged_benign']), trap: z.string(), gate: z.string().nullable(), note: z.string(),
}).strict();
export type ManifestItem = z.infer<typeof itemSchema>;
export const manifestSchema = z.object({
  schemaVersion: z.literal(1), seed: z.number().int(), freezeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  files: z.array(z.object({ file: fileNameSchema, split: splitSchema, expectedStatus: z.enum(['complete', 'error', 'unsupported']) }).strict()),
  items: z.array(itemSchema),
}).strict().superRefine((value, ctx) => {
  const files = new Map(value.files.map((file) => [file.file, file]));
  if (files.size !== value.files.length) ctx.addIssue({ code: 'custom', message: 'duplicate file' });
  for (const file of value.files) if (!file.file.startsWith(`${file.split}/`)) ctx.addIssue({ code: 'custom', message: 'file split mismatch' });
  for (const item of value.items) if (files.get(item.file)?.split !== item.split || (item.jobId === null && item.stepIndex !== null))
    ctx.addIssue({ code: 'custom', message: 'item file/split/identity mismatch' });
});
export type Manifest = z.infer<typeof manifestSchema>;
export function itemId(item: ManifestItem, index: number): string {
  return `${item.file}:${item.rule}:${item.jobId ?? '(workflow)'}:${item.stepIndex ?? '(none)'}:${item.span.startLine}-${item.span.endLine}:${index}`;
}
