// `yarn doctor` (#1698): React Doctor, always with its three privacy flags first.
//
//   yarn doctor                                  scan src/
//   yarn doctor --scope changed --base <ref>     only what a branch adds
//   yarn doctor --verbose <file>                 every finding in one file, with its rule
//
// Without the flags React Doctor sends rule names, counts and file names to Sentry and Axiom, asks its own API for a
// score, and checks every dependency with Socket.dev (owner's rule: never). Refused, before React Doctor starts:
// - the subcommands but a scan and `version`: `install`/`setup` and `ci install` write a Claude skill, git hook or
//   GitHub workflow that run react-doctor@latest without the flags, asking nothing where no terminal is attached;
//   `why` checks every dependency with Socket.dev even with --no-supply-chain (74 calls on an empty cache, measured
//   2026-11-22); the others are not needed here;
// - `--supply-chain`, `--score`, `--telemetry` (the last of a pair wins, so each would undo its privacy flag) and
//   `--debug` (forces a Sentry trace).
// React Doctor gets no terminal on stdin, so it never asks its "Add to GitHub Actions?" question after a scan.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

export const PRIVACY_FLAGS = ["--no-telemetry", "--no-score", "--no-supply-chain"];
const REFUSED = new Set(["install", "setup", "ci", "scan", "design", "rules", "help", "why"]);
const REFUSED_FLAG = /^--(supply-chain|score|telemetry|debug)(=|$)/;
const BIN = join(import.meta.dirname, "..", "node_modules", "react-doctor", "bin", "react-doctor.js");

/** React Doctor's argv for `yarn doctor <args>`: the privacy flags first. Throws on a refused subcommand. */
export function doctorArgv(args) {
  const refused = args.find((arg) => REFUSED.has(arg) || REFUSED_FLAG.test(arg));
  if (refused) {
    throw new Error(`yarn doctor refuses "${refused}": it can install something or send data out (#1698)`);
  }
  return [...PRIVACY_FLAGS, ...args];
}

function main() {
  let argv;
  try {
    argv = doctorArgv(process.argv.slice(2));
  } catch (e) {
    console.error(`✘ ${e.message}`);
    process.exit(2);
  }
  const run = spawnSync(process.execPath, [BIN, ...argv], { stdio: ["ignore", "inherit", "inherit"] });
  process.exit(run.status ?? 1);
}

// Real paths: started through a symlink, argv[1] is the link's spelling and import.meta.filename the target's.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) main();
