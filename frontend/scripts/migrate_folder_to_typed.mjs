// The mechanical part of moving one folder to the typed path (ADR-0049). Run from frontend/:
//
//   node scripts/migrate_folder_to_typed.mjs src/pages/<folder> --dry-run   list what it would change
//   node scripts/migrate_folder_to_typed.mjs src/pages/<folder>             change the files
//
// Per .ts/.tsx file it
//   - points `frappe-react-sdk` imports at `@/lib/frappe` (only when that module exports every imported name),
//   - turns `JSON.parse(x)` into `parseJson(x)` (not with a reviver), and, where `r` is a fetch Response,
//     `await r.json()` into `parseJson(await r.text())` and any other `r.json()` into `r.text().then(parseJson)`,
//     adding the import. A `.json()` whose receiver it cannot tell is a fetch Response, or one inside an optional
//     chain (`r?.json()`), is left for a person, with a note,
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
const PARSE_IMPORT = `import { parseJson } from "@/lib/parseJson";`;

/** `(await x)` -> `x`: the expression under any parentheses and awaits. */
function unwrap(node) {
  while (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)) node = node.expression;
  return node;
}

const isFetchCall = (node) => {
  const n = unwrap(node);
  if (!ts.isCallExpression(n)) return false;
  const f = n.expression;
  return (ts.isIdentifier(f) && f.text === "fetch")
    || (ts.isPropertyAccessExpression(f) && f.name.text === "fetch" && ts.isIdentifier(f.expression)
      && ["window", "globalThis", "self"].includes(f.expression.text));
};

const isResponseType = (type) => !!type && ts.isTypeReferenceNode(type) && type.typeName.getText() === "Response";

/** The parameter or `const`/`let`/`var` that `id` names, found by walking out through its scopes; else undefined. */
function declarationOf(id) {
  const name = id.text;
  for (let scope = id.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      const p = scope.parameters?.find((q) => ts.isIdentifier(q.name) && q.name.text === name);
      if (p) return p;
    }
    if (scope.statements) {
      for (const st of scope.statements) {
        if (!ts.isVariableStatement(st)) continue;
        const d = st.declarationList.declarations.find((v) => ts.isIdentifier(v.name) && v.name.text === name);
        if (d) return d;
      }
    }
  }
  return undefined;
}

/**
 * True when `receiver` is a fetch Response by its syntax alone: `fetch(...)` itself (awaited or in parentheses),
 * a variable or parameter typed `Response`, a variable set from `await fetch(...)`, or the first parameter of the
 * callback that `fetch(...).then(...)` is given. Anything else is not known, so it is left for a person.
 */
function isFetchResponse(receiver) {
  const r = unwrap(receiver);
  if (isFetchCall(r)) return true;
  if (!ts.isIdentifier(r)) return false;
  const decl = declarationOf(r);
  if (!decl) return false;
  if (isResponseType(decl.type)) return true;
  if (ts.isVariableDeclaration(decl)) return !!decl.initializer && isFetchCall(decl.initializer);
  const fn = decl.parent;
  const call = fn.parent;
  return ts.isParameter(decl) && fn.parameters[0] === decl && ts.isCallExpression(call) && call.arguments[0] === fn
    && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "then"
    && isFetchCall(call.expression.expression);
}

/** True when the call is part of an optional chain (`r?.json()`, `a?.r.json()`). */
const inOptionalChain = (call) => !!(call.flags & ts.NodeFlags.OptionalChain);

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
        if (inOptionalChain(node)) {
          notes.push(`line ${line(node)}: ${src(node)} is in an optional chain; left for a person (a nullish `
            + "receiver must stay nullish)");
          return;
        }
        if (!isFetchResponse(callee.expression)) {
          notes.push(`line ${line(node)}: ${src(node)}: its receiver is not known to be a fetch Response; left for `
            + "a person");
          ts.forEachChild(node, visit);
          return;
        }
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
    // On a line of its own after the last import (after that line's \n, so a CRLF ending is never split), or first.
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const imports = sf.statements.filter(ts.isImportDeclaration);
    if (!imports.length) {
      edits.push({ start: 0, end: 0, text: PARSE_IMPORT + eol });
    } else {
      const nl = text.indexOf("\n", imports[imports.length - 1].getEnd());
      edits.push(nl === -1
        ? { start: text.length, end: text.length, text: eol + PARSE_IMPORT + eol }
        : { start: nl + 1, end: nl + 1, text: PARSE_IMPORT + eol });
    }
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
