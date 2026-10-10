import { readFileSync } from 'node:fs';

export const STYLES = ['layout', 'tables', 'pagination']
  .map(name => readFileSync(new URL(`./styles/${name}.css`, import.meta.url), 'utf8'))
  .join('\n');
