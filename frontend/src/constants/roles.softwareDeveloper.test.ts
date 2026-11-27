/**
 * ADR-0051: the Software Developer profile mirrors Admin, with no exceptions, and every check names it next to
 * Admin. Every list that holds `ADMIN_PROFILE` holds `DEVELOPER_PROFILE` too, every Admin check stands in an `||`
 * with `isDeveloperProfile`, and every role predicate of `roles.ts` answers a developer as it answers an Admin.
 * The server twin is `services/test_software_developer_profile.py`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as roles from "./roles";

const SRC = fileURLToPath(new URL("..", import.meta.url));

const ADMIN = "Nirmaan Admin Profile";
const DEVELOPER = "Nirmaan Software Developer Profile";
const SOMEONE = "someone@example.com";

/** Files that may still name a profile inline, each with why. Every check reads `ADMIN_PROFILE` / `DEVELOPER_PROFILE`. */
const PROFILE_STRING_ALLOWED: Record<string, string> = {
  "constants/roles.ts": "defines ADMIN_PROFILE and DEVELOPER_PROFILE, the one place the strings live",
  "utils/roleColors.ts": "Admin's and the developer's own badge colours and role options, keyed by their names",
};

/**
 * Uses of Admin that may leave the developer out, by `file::function` (`<module>` at module level), each with why.
 * Everywhere else every use of Admin names the developer beside it (`adminChecksWithoutTheDeveloper`).
 */
const ADMIN_ONLY_ALLOWED: Record<string, string> = {
  "constants/roles.ts::isAdminProfile": "defines the Admin-alone profile test",
  "constants/roles.ts::isNirmaanAdmin": "defines Administrator-or-the-Admin-profile; callers add the developer",
  "hooks/useUserData.ts::role": "the Administrator user is read as the Admin profile; the checks on it name the developer",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function parse(path: string, text = readFileSync(path, "utf8")): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** The nearest named function or variable around `node`. */
function scope(node: ts.Node): string {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) {
      return n.name.getText();
    }
  }
  return "<module>";
}

/** An Admin helper -> the developer helper that must stand beside it, on the same argument, in the same `||`. */
const PARTNER = new Map([
  ["isAdminProfile", "isDeveloperProfile"],
  ["isNirmaanAdmin", "isDeveloperProfile"],
]);
const DEVELOPER_NAMES = new Set(["DEVELOPER_PROFILE", "isDeveloperProfile"]);

/** The name a bare identifier or a property access (`roles.ADMIN_PROFILE`) refers to. */
const refName = (node: ts.Node): string | null =>
  ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : null;

const skipParens = (node: ts.Node): ts.Node => {
  let n = node.parent;
  while (n && ts.isParenthesizedExpression(n)) n = n.parent;
  return n;
};

const isOr = (node: ts.Node | undefined): node is ts.BinaryExpression =>
  !!node && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken;

/** The other direct operands of the widest `||` chain `node` is a direct operand of (brackets see through). */
function orSiblings(node: ts.Node): ts.Node[] {
  let top: ts.Node = node;
  for (let p = skipParens(top); isOr(p); p = skipParens(p)) top = p;
  if (top === node) return [];
  const operands = (n: ts.Node): ts.Node[] => {
    while (ts.isParenthesizedExpression(n)) n = n.expression;
    return isOr(n) ? [...operands(n.left), ...operands(n.right)] : [n];
  };
  return operands(top).filter((o) => o !== node);
}

const namesTheDeveloper = (node: ts.Node): boolean => {
  let found = false;
  walk(node, (n) => {
    if (DEVELOPER_NAMES.has(refName(n) ?? "")) found = true;
  });
  return found;
};

/**
 * {"file::function": [line, ...]} of every use of Admin that leaves the developer out. Every reference to
 * `ADMIN_PROFILE`, `isAdminProfile` or `isNirmaanAdmin` is judged: `ADMIN_PROFILE` in an array passes when the array
 * holds `DEVELOPER_PROFILE`, in a comparison when it or a sibling operand of its `||` names the developer, and
 * nowhere else; a helper passes only when called, as a direct operand of an `||` that has `isDeveloperProfile` on the
 * same first argument as another direct operand. An alias, a callback or `import { x as y }` is refused.
 */
export function adminChecksWithoutTheDeveloper(files: Record<string, ts.SourceFile>): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  for (const [rel, file] of Object.entries(files)) {
    const flag = (node: ts.Node) => {
      const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      (found[`${rel}::${scope(node)}`] ??= []).push(line);
    };
    walk(file, (node) => {
      if (ts.isImportSpecifier(node)) {
        if (node.propertyName && PARTNER.has(node.propertyName.text)) flag(node);
        return;
      }
      const name = refName(node);
      if (!name || (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) return;
      const parent = node.parent;
      if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) return;
      if ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) && parent.name === node) return;
      if (PARTNER.has(name)) {
        if (!(ts.isCallExpression(parent) && parent.expression === node && parent.arguments.length)) {
          flag(node);
          return;
        }
        const arg = parent.arguments[0].getText();
        const paired = orSiblings(parent).some(
          (o) => ts.isCallExpression(o) && refName(o.expression) === PARTNER.get(name) && o.arguments[0]?.getText() === arg,
        );
        if (!paired) flag(parent);
      } else if (name === "ADMIN_PROFILE") {
        let ok = false;
        if (ts.isArrayLiteralExpression(parent)) {
          ok = parent.elements.some((e) => refName(e) === "DEVELOPER_PROFILE");
        } else if (ts.isComputedPropertyName(parent) && ts.isObjectLiteralExpression(parent.parent.parent)) {
          // A label map keyed by profile (`{ [ADMIN_PROFILE]: "Admin", ... }`): it must key the developer too.
          ok = parent.parent.parent.properties.some(
            (prop) => !!prop.name && ts.isComputedPropertyName(prop.name) && refName(prop.name.expression) === "DEVELOPER_PROFILE",
          );
        } else if (ts.isBinaryExpression(parent) && parent.operatorToken.kind !== ts.SyntaxKind.BarBarToken) {
          ok = namesTheDeveloper(parent) || orSiblings(parent).some(namesTheDeveloper);
        }
        if (!ok) flag(node);
      }
    });
  }
  return found;
}

/** {file: [line, ...]} of every string literal equal to the Admin or the developer profile name. */
function profileStrings(files: Record<string, ts.SourceFile>): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  for (const [rel, file] of Object.entries(files)) {
    walk(file, (node) => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && [ADMIN, DEVELOPER].includes(node.text)) {
        (found[rel] ??= []).push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
    });
  }
  return found;
}

const APP_FILES: Record<string, ts.SourceFile> = Object.fromEntries(
  sourceFiles(SRC).map((path) => [relative(SRC, path), parse(path)]),
);

describe("the two profile constants", () => {
  it("ADMIN_PROFILE is Admin alone and DEVELOPER_PROFILE the Software Developer; there is no shared list", () => {
    expect(roles.ADMIN_PROFILE).toBe(ADMIN);
    expect(roles.DEVELOPER_PROFILE).toBe(DEVELOPER);
    expect("ADMIN_PROFILES" in roles).toBe(false);
    expect("SOFTWARE_DEVELOPER_PROFILE" in roles).toBe(false);
  });

  it("isAdminProfile and isDeveloperProfile each answer for their own profile alone", () => {
    expect(roles.isAdminProfile(ADMIN)).toBe(true);
    expect(roles.isDeveloperProfile(DEVELOPER)).toBe(true);
    expect(roles.isAdminProfile(DEVELOPER)).toBe(false);
    expect(roles.isDeveloperProfile(ADMIN)).toBe(false);
    for (const other of ["Nirmaan Accountant Profile", "Administrator", "Loading", "", null, undefined]) {
      expect(roles.isAdminProfile(other)).toBe(false);
      expect(roles.isDeveloperProfile(other)).toBe(false);
    }
  });

  it("the Admin check with the developer named beside it admits the developer, the Admin and the Administrator user", () => {
    const adminCheck = (role: string, userId: string) => roles.isNirmaanAdmin(role, userId) || roles.isDeveloperProfile(role);
    expect(adminCheck(DEVELOPER, SOMEONE)).toBe(true);
    expect(adminCheck(ADMIN, SOMEONE)).toBe(true);
    expect(adminCheck("Nirmaan Accountant Profile", "Administrator")).toBe(true);
    expect(adminCheck("Nirmaan Accountant Profile", SOMEONE)).toBe(false);
    expect(adminCheck("Loading", SOMEONE)).toBe(false);
  });
});

describe("no screen names a profile inline", () => {
  it("only the allowed files hold the Admin or the developer string", () => {
    const stray = Object.fromEntries(
      Object.entries(profileStrings(APP_FILES)).filter(([file]) => !(file in PROFILE_STRING_ALLOWED)),
    );
    expect(stray).toEqual({});
  });
});

describe("every Admin list and check names the developer", () => {
  it("names DEVELOPER_PROFILE / isDeveloperProfile beside Admin everywhere but the allowed places", () => {
    const stray = Object.fromEntries(
      Object.entries(adminChecksWithoutTheDeveloper(APP_FILES)).filter(([where]) => !(where in ADMIN_ONLY_ALLOWED)),
    );
    expect(stray).toEqual({});
  });

  it("every exception is still needed", () => {
    const found = adminChecksWithoutTheDeveloper(APP_FILES);
    expect(Object.keys(ADMIN_ONLY_ALLOWED).filter((where) => !(where in found))).toEqual([]);
  });

  it("catches each shape", () => {
    const bad = parse(
      "bad.ts",
      [
        "const ADMIN_ONLY = [ADMIN_PROFILE, X];",
        "const a = (r) => isAdminProfile(r);",
        "const b = (r, u) => !isNirmaanAdmin(r, u) || other(r);",
        "const c = (r) => r === ADMIN_PROFILE;",
        "const alias = isNirmaanAdmin;",
        "const d = (r, q) => isAdminProfile(r) || isDeveloperProfile(q);",
        "const e = (r) => !isAdminProfile(r) || isDeveloperProfile(r);",
        "const f = (r) => roles.isAdminProfile(r);",
        "const g = { role_profile: ADMIN_PROFILE };",
        "const labels = { [ADMIN_PROFILE]: 'Admin' };",
      ].join("\n"),
    );
    const good = parse(
      "good.ts",
      [
        "const BOTH = [ADMIN_PROFILE, DEVELOPER_PROFILE, X];",
        "const a = (r) => isAdminProfile(r) || isDeveloperProfile(r);",
        "const b = (r, u) => !(isNirmaanAdmin(r, u) || isDeveloperProfile(r));",
        "const c = (r) => r === ADMIN_PROFILE || r === DEVELOPER_PROFILE;",
        "const f = (r) => roles.isAdminProfile(r) || roles.isDeveloperProfile(r);",
        "const h = (r, u) => (isNirmaanAdmin(r, u) || isDeveloperProfile(r)) && ready;",
        "const labels = { [ADMIN_PROFILE]: 'Admin', [DEVELOPER_PROFILE]: 'Software Developer' };",
      ].join("\n"),
    );
    expect(Object.keys(adminChecksWithoutTheDeveloper({ "bad.ts": bad, "good.ts": good })).sort()).toEqual([
      "bad.ts::ADMIN_ONLY",
      "bad.ts::a",
      "bad.ts::alias",
      "bad.ts::b",
      "bad.ts::c",
      "bad.ts::d",
      "bad.ts::e",
      "bad.ts::f",
      "bad.ts::g",
      "bad.ts::labels",
    ]);
  });
});

describe("every role rule in roles.ts treats the developer as Admin", () => {
  const exported = Object.entries(roles as Record<string, unknown>);

  it("every list holding Admin holds the developer", () => {
    const lists = exported.filter(
      ([, value]) => Array.isArray(value) && (value as unknown[]).includes(ADMIN),
    );
    expect(lists.length).toBeGreaterThan(30);
    for (const [name, value] of lists) {
      expect({ name, holdsDeveloper: (value as string[]).includes(DEVELOPER) }).toEqual({
        name,
        holdsDeveloper: true,
      });
    }
  });

  /** The three building blocks a check is written with; each answers for one profile by design. */
  const BUILDING_BLOCKS = ["isAdminProfile", "isDeveloperProfile", "isNirmaanAdmin"];

  it("every role predicate answers the developer as it answers Admin", () => {
    const predicates = exported.filter(
      ([name, value]) => typeof value === "function" && !BUILDING_BLOCKS.includes(name),
    ) as [string, (role: string, userId: string) => unknown][];
    for (const [name, fn] of predicates) {
      expect({ name, answer: fn(DEVELOPER, SOMEONE) }).toEqual({ name, answer: fn(ADMIN, SOMEONE) });
    }
  });
});
