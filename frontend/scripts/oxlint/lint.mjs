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
// A config among the arguments (`-c oxlintrc.whole.json`, `--config=...`) replaces the default one.
const given = process.argv.slice(2);
const namesConfig = given.some((a) => a === "-c" || a === "--config" || /^(-c|--config)=/.test(a));
const config = namesConfig ? [] : ["-c", join(HERE, "oxlintrc.json")];
const args = [...config, "--ignore-pattern", "src/components/ui/**", ...given];
const run = spawnSync(OXLINT, args, { cwd: FRONTEND, stdio: "inherit" });
process.exit(run.status ?? 1);
