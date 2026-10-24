import { z } from 'zod';
import { fixturePath, mappedRule, type Adapted, type Mapping } from './types';
// Provisional JSON schema; samples exercise this assumption, not a claim that a real tool was run.
const resultSchema = z.object({ findings: z.array(z.object({ rule_id: z.string(), file: z.string(),
  start_line: z.number().int().min(1), end_line: z.number().int().min(1),
  job_id: z.string().nullable(), step_index: z.number().int().min(0).nullable(),
}).passthrough()) }).passthrough();
export function adaptPoutine(raw: unknown, mapping: Mapping): Adapted {
  const rows = resultSchema.parse(raw).findings;
  const output: Adapted = { predictions: [], unmapped: [] };
  rows.forEach((row, index) => {
    const file = fixturePath(row.file); const rule = mappedRule(mapping, 'poutine', row.rule_id);
    if (!rule) { output.unmapped.push({ toolRule: row.rule_id, file }); return; }
    if (row.end_line < row.start_line || (row.job_id === null && row.step_index !== null)) throw new Error('Unsupported poutine location');
    output.predictions.push({ id: `poutine:${index}`, file, rule, jobId: row.job_id, stepIndex: row.step_index,
      span: { startLine: row.start_line, endLine: row.end_line } });
  });
  return output;
}
