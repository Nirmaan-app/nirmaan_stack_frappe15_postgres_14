// Moves every use of frappe-react-sdk's listener hooks to the safe listeners of `@/lib/frappe` (#1670). Run from
// frontend/; safe to run again (a second run changes nothing):
//
//   node scripts/migrate_raw_listeners.mjs --dry-run   list the files it would change
//   node scripts/migrate_raw_listeners.mjs             change them
//
// Per .ts/.tsx file under src/ (not src/lib/frappe.ts, the safe listeners' home) it
//   - renames each raw hook to its safe listener, everywhere in the file, comments included: they take the same
//     arguments and return the same value, so no call changes;
//   - moves the renamed names out of a `frappe-react-sdk` import into the file's `@/lib/frappe` import (adding one
//     after the SDK import, or in its place when nothing else is left in it).
// It reads imports with the TypeScript parser and edits only those spans, so the rest of the text stays byte for
// byte. After it: `yarn typecheck`, and `yarn lint --prune-suppressions` for each file whose last SDK import went.
// Residence check L1 (scripts/residence_check.py) then refuses the raw names anywhere outside src/lib/frappe.ts.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const SDK = "frappe-react-sdk";
const TYPED_SDK = "@/lib/frappe";
const HOME = "src/lib/frappe.ts";
/** Each raw SDK hook and the safe listener that replaces it. */
export const RENAMES = {
  useFrappeEventListener: "useSocketEventListener",
  useFrappeDocumentEventListener: "useDocumentEventListener",
  useFrappeDocTypeEventListener: "useDocTypeEventListener",
};
const RAW = new RegExp(`\\b(${Object.keys(RENAMES).join("|")})\\b`, "g");
const SAFE = new Set(Object.values(RENAMES));

/** The value imports (not `import type`) of `module` with named bindings. */
function namedImports(file, module) {
  return file.statements.filter(
    (st) =>
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text === module &&
      !st.importClause?.isTypeOnly &&
      st.importClause?.namedBindings &&
      ts.isNamedImports(st.importClause.namedBindings),
  );
}

/** `source` with every raw hook moved to its safe listener; unchanged when it names none. */
export function migrateSource(source, path) {
  const renamed = source.replace(RAW, (name) => RENAMES[name]);
  if (renamed === source) return source;

  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, renamed, ts.ScriptTarget.Latest, true, kind);
  const edits = []; // [start, end, text], applied from the end
  const moved = [];
  const emptied = []; // SDK imports left with nothing in them, each removed (or the first replaced by the new import)
  let after = null; // a kept SDK import, after which a new `@/lib/frappe` import goes when none was emptied
  let quote = '"';
  let semi = ";";

  for (const decl of namedImports(file, SDK)) {
    const elements = decl.importClause.namedBindings.elements;
    const safe = elements.filter((el) => SAFE.has((el.propertyName ?? el.name).text));
    if (!safe.length) continue;
    moved.push(...safe.map((el) => el.getText(file)));
    quote = decl.moduleSpecifier.getText(file)[0];
    semi = decl.getText(file).trimEnd().endsWith(";") ? ";" : "";
    const kept = elements.filter((el) => !safe.includes(el));
    if (!kept.length) {
      emptied.push(decl);
      continue;
    }
    const separator = renamed.slice(elements[0].getEnd(), elements[1].getStart(file));
    edits.push([elements[0].getStart(file), elements.at(-1).getEnd(), kept.map((el) => el.getText(file)).join(separator)]);
    after ??= decl;
  }

  if (moved.length) {
    const typed = namedImports(file, TYPED_SDK)[0];
    if (typed) {
      const elements = typed.importClause.namedBindings.elements;
      const have = new Set(elements.map((el) => el.getText(file)));
      const add = moved.filter((name) => !have.has(name));
      if (add.length) edits.push([elements.at(-1).getEnd(), elements.at(-1).getEnd(), `, ${add.join(", ")}`]);
      for (const decl of emptied) edits.push([decl.getStart(file), lineEnd(renamed, decl.getEnd()), ""]);
    } else {
      const line = `import { ${moved.join(", ")} } from ${quote}${TYPED_SDK}${quote}${semi}`;
      const [first, ...rest] = emptied;
      if (first) edits.push([first.getStart(file), first.getEnd(), line]);
      else edits.push([after.getEnd(), after.getEnd(), `\n${line}`]);
      for (const decl of rest) edits.push([decl.getStart(file), lineEnd(renamed, decl.getEnd()), ""]);
    }
  }

  let out = renamed;
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, start) + text + out.slice(end);
  return out;
}

/** The position just past the newline that ends the line `pos` is on. */
function lineEnd(text, pos) {
  const nl = text.indexOf("\n", pos);
  return nl === -1 ? text.length : nl + 1;
}

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules") yield* sourceFiles(path);
    } else if (/\.tsx?$/.test(name)) {
      yield path;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes("--dry-run");
  const changed = [];
  for (const path of sourceFiles("src")) {
    const rel = relative(".", path);
    if (rel === HOME) continue;
    const before = readFileSync(path, "utf8");
    const after = migrateSource(before, path);
    if (after === before) continue;
    changed.push(rel);
    if (!dryRun) writeFileSync(path, after);
  }
  console.log(`${dryRun ? "Would change" : "Changed"} ${changed.length} file(s)`);
  for (const rel of changed) console.log(`  ${rel}`);
}
