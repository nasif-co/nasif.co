// Preflight check for the asset pipeline. Verifies scaffolding, the lib
// modules, and the manual SETUP.md steps that are easy to miss on a new
// machine. Read-only except for a manifest round-trip that restores itself.
//
//   node scripts/doctor.js
//
// Never prints secret values — only whether they are present.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;
let warned = 0;

function pass(label, detail = "") {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
}
function fail(label, detail = "") {
  failed++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
}
function warn(label, detail = "") {
  warned++;
  console.log(`  \x1b[33m!\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
}
function section(name) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}
async function check(label, fn) {
  try {
    const detail = await fn();
    if (detail !== null) pass(label, detail ?? "");
  } catch (err) {
    fail(label, err.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${what}: got ${a}, expected ${e}`);
}

// ── Environment ───────────────────────────────────────────────────────────
section("Environment");

await check("node matches .nvmrc", () => {
  const pinned = require_(".nvmrc").trim();
  const running = process.version.replace(/^v/, "");
  assert(
    pinned === running,
    `running v${running} but .nvmrc pins ${pinned} — run \`nvm use\``
  );
  return `v${running}`;
});

await check("ffmpeg on PATH", () => {
  const out = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return out.split("\n")[0].split(" ").slice(0, 3).join(" ");
});

await check("node_modules installed", () => {
  assert(existsSync(path.join(root, "node_modules")), "run `npm install`");
});

// ── Scaffolding (Phase 1) ─────────────────────────────────────────────────
section("Scaffolding");

for (const dir of ["site", "site/assets", "site/css", "site/js", "site/static", ".assets-build", "scripts/lib"]) {
  await check(`${dir}/ exists`, () => {
    assert(existsSync(path.join(root, dir)), "missing directory");
  });
}

await check(".gitignore covers all required paths", () => {
  const body = require_(".gitignore");
  const lines = body.split("\n").map((l) => l.trim());
  for (const entry of ["node_modules/", "dist/", "site/assets/", ".assets-build/", ".env"]) {
    assert(lines.includes(entry), `missing entry: ${entry}`);
  }
});

await check("assets-manifest.json is committed and well-formed", () => {
  const m = JSON.parse(require_("assets-manifest.json"));
  for (const key of ["version", "recipeVersion", "images", "videos"]) {
    assert(key in m, `missing key: ${key}`);
  }
  const counts = `${Object.keys(m.images).length} images, ${Object.keys(m.videos).length} videos`;
  return counts;
});

await check("package.json declares the spec'd scripts and deps", () => {
  const pkg = JSON.parse(require_("package.json"));
  assert(pkg.type === "module", 'must set "type": "module"');
  for (const s of ["sync", "build"]) {
    assert(pkg.scripts?.[s], `missing script: ${s}`);
  }
  for (const d of ["sharp", "@aws-sdk/client-s3", "glob", "dotenv"]) {
    assert(pkg.dependencies?.[d], `missing dependency: ${d}`);
  }
});

// ── Lib modules (Phase 2) ─────────────────────────────────────────────────
section("Recipe & ladder");

const {
  computeImageLadder, computeVideoLadder,
  serializeImageRecipe, serializeVideoRecipe, serializePosterRecipe,
  IMAGE_LADDER, VIDEO_LADDER, RECIPE_VERSION,
} = await import("./lib/recipe.js");

await check("spec example: 2400px source drops the 2160 rung", () => {
  eq(computeImageLadder(2400), [640, 960, 1440, 2400], "ladder(2400)");
});
await check("source landing exactly on a rung adds no native rung", () => {
  eq(computeImageLadder(1440), [640, 960, 1440], "ladder(1440)");
});
await check("source exactly at the top rung uses the plain ladder", () => {
  eq(computeImageLadder(3200), IMAGE_LADDER, "ladder(3200)");
});
await check("source ABOVE the top rung is capped at the ceiling", () => {
  // Regression: a 4032px source once emitted a 4032 variant, exceeding the
  // ladder's ceiling. Native top rungs are for sources between rungs only.
  eq(computeImageLadder(4032), IMAGE_LADDER, "ladder(4032)");
  eq(computeImageLadder(9000), IMAGE_LADDER, "ladder(9000)");
});
await check("spec §4 example: 3000px source gets a native 3000 rung", () => {
  eq(computeImageLadder(3000), [640, 960, 1440, 2160, 3000], "ladder(3000)");
});
await check("no ladder rung ever exceeds the ceiling", () => {
  const top = IMAGE_LADDER[IMAGE_LADDER.length - 1];
  for (const w of [500, 1000, 2400, 3000, 3199, 3200, 4032, 9000]) {
    const max = Math.max(...computeImageLadder(w));
    assert(max <= top, `ladder(${w}) emitted ${max}, above the ${top} ceiling`);
  }
});
await check("source below the smallest rung emits native width only", () => {
  eq(computeImageLadder(500), [500], "ladder(500)");
});
await check("no ladder ever upscales", () => {
  for (const w of [320, 500, 641, 1439, 1440, 2399, 2400, 5000]) {
    const ladder = computeImageLadder(w);
    assert(ladder.length > 0, `ladder(${w}) is empty`);
    assert(Math.max(...ladder) <= w, `ladder(${w}) upscales: ${ladder}`);
    const sorted = [...ladder].sort((a, b) => a - b);
    eq(ladder, sorted, `ladder(${w}) not ascending`);
    eq(ladder, [...new Set(ladder)], `ladder(${w}) has duplicates`);
  }
});
await check("video ladder never upscales", () => {
  for (const w of [640, 1280, 1919, 1920, 2560, 3199, 3200, 3840, 7680]) {
    const rungs = computeVideoLadder(w);
    assert(rungs.length > 0, `video ladder(${w}) is empty`);
    assert(Math.max(...rungs.map((r) => r.width)) <= w, `video ladder(${w}) upscales`);
  }
});
await check("only a source at or above the top rung earns both files", () => {
  eq(computeVideoLadder(2560).map((r) => r.width), [1920], "2560 should stay single");
  eq(computeVideoLadder(3200).map((r) => r.width), [1920, 3200], "3200 should offer both");
  eq(computeVideoLadder(3840).map((r) => r.width), [1920, 3200], "3840 is capped at the ceiling");
});
await check("a source below the lowest rung keeps its own width", () => {
  eq(computeVideoLadder(1280).map((r) => r.width), [1280], "video ladder(1280)");
});
await check("exactly one video rung is the unconditional default", () => {
  const plain = VIDEO_LADDER.filter((r) => r.media === null);
  eq(plain.length, 1, "a <source> list with no unconditional fallback can match nothing");
  eq(plain[0], VIDEO_LADDER[0], "the fallback must be the smallest rung");
});
await check("recipes are deterministic and independent", () => {
  eq(serializeImageRecipe(), serializeImageRecipe(), "image recipe differs between calls");
  eq(serializeVideoRecipe(), serializeVideoRecipe(), "video recipe differs between calls");
  assert(
    serializeImageRecipe() !== serializeVideoRecipe(),
    "image and video recipes are identical, so they would churn together"
  );
  return `RECIPE_VERSION ${RECIPE_VERSION}`;
});
await check("poster recipe follows the chosen frame", () => {
  assert(
    serializePosterRecipe(0) !== serializePosterRecipe(120),
    "changing data-post-frame would not re-extract the poster"
  );
});

section("Sizes defaults");

const { IMAGE_SIZES, defaultSizes } = await import("./lib/sizes.js");

const lastClause = (value) => value.split(", ").pop();
const minWidths = (value) =>
  value.split(", ").map((c) => Number(c.match(/min-width:\s*(\d+)px/)?.[1] ?? NaN));

await check("every string ends in a bare fallback length", () => {
  // A media condition opens with a bracket; a calc() length opens with "c".
  // A trailing condition would leave narrow viewports matching nothing.
  for (const [name, value] of Object.entries(IMAGE_SIZES)) {
    assert(!lastClause(value).startsWith("("), `${name} ends conditional: ${lastClause(value)}`);
  }
  return `${Object.keys(IMAGE_SIZES).length} strings`;
});
await check("min-width clauses descend, so the first match is the right one", () => {
  for (const [name, value] of Object.entries(IMAGE_SIZES)) {
    const widths = minWidths(value).filter((n) => !Number.isNaN(n));
    eq(widths, [...widths].sort((a, b) => b - a), `${name} clauses are out of order`);
  }
});
await check("the hero asks for more than a full width grid image", () => {
  // It crops a 16:9 master into a 12:9 box, so its height decides.
  assert(IMAGE_SIZES.hero !== IMAGE_SIZES.full, "hero and full are identical");
  assert(IMAGE_SIZES.hero.includes("vh"), "hero has no height-based clause");
});
await check("context comes from the image's class and its wrapper's", () => {
  eq(defaultSizes("hero", "<figure>"), IMAGE_SIZES.hero, "hero not read from its own class");
  eq(defaultSizes("", '<a class="double-wide mobile-1-1">'), IMAGE_SIZES.full, "double-wide wrapper");
  eq(defaultSizes("", '<figure class="double-wide">'), IMAGE_SIZES.full, "double-wide figure");
  eq(defaultSizes("", "<figure>"), IMAGE_SIZES.half, "plain wrapper should be half");
});
await check("mobile-double-wide is not mistaken for double-wide", () => {
  // Regression: \bdouble-wide\b matches inside it, a hyphen being a boundary.
  eq(defaultSizes("", '<figure class="mobile-double-wide">'), IMAGE_SIZES.mobileFull);
});
await check("an unwrapped image overestimates rather than risking blur", () => {
  eq(defaultSizes("", "<section>"), IMAGE_SIZES.full, "unknown context should be full width");
  eq(defaultSizes("", ""), IMAGE_SIZES.full, "no preceding markup should be full width");
});
await check("the wrapper match is anchored to the tag before the image", () => {
  // A double-wide ancestor must not leak into a plain image below it.
  eq(defaultSizes("", '<div class="double-wide"><p>text</p><figure>'), IMAGE_SIZES.half);
});

section("Hashing");

const { computeAssetHash } = await import("./lib/hash.js");

await check("hash is stable for identical input", () => {
  const a = computeAssetHash(Buffer.from("same"), serializeImageRecipe());
  const b = computeAssetHash(Buffer.from("same"), serializeImageRecipe());
  eq(a, b, "same input hashed differently");
  return `${a} (${a.length} chars)`;
});
await check("hash length is 6-8 chars per spec §5", () => {
  const h = computeAssetHash(Buffer.from("x"), serializeImageRecipe());
  assert(h.length >= 6 && h.length <= 8, `got ${h.length} chars`);
  assert(/^[0-9a-f]+$/.test(h), `not lowercase hex: ${h}`);
});
await check("hash changes when source bytes change", () => {
  const a = computeAssetHash(Buffer.from("one"), serializeImageRecipe());
  const b = computeAssetHash(Buffer.from("two"), serializeImageRecipe());
  assert(a !== b, "different sources produced the same hash");
});
await check("hash changes when the recipe changes", () => {
  const a = computeAssetHash(Buffer.from("same"), serializeImageRecipe());
  const b = computeAssetHash(Buffer.from("same"), serializeImageRecipe() + "-tweaked");
  assert(a !== b, "recipe change did not shift the hash (stale immutable URLs)");
});

section("Manifest I/O");

const { readManifest, writeManifest, MANIFEST_PATH } = await import("./lib/manifest.js");

await check("read → write → read round-trips without data loss", async () => {
  const original = await readFile(MANIFEST_PATH, "utf8");
  try {
    const before = await readManifest();
    await writeManifest(before);
    const after = await readManifest();
    eq(after, { ...before, recipeVersion: RECIPE_VERSION }, "round-trip mismatch");
  } finally {
    await writeFile(MANIFEST_PATH, original, "utf8"); // always restore
  }
});

section("Credentials & R2");

await check(".env present", () => {
  assert(existsSync(path.join(root, ".env")), "no .env at repo root — see SETUP.md §4");
});

const { syncEnv, buildEnv } = await import("./lib/env.js");

await check("R2 credentials present (values not printed)", () => {
  syncEnv();
  return "4/4 vars set";
});
await check("build URLs present (values not printed)", () => {
  buildEnv();
  return "2/2 vars set";
});

const { createR2Client, listAllKeys } = await import("./lib/r2Client.js");

let bucketKeys = null;
await (async () => {
  try {
    bucketKeys = await listAllKeys(createR2Client());
    pass("R2 reachable (read-only list)", `${bucketKeys.size} objects in bucket`);
  } catch (err) {
    fail("R2 reachable (read-only list)", err.message);
  }
})();

// ── Git hook wiring (SETUP.md §6) ─────────────────────────────────────────
section("Git hook wiring");

await check("core.hooksPath points at .githooks", () => {
  const out = execFileSync("git", ["config", "core.hooksPath"], {
    encoding: "utf8",
    cwd: root,
  }).trim();
  assert(out === ".githooks", `set to "${out}" — run \`git config core.hooksPath .githooks\``);
});

await check("pre-commit hook exists and is executable", () => {
  const hook = path.join(root, ".githooks/pre-commit");
  assert(existsSync(hook), "missing .githooks/pre-commit");
  assert(statSync(hook).mode & 0o111, "not executable — run `chmod +x .githooks/pre-commit`");
  assert(require_(".githooks/pre-commit").trim(), "hook is empty");
});

// What matters is whether *the hook* can resolve node, not whether node
// happens to be on PATH — the hook is written to find it either way. Each
// probe starts from `env -i` so it measures the hostile environment itself,
// not whatever PATH the shell running the doctor happens to carry.
{
  const HOME = process.env.HOME ?? "";
  const pinned = require_(".nvmrc").trim();
  const hook = path.join(root, ".githooks/pre-commit");
  const contexts = [
    ["fresh terminal", ["env", "-i", `HOME=${HOME}`, "PRECOMMIT_SELFTEST=1", "zsh", "-lic", hook]],
    ["GUI client / bare PATH", ["env", "-i", `HOME=${HOME}`, "PRECOMMIT_SELFTEST=1",
      "PATH=/usr/local/bin:/usr/bin:/bin", "sh", "-c", hook]],
  ];
  for (const [label, argv] of contexts) {
    try {
      const out = execFileSync(argv[0], argv.slice(1), { encoding: "utf8", cwd: root }).trim();
      const version = out.split("\n").pop().trim().split(" ").pop().replace(/^v/, "");
      if (version === pinned) pass(`hook resolves node — ${label}`, `v${version}`);
      else warn(`hook resolves node — ${label}`, `v${version}, not the pinned ${pinned}`);
    } catch (err) {
      fail(`hook resolves node — ${label}`, "hook could not find node here");
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(
  `\n\x1b[1m${passed} passed\x1b[0m` +
    (warned ? `, \x1b[33m${warned} warning${warned > 1 ? "s" : ""}\x1b[0m` : "") +
    (failed ? `, \x1b[31m${failed} failed\x1b[0m` : "") +
    "\n"
);
process.exit(failed ? 1 : 0);

function require_(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}
