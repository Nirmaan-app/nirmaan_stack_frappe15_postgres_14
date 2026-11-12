// The mechanical part of moving one folder to the typed path (ADR-0049). Run from frontend/:
//
//   node scripts/migrate_folder_to_typed.mjs src/pages/<folder> --dry-run   list what it would change
//   node scripts/migrate_folder_to_typed.mjs src/pages/<folder>             change the files
//
// Per .ts/.tsx file it
//   - points `frappe-react-sdk` imports at `@/lib/frappe` (only when that module exports every imported name),
//   - turns `JSON.parse(x)` into `parseJson(x)` (not with a reviver), `await r.json()` into
//     `parseJson(await r.text())` and any other `r.json()` into `r.text().then(parseJson)`, adding the import,
//   - turns `catch (e: any)` into `catch (e)`.
// It reads the code with the TypeScript parser and edits only those spans, so the rest of the text stays byte for
// byte. What it leaves for a person is printed as a note. After it: type the SDK calls with the generated DocType
// types, narrow the `unknown`s, then `yarn typecheck` and `yarn lint --prune-suppressions`.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const SDK = "frappe-react-sdk";
const TYPED_SDK = "@/lib/frappe";
const PARSE_IMPORT = `import { parseJson } from "@/lib/parseJson";\n`;

/** The names `src/lib/frappe.ts` exports, read from its code. */
export function readSdkExports(file = join(import.meta.dirname, "../src/lib/frappe.ts")) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const names = new Set();
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      st.exportClause.elements.forEach((e) => names.add(e.name.text));
    }
    const exported = ts.getModifiers?.(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && ts.isVariableStatement(st)) {
      st.declarationList.declarations.forEach((d) => ts.isIdentifier(d.name) && names.add(d.name.text));
    }
    if (exported && (ts.isFunctionDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st))) {
      if (st.name) names.add(st.name.text);
    }
  }
  return names;
}

function importedNames(decl) {
  const clause = decl.importClause;
  if (!clause) return [];
  const names = clause.name ? ["default"] : [];
  const nb = clause.namedBindings;
  if (nb && ts.isNamespaceImport(nb)) names.push("* as namespace");
  if (nb && ts.isNamedImports(nb)) nb.elements.forEach((e) => names.push((e.propertyName ?? e.name).text));
  return names;
}

/**
 * Migrate one file's text. Returns the new text, the kinds of change made (in order), and notes on what was left
 * for a person.
 */
export function migrateSource(text, fileName, { sdkExports }) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const edits = []; // { start, end, text }
  const changes = [];
  const notes = [];
  let needsParse = false;
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const src = (node) => node.getText(sf);

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === SDK) {
      const missing = importedNames(node).filter((n) => !sdkExports.has(n));
      if (missing.length) {
        notes.push(`line ${line(node)}: ${TYPED_SDK} does not export ${missing.join(", ")}; import left as it was`);
      } else {
        const spec = node.moduleSpecifier;
        const quote = src(spec)[0];
        edits.push({ start: spec.getStart(sf), end: spec.getEnd(), text: `${quote}${TYPED_SDK}${quote}` });
        changes.push("sdk-import");
      }
      return;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee.expression) && callee.expression.text === "JSON" && callee.name.text === "parse") {
        if (node.arguments.length === 1) {
          edits.push({ start: callee.getStart(sf), end: callee.getEnd(), text: "parseJson" });
          changes.push("json-parse");
          needsParse = true;
        } else {
          notes.push(`line ${line(node)}: JSON.parse with a reviver; left as it was`);
        }
      } else if (callee.name.text === "json" && node.arguments.length === 0) {
        const receiver = src(callee.expression);
        const parent = node.parent;
        if (ts.isAwaitExpression(parent)) {
          edits.push({ start: parent.getStart(sf), end: parent.getEnd(), text: `parseJson(await ${receiver}.text())` });
        } else {
          edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `${receiver}.text().then(parseJson)` });
        }
        changes.push("response-json");
        needsParse = true;
        return; // the receiver's own text is copied whole; its children are not edited separately
      }
    }
    if (ts.isCatchClause(node) && node.variableDeclaration?.type?.kind === ts.SyntaxKind.AnyKeyword) {
      const decl = node.variableDeclaration;
      edits.push({ start: decl.name.getEnd(), end: decl.type.getEnd(), text: "" });
      changes.push("catch-any");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (needsParse && !/import\s*\{[^}]*\bparseJson\b[^}]*\}\s*from\s*["']@\/lib\/parseJson["']/.test(text)) {
    const imports = sf.statements.filter(ts.isImportDeclaration);
    const at = imports.length ? imports[imports.length - 1].getEnd() + 1 : 0;
    edits.push({ start: at, end: at, text: PARSE_IMPORT });
  }

  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { text: out, changes, notes };
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* sourceFiles(path);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      yield path;
    }
  }
}

function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const folders = argv.filter((a) => !a.startsWith("--"));
  if (folders.length !== 1 || !existsSync(folders[0]) || !statSync(folders[0]).isDirectory()) {
    console.error("usage: node scripts/migrate_folder_to_typed.mjs <folder> [--dry-run]  (the folder must exist)");
    return 2;
  }
  const root = folders[0];
  const sdkExports = readSdkExports();
  let changed = 0;
  for (const file of sourceFiles(root)) {
    const before = readFileSync(file, "utf8");
    const { text, changes, notes } = migrateSource(before, file, { sdkExports });
    if (!changes.length && !notes.length) continue;
    const tally = new Map();
    changes.forEach((c) => tally.set(c, (tally.get(c) ?? 0) + 1));
    const counts = [...tally].map(([k, n]) => `${k} x${n}`);
    console.log(`${relative(root, file)}: ${counts.join(", ") || "no change"}`);
    notes.forEach((n) => console.log(`  note: ${n}`));
    if (text !== before) {
      changed += 1;
      if (!dryRun) writeFileSync(file, text);
    }
  }
  console.log(`${dryRun ? "would change" : "changed"} ${changed} file(s) in ${root}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
