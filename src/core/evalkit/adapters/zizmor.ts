import { z } from 'zod';
import { fixturePath, mappedRule, type Adapted, type Mapping } from './types';
// Assumed native JSON location shape, unverified in this construction run. Activation must pin/confirm it.
// Any unsupported mapped location invalidates the measurement rather than silently dropping a finding.
const point = z.object({ row: z.number().int().min(0), column: z.number().int().min(0) }).passthrough();
const finding = z.object({ ident: z.string(), locations: z.array(z.object({
  symbolic: z.object({ key: z.string(), route: z.array(z.union([z.string(), z.number().int().min(0)])) }).passthrough(),
  concrete: z.object({ feature: z.object({ start_point: point, end_point: point }).passthrough() }).passthrough(),
}).passthrough()).min(1) }).passthrough();
export function adaptZizmor(raw: unknown, mapping: Mapping): Adapted {
  const rows = z.array(finding).parse(raw);
  const output: Adapted = { predictions: [], unmapped: [] };
  rows.forEach((row, index) => {
    // First location is the primary location, not one prediction per diagnostic annotation.
    const location = row.locations[0]; const file = fixturePath(location.symbolic.key);
    const rule = mappedRule(mapping, 'zizmor', row.ident);
    if (!rule) { output.unmapped.push({ toolRule: row.ident, file }); return; }
    const route = location.symbolic.route;
    const job = route.indexOf('jobs'); const step = route.indexOf('steps');
    if (job >= 0 && typeof route[job + 1] !== 'string') throw new Error('Unsupported zizmor job route');
    if (step >= 0 && (job < 0 || typeof route[step + 1] !== 'number')) throw new Error('Unsupported zizmor step route');
    const startLine = location.concrete.feature.start_point.row + 1;
    const end = location.concrete.feature.end_point;
    const endLine = Math.max(startLine, end.row + (end.column === 0 ? 0 : 1));
    output.predictions.push({ id: `zizmor:${index}`, file, rule,
      jobId: job < 0 ? null : route[job + 1] as string, stepIndex: step < 0 ? null : route[step + 1] as number, span: { startLine, endLine } });
  });
  return output;
}
