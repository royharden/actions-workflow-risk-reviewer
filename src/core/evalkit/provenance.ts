import { z } from 'zod';
import type { Hasher } from '../hash';
import { splitSchema, type Split } from './manifest';
export const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const baselineConfigSchema = z.object({
  tool: z.enum(['zizmor', 'poutine']), version: z.string().min(1), persona: z.enum(['regular', 'pedantic', 'default']),
  minSeverity: z.string().min(1), flags: z.array(z.string()).min(1), formatVerified: z.literal(true),
}).strict();
export type BaselineConfig = z.infer<typeof baselineConfigSchema>;
export const baselineReceiptSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal('recorded-tool-output'), split: splitSchema,
  outputFile: z.string().regex(/^(zizmor|poutine)\/[A-Za-z0-9._-]+\.json$/), outputSha256: hashSchema,
  fileHashes: z.record(hashSchema), manifestSha256: hashSchema, mappingSha256: hashSchema,
  config: baselineConfigSchema, recordedAt: z.string().datetime(),
}).strict();
export type BaselineReceipt = z.infer<typeof baselineReceiptSchema>;
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) as string;
}
export function sameHashes(left: Record<string, string>, right: Record<string, string>): boolean { return canonicalJson(left) === canonicalJson(right); }
export interface BaselineExpected { split: Split; fileHashes: Record<string, string>; manifestSha256: string; mappingSha256: string; config: BaselineConfig }
export async function validateBaseline(receipt: unknown, outputText: string, expected: BaselineExpected, hasher: Hasher): Promise<BaselineReceipt | null> {
  const parsed = baselineReceiptSchema.safeParse(receipt);
  if (!parsed.success) return null;
  const value = parsed.data;
  return value.split === expected.split && sameHashes(value.fileHashes, expected.fileHashes) && value.manifestSha256 === expected.manifestSha256 &&
    value.mappingSha256 === expected.mappingSha256 && canonicalJson(value.config) === canonicalJson(expected.config) &&
    await hasher.sha256Hex(outputText) === value.outputSha256 ? value : null;
}
