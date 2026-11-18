// The codemod that moves every use of the SDK's listener hooks to the safe listeners of `@/lib/frappe` (#1670):
// each test feeds source text through migrateSource() and checks the text that comes out.
import { describe, expect, it } from "vitest";
import { migrateSource } from "./migrate_raw_listeners.mjs";

const migrate = (text) => migrateSource(text, "page.tsx");

describe("migrateSource", () => {
  it("moves a raw hook out of an SDK import into a new `@/lib/frappe` import, and renames its calls", () => {
    const out = migrate(
      `import { useFrappeEventListener, useFrappeGetCall } from "frappe-react-sdk";\n` +
        `useFrappeEventListener(CHEQUES_CHANGED_EVENT, () => mutate());\n`,
    );
    expect(out).toBe(
      `import { useFrappeGetCall } from "frappe-react-sdk";\n` +
        `import { useSocketEventListener } from "@/lib/frappe";\n` +
        `useSocketEventListener(CHEQUES_CHANGED_EVENT, () => mutate());\n`,
    );
  });

  it("turns an SDK import of raw hooks only into the `@/lib/frappe` import, in its quotes and without a semicolon", () => {
    const out = migrate(
      `import { useFrappeDocumentEventListener } from 'frappe-react-sdk'\n` +
        `useFrappeDocumentEventListener("Projects", id, f)\n`,
    );
    expect(out).toBe(
      `import { useDocumentEventListener } from '@/lib/frappe'\n` + `useDocumentEventListener("Projects", id, f)\n`,
    );
  });

  it("adds the safe hook to an `@/lib/frappe` import the file already has", () => {
    const out = migrate(
      `import { useFrappeDocTypeEventListener, useSWRConfig } from "frappe-react-sdk";\n` +
        `import { useFrappeGetDoc } from "@/lib/frappe";\n` +
        `useFrappeDocTypeEventListener("Projects", f);\n`,
    );
    expect(out).toBe(
      `import { useSWRConfig } from "frappe-react-sdk";\n` +
        `import { useFrappeGetDoc, useDocTypeEventListener } from "@/lib/frappe";\n` +
        `useDocTypeEventListener("Projects", f);\n`,
    );
  });

  it("renames a raw hook imported from `@/lib/frappe` in place", () => {
    const src = `import { useFrappeDocumentEventListener, useFrappeGetDoc } from "@/lib/frappe";\n`;
    expect(migrate(src)).toBe(`import { useDocumentEventListener, useFrappeGetDoc } from "@/lib/frappe";\n`);
  });

  it("keeps a multi-line SDK import's layout when it removes names from it", () => {
    const out = migrate(
      `import {\n  useFrappeCreateDoc,\n  useFrappeDocumentEventListener,\n  useFrappeGetDoc,\n} from "frappe-react-sdk";\n`,
    );
    expect(out).toBe(
      `import {\n  useFrappeCreateDoc,\n  useFrappeGetDoc,\n} from "frappe-react-sdk";\n` +
        `import { useDocumentEventListener } from "@/lib/frappe";\n`,
    );
  });

  it("moves two raw hooks of one import together and keeps an alias", () => {
    const out = migrate(
      `import { useFrappeEventListener as onEvent, useFrappeDocTypeEventListener, useSWRConfig } from "frappe-react-sdk";\n`,
    );
    expect(out).toBe(
      `import { useSWRConfig } from "frappe-react-sdk";\n` +
        `import { useSocketEventListener as onEvent, useDocTypeEventListener } from "@/lib/frappe";\n`,
    );
  });

  it("renames a raw hook named in a comment, so no stale name is left", () => {
    expect(migrate(`// useFrappeDocTypeEventListener("Projects", f);\n`)).toBe(
      `// useDocTypeEventListener("Projects", f);\n`,
    );
  });

  it("leaves a file with no raw hook byte for byte, and a second run changes nothing", () => {
    const src = `import { useFrappeGetDoc } from "frappe-react-sdk";\nconst x = 1;\n`;
    expect(migrate(src)).toBe(src);
    const once = migrate(`import { useFrappeEventListener, useSWR } from "frappe-react-sdk";\nuseFrappeEventListener("e", f);\n`);
    expect(migrate(once)).toBe(once);
  });
});
