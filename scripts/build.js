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
import { defaultSizes } from "./lib/sizes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// site/ is the web root: its contents become the contents of dist/.
const SITE = path.join(root, "site");
const DIST = path.join(root, "dist");
const PASSTHROUGH = ["css", "js", "static"];

// The literal prefix authors write. Root-relative, because nested pages would
// otherwise need a varying number of "../".
const ASSET_PREFIX = "/assets/";
const FALLBACK_WIDTH = 1440;

// Matches VIDEO_RECIPE.container. Not imported: build.js stays dependency-light.
const VIDEO_MIME = "video/mp4";

// Read by the build and not emitted, alongside the ones it writes itself.
const STRIPPED_VIDEO_ATTRS = ["src", "width", "height", "poster", "data-large", "data-post-frame"];

/**
 * The rungs a <video> may offer. Only data-large is allowed the top one, so a
 * grid video never ships the hero's file. A single-rung entry ignores the flag.
 */
function pickVideo(entry, wantsLarge) {
  const variants = entry.variants ?? [{ w: entry.width, media: null, key: entry.key }];
  const ascending = [...variants].sort((a, b) => a.w - b.w);
  return wantsLarge ? ascending : [ascending[0]];
}

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
  /* Comments go first, before anything below looks at a tag.
     Two reasons. They are notes to whoever edits site/, not something a
     visitor needs. And the passes below match tags with regexes that know
     nothing about comments, so a comment mentioning one would be read as the
     real thing: a commented-out video tag matched as far as the next real
     </video>, swallowing an actual src and leaving it unexpanded.
     Deliberately not touching <!DOCTYPE>, which does not match. */
  html = html.replace(/<!--[\s\S]*?-->/g, "");
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
  html = html.replace(/<img\b([^>]*?)\s*\/?>/gi, (whole, attrText, offset) => {
    const attrs = parseAttrs(attrText);
    const src = attrs.find((a) => a.name.toLowerCase() === "src");
    if (!src?.value?.startsWith(ASSET_PREFIX)) return whole;

    const filename = src.value.slice(ASSET_PREFIX.length);
    const entry = lookup("images", filename, "img");

    const sizes = attrs.find((a) => a.name.toLowerCase() === "data-sizes");
    const classes = attrs.find((a) => a.name.toLowerCase() === "class")?.value ?? "";
    const preserved = attrs.filter(
      (a) => !["src", "srcset", "sizes", "data-sizes", "width", "height"].includes(a.name.toLowerCase())
    );

    const expanded = [
      { name: "src", value: url(pickFallback(entry.variants).key) },
      { name: "srcset", value: entry.variants.map((v) => `${url(v.key)} ${v.w}w`).join(", ") },
      // Absent data-sizes → derived from where the image sits. See lib/sizes.js.
      { name: "sizes", value: sizes?.value ?? defaultSizes(classes, html.slice(0, offset)) },
      { name: "width", value: String(entry.width) },
      { name: "height", value: String(entry.height) },
    ];

    return `<img ${serializeAttrs([...expanded, ...preserved])}>`;
  });

  // ── <video> → hashed URLs, intrinsic dimensions and a poster ────────────
  // Both forms are handled here: a src on the <video>, or <source> children.
  // Only a video marked data-large is offered the top rung, as a <source
  // media> alternative; everything else gets the smallest rung as a plain src.
  html = html.replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, (whole, attrText, inner) => {
    const attrs = parseAttrs(attrText);
    const src = attrs.find((a) => a.name.toLowerCase() === "src");
    const wantsLarge = attrs.some((a) => a.name.toLowerCase() === "data-large");

    // data-large and data-post-frame are build directives; they mean nothing
    // to a browser, so they are read here and dropped.
    const preserved = attrs.filter(
      (a) => !STRIPPED_VIDEO_ATTRS.includes(a.name.toLowerCase())
    );

    /** Dimensions and poster belong on the <video>, whichever form was used. */
    const videoAttrs = (entry) => {
      const out = [
        { name: "width", value: String(entry.width) },
        { name: "height", value: String(entry.height) },
      ];
      if (entry.poster) out.push({ name: "poster", value: url(entry.poster.key) });
      return out;
    };

    // Hand-written <source> children, rewritten where they stand.
    if (!src?.value?.startsWith(ASSET_PREFIX)) {
      const found = [];

      const newInner = inner.replace(/<source\b([^>]*?)\s*\/?>/gi, (sourceTag, sourceAttrText) => {
        const sourceAttrs = parseAttrs(sourceAttrText);
        const sourceSrc = sourceAttrs.find((a) => a.name.toLowerCase() === "src");
        if (!sourceSrc?.value?.startsWith(ASSET_PREFIX)) return sourceTag;

        const entry = lookup("videos", sourceSrc.value.slice(ASSET_PREFIX.length), "source");
        found.push(entry);
        sourceSrc.value = url(pickVideo(entry, wantsLarge)[0].key);
        return `<source ${serializeAttrs(sourceAttrs)}>`;
      });

      if (found.length === 0) return whole;
      return `<video ${serializeAttrs([...videoAttrs(found[0]), ...preserved])}>${newInner}</video>`;
    }

    const entry = lookup("videos", src.value.slice(ASSET_PREFIX.length), "video");
    const chosen = pickVideo(entry, wantsLarge);

    // One rung, so there is nothing to choose between at runtime.
    if (chosen.length === 1) {
      const expanded = [{ name: "src", value: url(chosen[0].key) }, ...videoAttrs(entry)];
      return `<video ${serializeAttrs([...expanded, ...preserved])}>${inner}</video>`;
    }

    // Largest first: the browser takes the first <source> whose media matches.
    const sources = [...chosen]
      .reverse()
      .map((v) => {
        const media = v.media ? ` media="${v.media}"` : "";
        return `<source src="${url(v.key)}" type="${VIDEO_MIME}"${media}>`;
      })
      .join("");

    return `<video ${serializeAttrs([...videoAttrs(entry), ...preserved])}>${sources}${inner}</video>`;
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
