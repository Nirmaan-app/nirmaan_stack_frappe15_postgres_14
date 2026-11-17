// SLICE SR-1 C9 (2026-11-17): THE one typed accessor for the text of a failed frappe whitelisted call (a frappe.throw),
// so a page never parses frappe's error shape inline (frontend CODING_STANDARDS rule F2).

/** PURE (SR-1 C9). The server's OWN refusal text from a failed whitelisted call (a frappe.throw), so the error modal
 *  says WHY instead of the generic "could not complete" line. Reads `_server_messages` (a JSON list of JSON strings
 *  holding `message`), else `message` / `exception`; HTML stripped. null when there is nothing readable. */
export function serverRefusalText(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { _server_messages?: unknown; message?: unknown; exception?: unknown };
  const clean = (s: string) => s.replace(/<[^>]*>/g, "").trim();
  if (typeof e._server_messages === "string") {
    try {
      const list = JSON.parse(e._server_messages) as unknown[];
      const texts = list
        .map((m) => {
          if (typeof m !== "string") return "";
          try {
            const o = JSON.parse(m) as { message?: unknown };
            return typeof o?.message === "string" ? clean(o.message) : clean(m);
          } catch {
            return clean(m);
          }
        })
        .filter(Boolean);
      if (texts.length) return texts.join(" ");
    } catch {
      /* fall through to message / exception */
    }
  }
  if (typeof e.message === "string" && clean(e.message)) return clean(e.message);
  if (typeof e.exception === "string" && clean(e.exception)) {
    return clean(e.exception).replace(/^[\w.]+(Error|Exception):\s*/, "");
  }
  return null;
}
