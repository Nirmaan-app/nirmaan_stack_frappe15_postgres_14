/**
 * The one place the app parses JSON text (ADR-0049). It returns `unknown`, so the caller narrows the value (a Zod
 * schema, a type guard) before reading it; raw `JSON.parse` and `Response.json()` return `any` and are banned
 * elsewhere (oxlint and residence check J1). For a fetch response, parse its text: `parseJson(await response.text())`.
 *
 * It behaves exactly as `JSON.parse`, only typed: invalid JSON and the empty string throw a `SyntaxError`, so moving
 * a caller over changes no behaviour. A caller that can receive an empty body checks for it first.
 */
export function parseJson(text: string): unknown {
  return JSON.parse(text);
}
