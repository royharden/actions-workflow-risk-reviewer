import type { InputFile } from '../core/scan';

// The six demo-journey fixtures (journey step 2), bundled as raw text by Vite.
const modules = import.meta.glob<string>('/fixtures/workflows/dev/d0[1-6]-*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

export function loadDemoSet(): InputFile[] {
  return Object.entries(modules)
    .map(([path, text]) => ({ name: baseName(path), text }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
