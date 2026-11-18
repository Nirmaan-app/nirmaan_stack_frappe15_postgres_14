// J1's parser (scripts/residence_check.py, ADR-0049): counts the `.json()` calls in TS/TSX sources with
// TypeScript's own parser, so comments, strings, regex literals, JSX and division are read as the compiler reads
// them. A call counts where ESLint's old selector matched:
// CallExpression[callee.type='MemberExpression'][callee.property.name='json'] -- `r.json()`, `r?.json()`,
// `r.json<T>()`, `r.json?.()`, `(r.json)()`, `this.#json()`, `r.j\u0073on()`; not `r["json"]()` and not `r.json!()`.
//
//   stdin:  {"<path>": "<source>", ...}      a path ending in .tsx is parsed as TSX
//   stdout: {"<path>": <count>, ...}
import { realpathSync } from "node:fs";
import ts from "typescript";

/** The `.json()` calls in one source. */
export function jsonCallCount(path, source) {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, kind);
  let count = 0;
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      let callee = node.expression;
      while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
      // `#json` too: ESTree names a private name without its `#`, so the selector matched it.
      if (ts.isPropertyAccessExpression(callee) && ["json", "#json"].includes(callee.name.text)) count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

// Real paths: a symlinked checkout (or macOS /tmp) gives argv[1] and import.meta.filename different spellings.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const sources = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const counts = Object.fromEntries(Object.entries(sources).map(([path, src]) => [path, jsonCallCount(path, src)]));
  process.stdout.write(JSON.stringify(counts));
}
