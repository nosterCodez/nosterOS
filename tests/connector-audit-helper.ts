import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Reviewed boundaries: workspace stores, public assets and a temp-file PDF parser.
const trusted = new Set(['lib/session.ts', 'lib/auth.ts', 'lib/workspace-storage.ts', 'lib/db.ts', 'lib/paths.ts', 'lib/operator-workspace.ts', 'lib/workspace-jobs.ts', 'lib/foreplay/store.ts', 'lib/foreplay/saved.ts', 'lib/adpilot-data.ts', 'lib/brain-constellation.ts', 'lib/agent-avatars.ts', 'lib/pdf-text.ts']);
const operatorData = new Set(['lib/ventures.ts', 'lib/life-map.ts']);
const normalize = (file: string) => file.replaceAll('\\', '/');
export function appEntries(dir = 'app'): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = normalize(path.join(dir, entry.name));
    return entry.isDirectory() ? appEntries(file) : /\/(route\.ts|page\.tsx)$/.test(file) ? [file] : [];
  });
}
export function connectorDependency(file: string, seen = new Set<string>()): string | null {
  file = normalize(file);
  if (trusted.has(file) || seen.has(file)) return null;
  // Public login only exposes whether Google login is configured, never credentials.
  if (file === 'app/sign-in/page.tsx') return null;
  // Reviewed M4 boundary: platform OAuth app secrets only, encrypted workspace tokens.
  // Role/state/session/refresh isolation is exercised by cloud-api and cloud-collection.
  if (file === 'lib/cloud-oauth.ts' || file === 'lib/cloud-adapters.ts') return null;
  // M5b: platform beta admission only after signed invitation/current DB state or
  // freshly verified email session. No connector access; email-entry tests cover it.
  if (file === 'lib/email-entry.ts') return null;
  seen.add(file);
  if (operatorData.has(file)) return file;
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  if (/^[\s\r\n]*['"]use client['"]/.test(source.text)) return null;
  if (/process\.env\.(?:\w*(?:SECRET|TOKEN|API_KEY|CREDENTIAL)\w*)/.test(source.text)) return file;
  const modules: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!statement.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(e => e.isTypeOnly)) continue;
    modules.push(statement.moduleSpecifier.text);
  }
  function dynamic(node: ts.Node) {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) modules.push(node.arguments[0].text);
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) modules.push(node.moduleSpecifier.text);
    ts.forEachChild(node, dynamic);
  }
  dynamic(source);
  for (const module of modules) {
    if (/^(node:)?(fs|child_process|os)(\/|$)/.test(module)) return file;
    let base: string;
    if (module.startsWith('@/')) base = module.slice(2);
    else if (module.startsWith('.')) base = normalize(path.join(path.dirname(file), module));
    else continue;
    const target = [base + '.ts', base + '.tsx', base + '/index.ts'].find(candidate => fs.existsSync(candidate));
    if (!target) continue;
    // Pure parsers under connectors remain harmless; follow their actual imports.
    if (target === 'lib/operator-creds.ts') return target;
    const result = connectorDependency(target, seen);
    if (result) return result;
  }
  // Env-only connectors may use fetch without reading a credential file.
  if (file.startsWith('lib/connectors/') && /process\.env|resolveCred|fetch\(/.test(source.text)) return file;
  return null;
}
