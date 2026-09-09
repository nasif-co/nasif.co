// Transforms HTML from the repo into dist/, expanding /assets/ references
// into hashed R2 URLs using assets-manifest.json, and copies css/, js/ and
// static/ across unchanged.
//
// Runs on Cloudflare Pages. It has no R2 credentials and makes no network
// calls — everything it needs is the manifest and the HTML. Keep it that way.
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";

import { readManifest } from "./lib/manifest.js";
import { buildEnv } from "./lib/env.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// site/ is the web root: its contents become the contents of dist/.
const SITE = path.join(root, "site");
const DIST = path.join(root, "dist");
const PASSTHROUGH = ["css", "js", "static"];

// The literal prefix authors write. Root-relative, because nested pages would
// otherwise need a varying number of "../".
const ASSET_PREFIX = "/assets/";
const FALLBACK_WIDTH = 1440;

// Meta/link tags whose URLs must be absolute — most scrapers reject relative ones.
const ABSOLUTE_META = new Set([
  "og:image", "og:image:url", "og:image:secure_url", "og:url",
  "twitter:image", "twitter:image:src",
]);

function fail(message) {
  console.error(`\nbuild failed:\n  ${message}\n`);
  process.exit(1);
}

/** Splits a tag's attribute text into ordered {name, value} pairs. */
function parseAttrs(text) {
  const attrs = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? null });
  }
  return attrs;
}

function serializeAttrs(attrs) {
  return attrs
    .map(({ name, value }) => (value === null ? name : `${name}="${value}"`))
    .join(" ");
}

/**
 * The src fallback for browsers ignoring srcset: the 1440 rung, or the nearest
 * available. Never the largest, so a no-srcset browser can't pull the biggest
 * file — unless there is only one variant to choose from.
 */
function pickFallback(variants) {
  const exact = variants.find((v) => v.w === FALLBACK_WIDTH);
  if (exact) return exact;
  if (variants.length === 1) return variants[0];
  const withoutLargest = variants.slice(0, -1);
  return withoutLargest.reduce((best, v) =>
    Math.abs(v.w - FALLBACK_WIDTH) < Math.abs(best.w - FALLBACK_WIDTH) ? v : best
  );
}

function transformHtml(html, file, manifest, env, referenced) {
  const url = (key) => `${env.assetBaseUrl}/${key}`;

  const lookup = (group, filename, tag) => {
    const entry = manifest[group]?.[filename];
    if (!entry) {
      const known = Object.keys(manifest[group] ?? {});
      fail(
        `${file} references ${ASSET_PREFIX}${filename} in a <${tag}>, but the manifest has no such ${group.slice(0, -1)}.\n  ` +
          `Run \`npm run sync\` after adding it to site/assets/.\n  ` +
          `Known ${group}: ${known.length ? known.join(", ") : "(none)"}`
      );
    }
    referenced.add(filename);
    return entry;
  };

  // ── <img src="/assets/…"> → srcset + sizes + intrinsic dimensions ────────
  html = html.replace(/<img\b([^>]*?)\s*\/?>/gi, (whole, attrText) => {
    const attrs = parseAttrs(attrText);
    const src = attrs.find((a) => a.name.toLowerCase() === "src");
    if (!src?.value?.startsWith(ASSET_PREFIX)) return whole;

    const filename = src.value.slice(ASSET_PREFIX.length);
    const entry = lookup("images", filename, "img");

    const sizes = attrs.find((a) => a.name.toLowerCase() === "data-sizes");
    const preserved = attrs.filter(
      (a) => !["src", "srcset", "sizes", "data-sizes", "width", "height"].includes(a.name.toLowerCase())
    );

    const expanded = [
      { name: "src", value: url(pickFallback(entry.variants).key) },
      { name: "srcset", value: entry.variants.map((v) => `${url(v.key)} ${v.w}w`).join(", ") },
      { name: "sizes", value: sizes?.value ?? "100vw" }, // absent data-sizes → 100vw
      { name: "width", value: String(entry.width) },
      { name: "height", value: String(entry.height) },
    ];

    return `<img ${serializeAttrs([...expanded, ...preserved])}>`;
  });

  // ── <video><source src="/assets/…"></video> ─────────────────────────────
  // Dimensions belong on the <video>, so they are read from the <source> and
  // written to the parent.
  html = html.replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, (whole, attrText, inner) => {
    const found = [];

    const newInner = inner.replace(/<source\b([^>]*?)\s*\/?>/gi, (sourceTag, sourceAttrText) => {
      const sourceAttrs = parseAttrs(sourceAttrText);
      const src = sourceAttrs.find((a) => a.name.toLowerCase() === "src");
      if (!src?.value?.startsWith(ASSET_PREFIX)) return sourceTag;

      const entry = lookup("videos", src.value.slice(ASSET_PREFIX.length), "source");
      found.push(entry);
      src.value = url(entry.key);
      return `<source ${serializeAttrs(sourceAttrs)}>`;
    });

    if (found.length === 0) return whole;

    const attrs = parseAttrs(attrText);
    // A src on the <video> itself is handled below, dimensions included.
    if (attrs.some((a) => a.name.toLowerCase() === "src")) {
      return `<video${attrText}>${newInner}</video>`;
    }

    const preserved = attrs.filter((a) => !["width", "height"].includes(a.name.toLowerCase()));
    const expanded = [
      { name: "width", value: String(found[0].width) },
      { name: "height", value: String(found[0].height) },
    ];
    return `<video ${serializeAttrs([...expanded, ...preserved])}>${newInner}</video>`;
  });

  // ── <video src="/assets/…"> → hashed URL + intrinsic dimensions ──────────
  html = html.replace(/<video\b([^>]*?)\s*\/?>/gi, (whole, attrText) => {
    const attrs = parseAttrs(attrText);
    const src = attrs.find((a) => a.name.toLowerCase() === "src");
    if (!src?.value?.startsWith(ASSET_PREFIX)) return whole;

    const filename = src.value.slice(ASSET_PREFIX.length);
    const entry = lookup("videos", filename, "video");

    // Playback behaviour is a frontend concern — every other attribute is left alone.
    const preserved = attrs.filter(
      (a) => !["src", "width", "height"].includes(a.name.toLowerCase())
    );
    const expanded = [
      { name: "src", value: url(entry.key) },
      { name: "width", value: String(entry.width) },
      { name: "height", value: String(entry.height) },
    ];

    return `<video ${serializeAttrs([...expanded, ...preserved])}>`;
  });

  // ── Absolute URLs for scrapers (static/ is otherwise left alone) ─────────
  html = html.replace(/<meta\b([^>]*?)\s*\/?>/gi, (whole, attrText) => {
    const attrs = parseAttrs(attrText);
    const key = attrs.find((a) => ["property", "name"].includes(a.name.toLowerCase()));
    const content = attrs.find((a) => a.name.toLowerCase() === "content");
    if (!key || !ABSOLUTE_META.has(key.value) || !content?.value?.startsWith("/")) return whole;
    content.value = env.siteUrl + content.value;
    return `<meta ${serializeAttrs(attrs)}>`;
  });

  html = html.replace(/<link\b([^>]*?)\s*\/?>/gi, (whole, attrText) => {
    const attrs = parseAttrs(attrText);
    const rel = attrs.find((a) => a.name.toLowerCase() === "rel");
    const href = attrs.find((a) => a.name.toLowerCase() === "href");
    if (rel?.value !== "canonical" || !href?.value?.startsWith("/")) return whole;
    href.value = env.siteUrl + href.value;
    return `<link ${serializeAttrs(attrs)}>`;
  });

  // Anything still pointing at /assets/ was in none of the expanded places and
  // would 404 in production, since sources are never uploaded.
  const leftover = html.match(new RegExp(`[^"']*${ASSET_PREFIX}[^"'\\s>]+`));
  if (leftover) {
    fail(
      `${file} still references ${ASSET_PREFIX} somewhere it cannot be expanded:\n  ` +
        `  ${leftover[0].trim()}\n  ` +
        `Expanded: <img src>, <video src>, and <source src> inside a <video>.\n  ` +
        `Sources are never uploaded, so this would 404 in production.`
    );
  }

  return html;
}

async function main() {
  const env = buildEnv();
  const manifest = await readManifest();

  const htmlFiles = await glob("**/*.html", {
    cwd: SITE,
    ignore: ["assets/**"],
    nodir: true,
  });

  if (htmlFiles.length === 0) fail("No HTML files found in site/.");

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const referenced = new Set();
  for (const file of htmlFiles.sort()) {
    const html = await readFile(path.join(SITE, file), "utf8");
    const out = transformHtml(html, file, manifest, env, referenced);
    const dest = path.join(DIST, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, out, "utf8");
  }

  for (const dir of PASSTHROUGH) {
    const from = path.join(SITE, dir);
    await cp(from, path.join(DIST, dir), { recursive: true, force: true }).catch((err) => {
      if (err.code !== "ENOENT") throw err; // absent passthrough dir is fine
    });
  }

  // A manifest entry nothing references is a warning, never a failure.
  const all = [...Object.keys(manifest.images ?? {}), ...Object.keys(manifest.videos ?? {})];
  const unused = all.filter((name) => !referenced.has(name));

  console.log(`build — ${htmlFiles.length} page(s), ${referenced.size}/${all.length} assets referenced`);
  if (unused.length) {
    console.log(`  warning: in the manifest but unused in HTML: ${unused.join(", ")}`);
  }
}

main().catch((err) => fail(err.stack ?? err.message));
