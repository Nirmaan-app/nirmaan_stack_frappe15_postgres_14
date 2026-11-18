// D1's parser (scripts/residence_check.py, #1705): the comments in the sources oxlint lints that may hold a directive,
// found with TypeScript's own parser. A comment is the trivia between two tokens, as the compiler reads it, so text
// in a string, a template, a regex literal or JSX text is not one, and a `{/* */}` inside JSX is. residence_check.py
// reads each comment's directive; this only keeps the comments whose text holds `-disable`.
//
//   stdin:  {"<path>": "<source>", ...}      parsed by extension (SCRIPT_KINDS)
//   stdout: {"<path>": ["<comment>", ...], ...}
import { realpathSync } from "node:fs";
import ts from "typescript";

// How each file oxlint lints is parsed: JavaScript files may hold JSX, as oxlint reads them.
const SCRIPT_KINDS = {
  ".tsx": ts.ScriptKind.TSX, ".jsx": ts.ScriptKind.JSX, ".js": ts.ScriptKind.JS, ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
};

/** The comments of one source that hold `-disable`, in source order, each with its `//` or `/* *\/`. */
export function disableComments(path, source) {
  const kind = SCRIPT_KINDS[path.slice(path.lastIndexOf("."))] ?? ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, file.languageVariant);
  const found = [];
  const triviaBefore = (token) => {
    const start = token.getStart(file);
    scanner.setText(source, token.pos, start - token.pos);
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      const text = scanner.getTokenText();
      if ((kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) &&
          text.includes("-disable")) found.push(text);
    }
  };
  const visit = (node) => {
    // JSDoc nodes cover comment text the trivia scan already reads.
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(file);
    if (children.length) {
      children.forEach(visit);
    } else if (node.kind !== ts.SyntaxKind.JsxText) {
      // JSX text is not trivia: `<div>// x</div>` holds no comment.
      triviaBefore(node);
    }
  };
  visit(file);
  return found;
}

// Real paths: a symlinked checkout (or macOS /tmp) gives argv[1] and import.meta.filename different spellings.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const sources = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const comments = Object.fromEntries(Object.entries(sources).map(([path, src]) => [path, disableComments(path, src)]));
  process.stdout.write(JSON.stringify(comments));
}
