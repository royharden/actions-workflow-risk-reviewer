import { expect, it } from 'vitest';
import { getMode } from '../../src/lib/mode';
it('never silently turns explicit live into demo', () => {
  expect(getMode({ VITE_APP_MODE: 'live' }).kind).toBe('setup-error');
  expect(getMode({ VITE_APP_MODE: 'demo', VITE_SUPABASE_URL: 'https://example.invalid' }).kind).toBe('demo');
  expect(getMode({}).kind).toBe('demo');
  expect(getMode({ VITE_SUPABASE_URL: 'https://example.invalid' }).kind).toBe('setup-error');
  expect(getMode({ VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'PUBLIC_PLACEHOLDER' }).kind).toBe('live');
});
