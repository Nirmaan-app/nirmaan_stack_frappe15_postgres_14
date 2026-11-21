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
    expect(doctorArgv(["src/a.tsx", "src/b.tsx"])).toEqual([...PRIVACY_FLAGS, "src/a.tsx", "src/b.tsx"]);
  });

  it("refuses every subcommand but a scan and version", () => {
    // `why` checks every dependency with Socket.dev even with --no-supply-chain (74 calls on an empty cache, measured).
    for (const sub of ["install", "setup", "ci", "scan", "design", "rules", "help", "why"]) {
      expect(() => doctorArgv([sub]), sub).toThrow(/refuses/);
      expect(() => doctorArgv(["--verbose", sub, "--dry-run"]), sub).toThrow(/refuses/);
    }
  });

  it("refuses a flag that turns a privacy flag back off (the last one given wins) or forces a Sentry trace", () => {
    for (const flag of ["--supply-chain", "--score", "--telemetry", "--debug", "--supply-chain=true"]) {
      expect(() => doctorArgv(["--verbose", flag]), flag).toThrow(/refuses/);
    }
    expect(doctorArgv(["--no-supply-chain", "--verbose"])).toEqual([...PRIVACY_FLAGS, "--no-supply-chain", "--verbose"]);
  });
});

describe("node scripts/react_doctor.mjs", () => {
  it("exits 2 on a refused subcommand without starting React Doctor", () => {
    const run = spawnSync(process.execPath, [WRAPPER, "ci", "install"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/yarn doctor refuses "ci"/);
  });
});
