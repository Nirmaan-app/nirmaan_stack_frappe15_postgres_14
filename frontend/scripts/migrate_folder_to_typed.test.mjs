// The folder migration's mechanical part (ADR-0049): each test feeds source text through migrateSource() and checks
// the text that comes out, or runs the CLI on a throwaway folder as a folder ticket would.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateSource } from "./migrate_folder_to_typed.mjs";

const SCRIPT = join(import.meta.dirname, "migrate_folder_to_typed.mjs");
const SDK_EXPORTS = new Set(["useFrappeGetDoc", "useSWRConfig", "FrappeConfig", "FrappeContext"]);
const migrate = (text) => migrateSource(text, "page.tsx", { sdkExports: SDK_EXPORTS });

describe("migrateSource", () => {
  it("points an SDK import at the typed module", () => {
    const out = migrate(`import { useFrappeGetDoc, useSWRConfig } from "frappe-react-sdk";\n`);
    expect(out.text).toBe(`import { useFrappeGetDoc, useSWRConfig } from "@/lib/frappe";\n`);
    expect(out.changes).toEqual(["sdk-import"]);
  });

  it("points a type-only SDK import at the typed module", () => {
    const out = migrate(`import type { FrappeConfig } from 'frappe-react-sdk';\n`);
    expect(out.text).toBe(`import type { FrappeConfig } from '@/lib/frappe';\n`);
  });

  it("leaves an SDK import alone, with a note, when the typed module lacks one of its names", () => {
    const src = `import { useFrappeGetDoc, useFrappeNotThere } from "frappe-react-sdk";\n`;
    const out = migrate(src);
    expect(out.text).toBe(src);
    expect(out.notes).toEqual([expect.stringContaining("useFrappeNotThere")]);
  });

  it("turns JSON.parse(x) into parseJson(x) and adds the import after the last import", () => {
    const src = `import a from "a";\nimport b from "b";\nconst v = JSON.parse(raw);\n`;
    expect(migrate(src).text).toBe(
      `import a from "a";\nimport b from "b";\nimport { parseJson } from "@/lib/parseJson";\nconst v = parseJson(raw);\n`,
    );
  });

  it("adds the parseJson import once for several calls, and not at all when it is there", () => {
    const once = migrate(`const a = JSON.parse(x);\nconst b = JSON.parse(y);\n`).text;
    expect(once).toBe(`import { parseJson } from "@/lib/parseJson";\nconst a = parseJson(x);\nconst b = parseJson(y);\n`);
    const already = `import { parseJson } from "@/lib/parseJson";\nconst a = JSON.parse(x);\n`;
    expect(migrate(already).text).toBe(`import { parseJson } from "@/lib/parseJson";\nconst a = parseJson(x);\n`);
  });

  it("leaves JSON.parse with a reviver alone, with a note", () => {
    const src = `const v = JSON.parse(raw, reviver);\n`;
    const out = migrate(src);
    expect(out.text).toBe(src);
    expect(out.notes).toEqual([expect.stringContaining("reviver")]);
  });

  it("turns an awaited res.json() into parseJson(await res.text())", () => {
    expect(migrate(`const d = await res.json();\n`).text).toBe(
      `import { parseJson } from "@/lib/parseJson";\nconst d = parseJson(await res.text());\n`,
    );
  });

  it("turns a non-awaited res.json() into res.text().then(parseJson)", () => {
    expect(migrate(`fetch(u).then((r) => r.json());\n`).text).toBe(
      `import { parseJson } from "@/lib/parseJson";\nfetch(u).then((r) => r.text().then(parseJson));\n`,
    );
  });

  it("drops the any from catch (e: any)", () => {
    expect(migrate(`try { f(); } catch (e: any) { g(e); }\n`).text).toBe(`try { f(); } catch (e) { g(e); }\n`);
  });

  it("returns the text unchanged when there is nothing to do", () => {
    const src = `import { x } from "y";\ntry { f(); } catch (e) { JSON.stringify(e); }\n`;
    expect(migrate(src)).toEqual({ text: src, changes: [], notes: [] });
  });
});

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function folder(files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-"));
  dirs.push(root);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

describe("the CLI", () => {
  const FILES = {
    "a.tsx": `import { useFrappeGetDoc } from "frappe-react-sdk";\n`,
    "sub/b.ts": `export const v = JSON.parse("1");\n`,
    "sub/c.ts": `export const w = 1;\n`,
  };

  it("--dry-run reports each file it would change and writes nothing", () => {
    const root = folder(FILES);
    const r = run(root, "--dry-run");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("a.tsx");
    expect(r.stdout).toContain("sub/b.ts");
    expect(r.stdout).not.toContain("sub/c.ts");
    expect(readFileSync(join(root, "a.tsx"), "utf8")).toBe(FILES["a.tsx"]);
  });

  it("writes the changes without --dry-run", () => {
    const root = folder(FILES);
    expect(run(root).status).toBe(0);
    expect(readFileSync(join(root, "a.tsx"), "utf8")).toBe(`import { useFrappeGetDoc } from "@/lib/frappe";\n`);
    expect(readFileSync(join(root, "sub/b.ts"), "utf8")).toContain(`parseJson("1")`);
  });

  it("exits 2 on a folder that does not exist", () => {
    expect(run(join(tmpdir(), "no-such-folder-1694")).status).toBe(2);
  });
});
