// Runs oxlint with the trial config of ticket #1699, from the frontend folder:
//   node scripts/oxlint/lint.mjs --type-aware src          the whole tree, as eslint.config.js lints it
// Extra arguments go to oxlint as they are. Not wired into yarn lint, the hooks or CI.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const HERE = import.meta.dirname;
const FRONTEND = join(HERE, "..", "..");
const OXLINT = join(FRONTEND, "node_modules", ".bin", "oxlint");

// The config cannot ignore a folder outside its own (oxlint refuses `..` in ignorePatterns), so the generated
// shadcn/ui primitives that eslint.config.js ignores are left out here.
const args = ["-c", join(HERE, "oxlintrc.json"), "--ignore-pattern", "src/components/ui/**", ...process.argv.slice(2)];
const run = spawnSync(OXLINT, args, { cwd: FRONTEND, stdio: "inherit" });
process.exit(run.status ?? 1);
