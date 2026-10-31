// Dependency-free syntax and migration checks. TypeScript semantics run separately.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const roots = ['src', 'scripts', 'test', 'sample/src', 'sample/api'];
let failures = 0;
function visit(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = dir + '/' + entry.name;
    if (entry.isDirectory()) { visit(file); continue; }
    if (!/\.(?:ts|mjs|js)$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.ts')) {
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      for (const d of parsed.parseDiagnostics) { console.error(file, ts.flattenDiagnosticMessageText(d.messageText, '\n')); failures++; }
    } else {
      const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
      if (result.status) { console.error(result.stderr); failures++; }
    }
    if (ts.preProcessFile(source,true,true).importedFiles.some(file => file.fileName === '@arkiv-network/sdk/attr')) {
      console.error(file, 'Obsolete SDK import'); failures++;
    }
  }
}
roots.forEach(visit);
if (failures) process.exit(1);
console.log('Syntax and SDK import checks passed.');
