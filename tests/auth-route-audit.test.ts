import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? routes(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : []);
}
test('every application API handler starts with server-side authentication', () => {
  const failures: string[] = [];
  for (const file of routes(path.join(process.cwd(), 'app/api'))) {
    if (file.replaceAll('\\', '/').endsWith('/api/auth/[...all]/route.ts')) continue;
    const source = readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const node of tree.statements) {
      if (ts.isFunctionDeclaration(node) && node.name && /^(GET|POST|PATCH|PUT|DELETE|OPTIONS|HEAD)$/.test(node.name.text)) {
        const first = node.body?.statements[0]?.getText(tree) ?? '';
        if (!first.includes('await apiSessionError(')) failures.push(`${file}:${node.name.text}`);
      }
    }
  }
  expect(failures).toEqual([]);
});
