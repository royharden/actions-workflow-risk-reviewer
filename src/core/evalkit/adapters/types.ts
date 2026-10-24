import { z } from 'zod';
import { RULE_IDS, type RuleId } from '../../finding';
import type { Prediction } from '../match';
export type Tool = 'zizmor' | 'poutine';
export interface Mapping { schemaVersion: 1; tools: Record<Tool, Record<string, RuleId | 'unmapped'>> }
export interface Adapted { predictions: Prediction[]; unmapped: { toolRule: string; file: string }[] }
export const mappingSchema = z.object({ schemaVersion: z.literal(1), tools: z.object({
  zizmor: z.record(z.union([z.enum(RULE_IDS as unknown as [RuleId, ...RuleId[]]), z.literal('unmapped')])),
  poutine: z.record(z.union([z.enum(RULE_IDS as unknown as [RuleId, ...RuleId[]]), z.literal('unmapped')])),
}).strict() }).strict();
export function fixturePath(input: string): string {
  const path = input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^fixtures\/workflows\//, '');
  if (!/^(dev|heldout)\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(path)) throw new Error('Baseline path outside fixture scope');
  return path;
}
export function mappedRule(mapping: Mapping, tool: Tool, id: string): RuleId | null {
  const rule = mapping.tools[tool][id];
  return !rule || rule === 'unmapped' ? null : rule;
}
