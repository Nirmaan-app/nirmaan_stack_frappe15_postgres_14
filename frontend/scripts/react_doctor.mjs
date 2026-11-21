// `yarn doctor` (#1698): React Doctor, always with its three privacy flags first.
//
//   yarn doctor                                  scan src/
//   yarn doctor --scope changed --base <ref>     only what a branch adds
//   yarn doctor why <file>:<line>                why a rule fired there
//
// Without the flags React Doctor sends rule names, counts and file names to Sentry and Axiom, asks its own API for a
// score, and checks dependencies with Socket.dev (owner's rule: never). Its `install`/`setup`, `ci`, `scan`,
// `design` and `rules` subcommands are refused: `install` and `ci install` write a Claude skill, a git hook or a
// GitHub workflow that run react-doctor@latest without the flags, and with no terminal attached (CI, an agent)
// React Doctor asks nothing first; the others are not needed here and were not checked for network use.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

export const PRIVACY_FLAGS = ["--no-telemetry", "--no-score", "--no-supply-chain"];
const REFUSED = new Set(["install", "setup", "ci", "scan", "design", "rules", "help"]);
const BIN = join(import.meta.dirname, "..", "node_modules", "react-doctor", "bin", "react-doctor.js");

/** React Doctor's argv for `yarn doctor <args>`: the privacy flags first. Throws on a refused subcommand. */
export function doctorArgv(args) {
  const refused = args.find((arg) => REFUSED.has(arg));
  if (refused) {
    throw new Error(`yarn doctor refuses "${refused}": it can install or run react-doctor without the privacy flags (#1698)`);
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
  const run = spawnSync(process.execPath, [BIN, ...argv], { stdio: "inherit" });
  process.exit(run.status ?? 1);
}

// Real paths: started through a symlink, argv[1] is the link's spelling and import.meta.filename the target's.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) main();
