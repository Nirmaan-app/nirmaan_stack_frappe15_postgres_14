// D1's parser (scripts/disable_comment_check.py, #1705): the comments in the sources oxlint lints that may hold a
// directive, found with TypeScript's own parser. A comment is the trivia between two tokens, as the compiler reads it,
// so text in a string, a template, a regex literal or JSX text is not one, and a `{/* */}` inside JSX is.
// disable_comment_check.py reads each comment's directive; this only keeps the comments whose text holds `-disable`.
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

// oxlint reads every file but these as a script when it can (measured, #1705), and a script may hold ECMAScript
// Annex B's HTML-like comments: a line from `<!--`, or from a `-->` that only whitespace or `/* */` comments precede on
// its line. TypeScript's parser reads them as code, so they are found here.
const MODULE_ONLY = new Set([".mjs", ".mts"]);
// Tokens whose text is no code: an HTML-like comment cannot start inside one.
const LITERALS = new Set([
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
]);
const LINE_BREAK = /[\n\r\u2028\u2029]/;

/** The comments and the literal tokens of one parse: each a [start, end) range in source order. */
function parse(path, source, kind) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, file.languageVariant);
  const comments = [];
  const literals = [];
  const triviaBefore = (token) => {
    const start = token.getStart(file);
    scanner.setText(source, token.pos, start - token.pos);
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
        comments.push([scanner.getTokenStart(), scanner.getTokenEnd()]);
      }
    }
  };
  const visit = (node) => {
    // JSDoc nodes cover comment text the trivia scan already reads.
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(file);
    if (children.length) {
      children.forEach(visit);
      return;
    }
    // JSX text is not trivia: `<div>// x</div>` holds no comment.
    if (node.kind !== ts.SyntaxKind.JsxText) triviaBefore(node);
    if (LITERALS.has(node.kind)) literals.push([node.getStart(file), node.end]);
  };
  visit(file);
  return { comments, literals };
}

const inside = (ranges, at) => ranges.some(([start, end]) => start <= at && at < end);

/** Whether only whitespace and comments stand between the start of ``at``'s line and ``at``. */
function startsItsLine(source, comments, at) {
  for (let i = at - 1; i >= 0; i--) {
    if (LINE_BREAK.test(source[i])) return true;
    const comment = comments.find(([start, end]) => start <= i && i < end);
    if (comment) {
      if (comment[0] < i && LINE_BREAK.test(source.slice(comment[0], i))) return true;
      i = comment[0];
    } else if (!/\s/.test(source[i])) {
      return false;
    }
  }
  return true;
}

/** The first HTML-like comment of ``source`` as oxlint reads it, as [start, end of its line), or null. */
function firstHtmlComment(source, { comments, literals }) {
  for (const found of source.matchAll(/<!--|-->/g)) {
    const at = found.index;
    if (inside(comments, at) || inside(literals, at)) continue;
    if (found[0] === "-->" && !startsItsLine(source, comments, at)) continue;
    const rest = source.slice(at).search(LINE_BREAK);
    return [at, rest === -1 ? source.length : at + rest];
  }
  return null;
}

/** The comments of one source that hold `-disable`, in source order, each as written (`//`, `/* *\/`, `<!--`, `-->`). */
export function disableComments(path, source) {
  const ext = path.slice(path.lastIndexOf("."));
  const kind = SCRIPT_KINDS[ext] ?? ts.ScriptKind.TS;
  // Each HTML-like comment, first to last, is blanked out before the next parse: the text after it on its line is no
  // code, so a quote or backtick there opens no string.
  const html = [];
  let code = source;
  let found = parse(path, code, kind);
  if (!MODULE_ONLY.has(ext)) {
    for (let at = firstHtmlComment(code, found); at; at = firstHtmlComment(code, found)) {
      html.push(at);
      code = code.slice(0, at[0]) + " ".repeat(at[1] - at[0]) + code.slice(at[1]);
      found = parse(path, code, kind);
    }
  }
  return [...found.comments, ...html]
    .sort((a, b) => a[0] - b[0])
    .map(([start, end]) => source.slice(start, end))
    .filter((text) => text.includes("-disable"));
}

// Real paths: a symlinked checkout (or macOS /tmp) gives argv[1] and import.meta.filename different spellings.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const sources = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const comments = Object.fromEntries(Object.entries(sources).map(([path, src]) => [path, disableComments(path, src)]));
  process.stdout.write(JSON.stringify(comments));
}
