// Encodes everything in site/assets/ into .assets-build/, mirrors that folder into
// R2, and rewrites assets-manifest.json. Runs from the pre-commit hook, so it
// must be idempotent and quiet when nothing changed.
//
// Sources are never uploaded and never deleted. R2 holds derivatives only.
import { execFileSync } from "node:child_process";
import { readdir, readFile, mkdir, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { glob } from "glob";

import {
  computeImageLadder, computeVideoLadder,
  serializeImageRecipe, serializeVideoRecipe, serializePosterRecipe,
  IMAGE_RECIPE, VIDEO_RECIPE, POSTER_RECIPE,
} from "./lib/recipe.js";
import { computeAssetHash } from "./lib/hash.js";
import { readManifest, writeManifest } from "./lib/manifest.js";
import { createR2Client, listAllKeys, putDerivative, deleteKeys } from "./lib/r2Client.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_DIR = path.join(root, "site");
const SOURCE_DIR = path.join(SITE_DIR, "assets");
const BUILD_DIR = path.join(root, ".assets-build");

// The literal prefix authors write, matching build.js.
const ASSET_PREFIX = "/assets/";

// Room for one decoded frame as PNG. A 4K frame is around 25 MB.
const POSTER_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

// How the source directory is written in messages, relative to the repo root.
const SOURCE_LABEL = "site/assets";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm"]);

// Extensions worth a better message than "unrecognized".
const REJECTED = {
  ".gif": "Convert it to mp4 first — animated GIFs are not a supported source format.",
  ".heic": "sharp cannot decode HEIC (its libvips build excludes the HEVC codec). Convert it first:\n    sips -s format jpeg <file>.HEIC --out <file>.jpg",
  ".heif": "sharp cannot decode HEIF (its libvips build excludes the HEVC codec). Convert it first:\n    sips -s format jpeg <file>.HEIF --out <file>.jpg",
};

const log = [];
function note(line) {
  log.push(line);
}

function fail(message) {
  console.error(`\nsync failed:\n  ${message}\n`);
  process.exit(1);
}

/** Flat scan of site/assets/. Throws on anything it can't encode. */
async function scanSources() {
  if (!existsSync(SOURCE_DIR)) return [];

  const entries = await readdir(SOURCE_DIR, { withFileTypes: true });
  const sources = [];
  const stems = new Map();

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // .DS_Store and friends

    if (entry.isDirectory()) {
      fail(
        `${SOURCE_LABEL}/${entry.name}/ is a directory.\n  ` +
          `${SOURCE_LABEL}/ must be flat — manifest keys and derivative names have no directory part,\n  ` +
          `so nested sources would collide in the bucket.`
      );
    }

    const ext = path.extname(entry.name).toLowerCase();
    const stem = path.basename(entry.name, path.extname(entry.name));

    if (REJECTED[ext]) {
      fail(`${SOURCE_LABEL}/${entry.name} — ${REJECTED[ext]}`);
    }

    const isImage = IMAGE_EXTS.has(ext);
    const isVideo = VIDEO_EXTS.has(ext);
    if (!isImage && !isVideo) {
      fail(
        `${SOURCE_LABEL}/${entry.name} has an unrecognized extension "${ext}".\n  ` +
          `Images: ${[...IMAGE_EXTS].join(" ")}\n  ` +
          `Video:  ${[...VIDEO_EXTS].join(" ")}`
      );
    }

    // Two sources sharing a stem would produce the same derivative names.
    if (stems.has(stem)) {
      fail(
        `Duplicate stem "${stem}": ${SOURCE_LABEL}/${stems.get(stem)} and ${SOURCE_LABEL}/${entry.name}\n  ` +
          `both produce derivatives named ${stem}-<width>.<hash>.webp — rename one.`
      );
    }
    stems.set(stem, entry.name);

    sources.push({
      filename: entry.name, // the manifest key, matching /assets/<filename> in HTML
      stem,
      ext,
      type: isImage ? "image" : "video",
      absPath: path.join(SOURCE_DIR, entry.name),
    });
  }

  return sources.sort((a, b) => a.filename.localeCompare(b.filename));
}

/**
 * Which frame each video wants for its poster, from data-post-frame in the
 * HTML. That attribute belongs next to the content it describes, but the
 * poster has to be made here, where ffmpeg is — so this is the one place sync
 * looks outside site/assets/. Videos with no attribute use the default frame.
 */
async function scanPosterFrames() {
  const frames = new Map();
  const files = (await glob("**/*.html", { cwd: SITE_DIR, nodir: true })).sort();

  for (const file of files) {
    const html = await readFile(path.join(SITE_DIR, file), "utf8");

    for (const [, attrText, inner] of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
      const frame = attrText.match(/\bdata-post-frame\s*=\s*"([^"]*)"/i)?.[1];
      if (frame === undefined) continue;

      // The src sits on the <video> in one form and on a <source> in the other.
      const src =
        attrText.match(/\bsrc\s*=\s*"([^"]*)"/i)?.[1] ??
        inner.match(/<source\b[^>]*?\bsrc\s*=\s*"([^"]*)"/i)?.[1];

      if (!src?.startsWith(ASSET_PREFIX)) continue;

      const filename = src.slice(ASSET_PREFIX.length);
      const value = Number(frame);

      if (!Number.isInteger(value) || value < 0) {
        fail(`site/${file} — data-post-frame="${frame}" must be a whole frame number, counting from 0.`);
      }

      const already = frames.get(filename);
      if (already !== undefined && already !== value) {
        fail(
          `${filename} is asked for two different poster frames: ${already} and ${value}.\n  ` +
            `A video has one poster, so the frame has to be the same everywhere it appears.`
        );
      }

      frames.set(filename, value);
    }
  }

  return frames;
}

/** Post-EXIF-rotation dimensions, i.e. how the image actually displays. */
function orientedSize(meta) {
  const swapped = [5, 6, 7, 8].includes(meta.orientation);
  return swapped
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}

async function encodeImage(source, hash) {
  const meta = await sharp(source.absPath).metadata();
  const { width, height } = orientedSize(meta);
  const variants = [];

  for (const w of computeImageLadder(width)) {
    const key = `${source.stem}-${w}.${hash}.${IMAGE_RECIPE.format}`;
    const outPath = path.join(BUILD_DIR, key);

    if (!existsSync(outPath)) {
      await sharp(source.absPath)
        // .rotate() with no argument bakes in EXIF orientation and drops the
        // tag. Required because sharp strips metadata by default, so an
        // unrotated image would lose the hint and display sideways.
        .rotate()
        .resize({ width: w, withoutEnlargement: IMAGE_RECIPE.withoutEnlargement })
        .webp({ quality: IMAGE_RECIPE.quality })
        .toFile(outPath);
      note(`  encoded  ${key}`);
    }
    variants.push({ w, key });
  }

  return { hash, width, height, variants };
}

function probeVideo(absPath) {
  const raw = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", absPath],
    { encoding: "utf8" }
  );
  const streams = JSON.parse(raw).streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error(`${absPath} has no video stream`);

  return {
    width: video.width,
    height: video.height,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

async function encodeVideo(source, hash, poster) {
  const { width, height, hasAudio } = probeVideo(source.absPath);
  const variants = [];

  for (const rung of computeVideoLadder(width)) {
    const key = `${source.stem}-${rung.width}.${hash}.${VIDEO_RECIPE.container}`;
    const outPath = path.join(BUILD_DIR, key);

    if (!existsSync(outPath)) {
      // The source decides: audio is re-encoded if it exists, dropped if not.
      // Because the decision follows the source bytes, it is already covered by
      // the asset hash.
      const audioArgs = hasAudio
        ? ["-c:a", VIDEO_RECIPE.audioCodec, "-b:a", VIDEO_RECIPE.audioBitrate]
        : ["-an"];

      // -2 keeps the height even, which H.264 requires. Skipped entirely at
      // native width, so an odd-sized source is never nudged.
      const scaleArgs = rung.width === width ? [] : ["-vf", `scale=${rung.width}:-2`];

      execFileSync(
        "ffmpeg",
        ["-y", "-v", "error", "-i", source.absPath,
         ...scaleArgs,
         "-c:v", VIDEO_RECIPE.videoCodec, ...VIDEO_RECIPE.ffmpegFlags, ...audioArgs, outPath],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      note(`  encoded  ${key}${hasAudio ? "  (audio kept)" : ""}`);
    }

    variants.push({ w: rung.width, media: rung.media, key });
  }

  return { hash, width, height, variants, poster: await encodePoster(source, poster, width) };
}

/** One still, shown until the first frame decodes. Hashed on its own so that
    changing data-post-frame re-extracts it without re-encoding the video. */
async function encodePoster(source, poster, sourceWidth) {
  const key = `${source.stem}-poster.${poster.hash}.${POSTER_RECIPE.format}`;
  const outPath = path.join(BUILD_DIR, key);

  if (!existsSync(outPath)) {
    /* select= decodes forward rather than seeking, which is frame accurate
       where -ss would land on the nearest keyframe. These are short clips, so
       the cost is small. The comma is escaped for ffmpeg's own filter parser,
       not for a shell — there is no shell here. */
    const frame = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", source.absPath,
       "-vf", `select=eq(n\\,${poster.frame})`,
       "-frames:v", "1", "-f", "image2", "-vcodec", "png", "-"],
      { maxBuffer: POSTER_MAX_BUFFER_BYTES }
    );

    if (frame.length === 0) {
      fail(
        `${SOURCE_LABEL}/${source.filename} has no frame ${poster.frame}.\n  ` +
          `data-post-frame is past the end of the clip.`
      );
    }

    await sharp(frame)
      .resize({ width: Math.min(POSTER_RECIPE.width, sourceWidth), withoutEnlargement: true })
      .webp({ quality: POSTER_RECIPE.quality })
      .toFile(outPath);

    note(`  encoded  ${key}  (frame ${poster.frame})`);
  }

  return { key, frame: poster.frame };
}

/** Every derivative key a manifest entry refers to. */
function keysOf(entry) {
  const keys = entry.variants ? entry.variants.map((v) => v.key) : [entry.key];
  if (entry.poster) keys.push(entry.poster.key);
  return keys;
}

async function main() {
  await mkdir(BUILD_DIR, { recursive: true });

  const sources = await scanSources();
  const posterFrames = await scanPosterFrames();

  // Separate recipes, so tuning video does not re-encode every image.
  const imageRecipe = serializeImageRecipe();
  const videoRecipe = serializeVideoRecipe();

  const previous = await readManifest();
  const manifest = { version: 1, images: {}, videos: {} };

  // ── Encode (steps 4-5) ──────────────────────────────────────────────────
  for (const source of sources) {
    const bytes = await readFile(source.absPath);
    const isImage = source.type === "image";
    const bucket = isImage ? "images" : "videos";

    const hash = computeAssetHash(bytes, isImage ? imageRecipe : videoRecipe);
    const prior = previous[bucket]?.[source.filename];

    const poster = isImage
      ? null
      : (() => {
          const frame = posterFrames.get(source.filename) ?? POSTER_RECIPE.defaultFrame;
          return { frame, hash: computeAssetHash(bytes, serializePosterRecipe(frame)) };
        })();

    // Unchanged source, recipe and poster frame, and every derivative on disk.
    const posterUnchanged = isImage || prior?.poster?.frame === poster.frame;

    if (
      prior?.hash === hash &&
      posterUnchanged &&
      keysOf(prior).every((k) => existsSync(path.join(BUILD_DIR, k)))
    ) {
      manifest[bucket][source.filename] = prior;
      continue;
    }

    manifest[bucket][source.filename] = isImage
      ? await encodeImage(source, hash)
      : await encodeVideo(source, hash, poster);
  }

  // The set .assets-build/ and the bucket should both contain, exactly.
  const expected = new Set();
  for (const group of [manifest.images, manifest.videos]) {
    for (const entry of Object.values(group)) keysOf(entry).forEach((k) => expected.add(k));
  }

  // ── Empty-sources guard (before anything destructive) ───────────────────
  const r2 = createR2Client();
  const remote = await listAllKeys(r2);

  if (sources.length === 0 && remote.size > 0) {
    fail(
      `${SOURCE_LABEL}/ is empty but the bucket holds ${remote.size} object(s).\n  ` +
        `Refusing to prune — this is what a fresh clone looks like, and there is no downsync.\n  ` +
        `Restore your sources, or bypass this commit with: git commit --no-verify`
    );
  }

  // ── Drop stale local derivatives so .assets-build/ mirrors the bucket ───
  for (const name of await readdir(BUILD_DIR)) {
    if (name.startsWith(".")) continue;
    if (!expected.has(name)) {
      await unlink(path.join(BUILD_DIR, name));
      note(`  removed  ${name} (stale local derivative)`);
    }
  }

  // ── Upload (step 7) ─────────────────────────────────────────────────────
  for (const key of [...expected].sort()) {
    if (remote.has(key)) continue;
    const body = await readFile(path.join(BUILD_DIR, key));
    const contentType = key.endsWith(".webp") ? "image/webp" : "video/mp4";
    await putDerivative(r2, key, body, contentType);
    const size = (body.length / 1024).toFixed(0);
    note(`  uploaded ${key}  (${size} KB)`);
  }

  // ── Prune (step 8) ──────────────────────────────────────────────────────
  const orphaned = [...remote].filter((key) => !expected.has(key));
  if (orphaned.length) {
    await deleteKeys(r2, orphaned);
    for (const key of orphaned.sort()) note(`  pruned   ${key}`);
  }

  // ── Manifest (step 9) ───────────────────────────────────────────────────
  await writeManifest(manifest);

  if (log.length) {
    console.log(`\nsync — ${sources.length} source(s), ${expected.size} derivative(s)`);
    console.log(log.join("\n") + "\n");
  } else {
    console.log(`sync — up to date (${sources.length} sources, ${expected.size} derivatives)`);
  }
}

main().catch((err) => fail(err.stack ?? err.message));
