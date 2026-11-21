// `yarn doctor` (#1698): React Doctor only ever runs with its three privacy flags, and none of its subcommands that
// install or set up something (each writes a skill, hook or workflow that runs react-doctor@latest without the flags,
// and with no terminal attached it asks nothing first).
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctorArgv, PRIVACY_FLAGS } from "./react_doctor.mjs";

const WRAPPER = join(import.meta.dirname, "react_doctor.mjs");

describe("doctorArgv", () => {
  it("puts the three privacy flags before everything else", () => {
    expect(PRIVACY_FLAGS).toEqual(["--no-telemetry", "--no-score", "--no-supply-chain"]);
    expect(doctorArgv([])).toEqual(PRIVACY_FLAGS);
    expect(doctorArgv(["--scope", "changed", "--base", "main"])).toEqual([...PRIVACY_FLAGS, "--scope", "changed", "--base", "main"]);
    expect(doctorArgv(["why", "src/App.tsx:12"])).toEqual([...PRIVACY_FLAGS, "why", "src/App.tsx:12"]);
    expect(doctorArgv(["src/a.tsx", "src/b.tsx"])).toEqual([...PRIVACY_FLAGS, "src/a.tsx", "src/b.tsx"]);
  });

  it("refuses every subcommand but a scan, why and version", () => {
    for (const sub of ["install", "setup", "ci", "scan", "design", "rules", "help"]) {
      expect(() => doctorArgv([sub]), sub).toThrow(/refuses/);
      expect(() => doctorArgv(["--verbose", sub, "--dry-run"]), sub).toThrow(/refuses/);
    }
  });
});

describe("node scripts/react_doctor.mjs", () => {
  it("exits 2 on a refused subcommand without starting React Doctor", () => {
    const run = spawnSync(process.execPath, [WRAPPER, "ci", "install"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/yarn doctor refuses "ci"/);
  });
});
