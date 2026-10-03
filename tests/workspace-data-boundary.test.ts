import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}

test('app data reads cannot import a singleton, raw database, or test fixture', () => {
  const violations: string[] = [];
  for (const file of sources('app')) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const module = statement.moduleSpecifier.text;
      if (['@/lib/data', '@/lib/bank', '@/lib/ledger', '@/lib/paykit-history', 'better-sqlite3'].includes(module) || module.startsWith('@/tests/')) {
        if (!statement.importClause?.isTypeOnly) violations.push(`${file}: ${module}`);
      }
    }
    if (/\.db\b|@\/lib\/workspace-storage/.test(source.text)) {
      expect(source.text, file).toMatch(/(?:requireWorkspace|apiWorkspace|workspaceJob)\(/);
    }
  }
  expect(violations).toEqual([]);
});

test('production never calls the retired mixed demo seeder', () => {
  const violations: string[] = [];
  for (const file of [...sources('app'), ...sources('lib')]) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'seedDatabase') violations.push(file);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});
