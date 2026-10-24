import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as browser from '../src/lib/providers/contract';
import * as server from '../supabase/functions/explain-finding/contract';

const examples = readdirSync(resolve('fixtures/contracts')).filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(resolve('fixtures/contracts', file), 'utf8')));

describe('independently deployed contracts', () => {
  for (const example of examples) it(example.name, () => {
    const left = browser.explainRequestSchema.safeParse(example.request).success;
    const right = server.explainRequestSchema.safeParse(example.request).success;
    expect(left).toBe(right);
    expect(left).toBe(!['bad-schema', 'version-mismatch'].includes(example.name));
    expect(browser.requestByteLength(example.request)).toBe(server.requestByteLength(example.request));
    expect(server.requestByteLength(example.request) > server.MAX_REQUEST_BYTES).toBe(example.name === 'oversized');
    if (example.expectStatus === 200) {
      expect(browser.explainResponseSchema.safeParse(example.expectBody).success).toBe(true);
      expect(server.explainResponseSchema.safeParse(example.expectBody).success).toBe(true);
      const raw = JSON.parse(example.expectBody.rawText);
      expect(browser.modelOutputSchema.safeParse(raw).success).toBe(server.modelOutputSchema.safeParse(raw).success);
      expect(server.modelOutputSchema.safeParse(raw).success).toBe(example.name !== 'bad-model-output');
    } else {
      expect(browser.explainErrorSchema.safeParse(example.expectBody).success).toBe(true);
      expect(server.explainErrorSchema.safeParse(example.expectBody).success).toBe(true);
      expect(server.ERROR_STATUS[example.expectBody.error as server.ExplainErrorCode]).toBe(example.expectStatus);
    }
  });
  it('rejects extra response/error/model fields and all request rule drift', () => {
    const good = examples.find((example) => example.name === 'ok');
    for (const contract of [browser, server]) {
      expect(contract.explainResponseSchema.safeParse({ ...good.expectBody, responseText: 'extra' }).success).toBe(false);
      expect(contract.explainErrorSchema.safeParse({ error: 'over_budget', retry: true }).success).toBe(false);
      const model = JSON.parse(good.expectBody.rawText);
      for (const extra of [{ severity: 'low' }, { patch: 'diff' }]) expect(contract.modelOutputSchema.safeParse({ ...model, ...extra }).success).toBe(false);
      expect(contract.explainRequestSchema.safeParse({ ...good.request, ruleId: 'unknown-rule' }).success).toBe(false);
      for (const ruleId of server.RULE_IDS) expect(contract.explainRequestSchema.safeParse({ ...good.request, ruleId }).success).toBe(true);
    }
  });
});
