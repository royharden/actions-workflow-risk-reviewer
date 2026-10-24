import tseslint from 'typescript-eslint';

const corePurity = 'src/core is pure TypeScript: only yaml, zod and its own modules (no DOM, Node, network or app libraries).';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: corePurity },
            { name: 'fs/promises', message: corePurity },
            { name: 'path', message: corePurity },
            { name: 'crypto', message: corePurity },
            { name: 'os', message: corePurity },
            { name: 'child_process', message: corePurity },
            { name: 'react', message: corePurity },
            { name: 'react-dom', message: corePurity },
            { name: '@supabase/supabase-js', message: corePurity },
          ],
          patterns: [
            { group: ['node:*'], message: corePurity },
            { group: ['**/lib/*', '**/ui/*'], message: corePurity },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: corePurity },
        { name: 'document', message: corePurity },
        { name: 'fetch', message: corePurity },
        { name: 'localStorage', message: corePurity },
        { name: 'sessionStorage', message: corePurity },
        { name: 'XMLHttpRequest', message: corePurity },
        { name: 'WebSocket', message: corePurity },
        { name: 'navigator', message: corePurity },
        { name: 'process', message: corePurity },
        { name: 'Buffer', message: corePurity },
        { name: 'require', message: corePurity },
      ],
    },
  },
);
