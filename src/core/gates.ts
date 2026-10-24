import type { Finding, GateEvidence } from './finding';
import { asMap, getEntry, scalarText } from './model';
import type { LEntry, Workflow } from './model';

/** Gate observations are scoped evidence, never a claim that protection settings exist. */
export function applyGates(wf: Workflow, findings: Finding[]): Finding[] {
  return findings.map((finding) => {
    const evidence: GateEvidence[] = [];
    const add = (gate: string, entry: LEntry): void => { evidence.push({ gate, line: entry.span.startLine, text: wf.source.lines.slice(entry.span.startLine - 1, entry.span.endLine).join('\n') }); };
    const job = wf.jobs.find((item) => item.id === finding.jobId);
    if (finding.rule === 'privileged-trigger-checkout' && job) {
      // A later step's if cannot constrain the checkout. A same-job if or the checkout's own if can.
      const checkout = job.steps.find((step) => step.key === finding.stepKey);
      const candidates = [getEntry(job.map, 'if'), getEntry(checkout?.map, 'if')];
      for (const entry of candidates) {
        if (!entry) continue;
        const condition = (scalarText(entry.value) ?? '').replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '').trim();
        // Refuse disjunctions/negation rather than infer an unsafe partial predicate.
        if (condition.includes('||') || /!=|!(?!=)/.test(condition)) continue;
        const atoms = condition.split(/\s*&&\s*/).map((atom) => atom.trim().replace(/^\((.*)\)$/, '$1').trim());
        if (atoms.some((atom) => /^github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository$/.test(atom) || /^github\.event\.pull_request\.head\.repo\.fork\s*==\s*false$/.test(atom))) add('fork-if', entry);
        if (atoms.some((atom) => /^github\.event\.(?:comment|pull_request|issue)\.author_association\s*==\s*'(?:OWNER|MEMBER|COLLABORATOR)'$/.test(atom) || /^contains\(\s*fromJSON\('\["(?:OWNER|MEMBER|COLLABORATOR)"(?:,\s*"(?:OWNER|MEMBER|COLLABORATOR)")*\]'\)\s*,\s*github\.event\.(?:comment|pull_request|issue)\.author_association\s*\)$/.test(atom))) add('author-association', entry);
        if (atoms.some((atom) => /^contains\(\s*github\.event\.pull_request\.labels\.\*\.name\s*,\s*'[^']+'\s*\)$/.test(atom) || /^github\.event\.label\.name\s*==\s*'[^']+'$/.test(atom))) add('label', entry);
      }
      const environment = getEntry(job.map, 'environment');
      if (environment) {
        const name = scalarText(environment.value) ?? scalarText(getEntry(asMap(environment.value), 'name')?.value);
        if (name?.trim() && !name.includes('${{')) add('environment', environment);
      }
    }
    if (finding.rule === 'template-injection' && finding.facts.contextClass === 'maintainer_controlled' && wf.triggers.length === 1 && wf.triggers[0] === 'workflow_dispatch' && wf.on) add('dispatch-only', wf.on);
    if (finding.rule === 'secrets-exposure' && finding.facts.secretsCause === 'inherit' && job?.uses && /^\.\/\.github\/workflows\/[A-Za-z0-9_./-]+\.ya?ml$/.test(job.usesValue ?? '') && !(job.usesValue ?? '').split('/').includes('..')) add('same-repo-callee', job.uses);
    return { ...finding, facts: { ...finding.facts, gateEvidence: evidence } };
  });
}

export function gatesOnlyTriage(finding: Finding): 'likely_benign' | 'confirmed' {
  return finding.facts.gateEvidence.length > 0 ? 'likely_benign' : 'confirmed';
}
