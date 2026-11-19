// L2's parser (scripts/residence_check.py, ADR 0047, #1671): counts the socket listeners in TS/TSX sources with
// TypeScript's own parser, so comments and strings are read as the compiler reads them. A listener is
// `<socket>.on(event, ...)` or `<socket>.off(event, ...)`, where <socket> is a name or a property called `socket`
// (`socket?.on`, `frappe.socket.on`), and a `useSocketEventListener(event, ...)` call. One whose event is a string
// naming the connection itself (`connect`, `disconnect`, `connect_error`) is not counted: it carries no result.
//
//   stdin:  {"<path>": "<source>", ...}      a path ending in .tsx is parsed as TSX
//   stdout: {"<path>": <count>, ...}
import { realpathSync } from "node:fs";
import ts from "typescript";

const CONNECTION_EVENTS = new Set(["connect", "disconnect", "connect_error"]);

const unwrap = (node) => {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};

const isSocket = (node) =>
  (ts.isIdentifier(node) && node.text === "socket") ||
  (ts.isPropertyAccessExpression(node) && node.name.text === "socket");

const isListener = (callee) =>
  (ts.isIdentifier(callee) && callee.text === "useSocketEventListener") ||
  (ts.isPropertyAccessExpression(callee) && ["on", "off"].includes(callee.name.text) && isSocket(unwrap(callee.expression)));

const namesTheConnection = (event) =>
  event !== undefined && ts.isStringLiteralLike(event) && CONNECTION_EVENTS.has(event.text);

/** The socket listeners in one source. */
export function socketListenerCount(path, source) {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, kind);
  let count = 0;
  const visit = (node) => {
    if (ts.isCallExpression(node) && isListener(unwrap(node.expression)) && !namesTheConnection(node.arguments[0])) {
      count++;
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
  const counts = Object.fromEntries(
    Object.entries(sources).map(([path, src]) => [path, socketListenerCount(path, src)]),
  );
  process.stdout.write(JSON.stringify(counts));
}
