#!/usr/bin/env node
// DEV2-B2 (owner G2 option A): builds the SERVER PRICING STEP from the browser's own pricing source, on every deploy.
//
//   node scripts/build_pricing_step.mjs [--out <dir>]      run from frontend/; the frontend `build` script runs it last
//
// Production's image runs `bench init` -> `bench build` -> frappe's esbuild.js `--run-build-command` -> `yarn build` in
// the app root -> `cd frontend && yarn build`, so this script runs wherever the frontend is built, from source.
//
// It bundles src/pages/boq-wizard/rate-helper/serverPricingStep.ts (which only re-exports the existing pricing
// functions plus one thin function) with esbuild -- already in the toolchain as vite's own bundler -- into ONE file for
// Node 18 (production's Node), plus a stamp file. Default output: ../nirmaan_stack/services/boq_rate_match/_build/
// (git-ignored), read by services/boq_rate_match/pricing_step.py.
//
// RECORDING, NEVER CHANGING (DEV2-S3's sig_bundle.sh method): in the built file the definitions of `runPipeline` and
// `priceItemList` are renamed `<name>__orig`, and wrappers with the original names are appended: each calls the
// original, pushes the SAME returned object to globalThis.__pl / __il, and returns it. The thin function reads those
// arrays to know what the pricer chose. Each rename must hit exactly one definition, or the build fails.
//
// THE STAMP: sha256 over every input file of the bundle (esbuild's metafile, sorted by path; each path with the sha256
// of its bytes), the CLI glue and the wrapper text. The rate asset lives in the database, not in the build: the
// server step adds the asset version to the stamp it puts on each value at run time.
import { build, version as esbuildVersion } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "src/pages/boq-wizard/rate-helper/serverPricingStep.ts";
const outArg = process.argv.indexOf("--out");
const OUT_DIR = outArg > 0 ? resolve(process.argv[outArg + 1]) : resolve(FRONTEND, "../nirmaan_stack/services/boq_rate_match/_build");
const BUNDLE = "pricing_step.mjs";
const STAMP = "pricing_step.stamp.json";

// rows in on stdin as JSON, results out on stdout as JSON (input.mode "driving" -> measureDrivingFields); a failure is one
// JSON line on stdout and exit code 1
const GLUE = `import { measureDrivingFields, priceRowsForMatching } from "./${ENTRY}";
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (input.mode === "driving") {
      process.stdout.write(JSON.stringify({ ok: true, categories: measureDrivingFields(input).categories }));
    } else {
      const result = priceRowsForMatching(input);
      process.stdout.write(JSON.stringify({ ok: true, rows: result.rows }));
    }
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    process.exitCode = 1;
  }
});
`;
const WRAPPERS = `
globalThis.__pricingStepRecording = true;
function runPipeline(...a) { const r = runPipeline__orig(...a); if (globalThis.__pl) globalThis.__pl.push(r); return r; }
function priceItemList(...a) { const r = priceItemList__orig(...a); if (globalThis.__il) globalThis.__il.push(r); return r; }
`;

const sha = (b) => createHash("sha256").update(b).digest("hex");

mkdirSync(OUT_DIR, { recursive: true });
const tmp = join(OUT_DIR, `${BUNDLE}.tmp`);
const result = await build({
  stdin: { contents: GLUE, resolveDir: FRONTEND, sourcefile: "pricing_step_cli.ts", loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: tmp,
  metafile: true,
  tsconfig: join(FRONTEND, "tsconfig.json"),
  logLevel: "error",
  absWorkingDir: FRONTEND,
});

let code = readFileSync(tmp, "utf8");
for (const name of ["runPipeline", "priceItemList"]) {
  const re = new RegExp(`^function ${name}\\(`, "gm");
  const hits = (code.match(re) ?? []).length;
  if (hits !== 1) {
    throw new Error(`build_pricing_step: expected exactly 1 definition of ${name} in the bundle, found ${hits}`);
  }
  code = code.replace(re, `function ${name}__orig(`);
}
code += WRAPPERS;
writeFileSync(tmp, code);

const inputs = Object.keys(result.metafile.inputs).sort();
const h = createHash("sha256");
for (const p of inputs) {
  const bytes = p === "<stdin>" || p.endsWith("pricing_step_cli.ts") ? Buffer.from(GLUE) : readFileSync(resolve(FRONTEND, p));
  h.update(`${p}\u0000${sha(bytes)}\n`);
}
h.update(`wrappers\u0000${sha(Buffer.from(WRAPPERS))}\n`);
const stamp = {
  code_hash: h.digest("hex"),
  inputs: inputs.length,
  entry: ENTRY,
  target: "node18",
  esbuild: esbuildVersion,
  bundle_sha256: sha(Buffer.from(code)),
};
renameSync(tmp, join(OUT_DIR, BUNDLE));
writeFileSync(join(OUT_DIR, STAMP), JSON.stringify(stamp, null, 1) + "\n");
console.log(`pricing step built: ${join(OUT_DIR, BUNDLE)} (${inputs.length} inputs, code_hash ${stamp.code_hash.slice(0, 12)})`);
