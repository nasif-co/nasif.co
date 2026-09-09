// Single source of truth for asset encoding settings. Bump RECIPE_VERSION
// whenever sharp/ffmpeg is upgraded and you want to force a full re-encode —
// see SETUP.md "Bump RECIPE_VERSION after upgrading sharp or ffmpeg".
// v2: native top rung no longer emitted for sources at or above the top
// ladder rung, so 3200 is a real ceiling.
export const RECIPE_VERSION = 2;

export const IMAGE_LADDER = [640, 960, 1440, 2160, 3200];

export const IMAGE_RECIPE = {
  format: "webp",
  quality: 80,
  stripMetadata: true,
  withoutEnlargement: true,
};

export const VIDEO_RECIPE = {
  container: "mp4",
  videoCodec: "libx264",
  ffmpegFlags: ["-movflags", "+faststart", "-crf", "26", "-pix_fmt", "yuv420p"],
  // Audio is kept only when the source has an audio stream, so nothing here
  // decides it. These settings apply when it is kept.
  audioCodec: "aac",
  audioBitrate: "128k",
};

// Rungs within this factor of the native width are considered redundant with
// a native-resolution top rung and dropped. See SPEC.md §6 "Images".
const NEAR_NATIVE_FACTOR = 1.2;

/**
 * Given a source image's intrinsic width, returns the ascending list of
 * output widths to encode. Never upscales (every returned width <= sourceWidth).
 * If sourceWidth doesn't land exactly on a ladder rung, a native-width top
 * rung is added and any ladder rungs within NEAR_NATIVE_FACTOR of it are
 * dropped as redundant.
 */
export function computeImageLadder(sourceWidth) {
  // At or above the top rung the ladder is the ceiling — a native top rung
  // applies only to sources falling *between* rungs, never above them.
  const top = IMAGE_LADDER[IMAGE_LADDER.length - 1];
  if (sourceWidth >= top) return [...IMAGE_LADDER];

  const candidates = IMAGE_LADDER.filter((w) => w <= sourceWidth);
  const largest = candidates.length ? candidates[candidates.length - 1] : -Infinity;

  if (largest === sourceWidth) {
    return candidates;
  }

  const threshold = sourceWidth / NEAR_NATIVE_FACTOR;
  const kept = candidates.filter((w) => w < threshold);
  return [...kept, sourceWidth];
}

/**
 * Canonical, stable string representation of the recipe, used as hash input
 * alongside source bytes. Must change whenever encoding output would change.
 */
export function serializeRecipe() {
  return JSON.stringify({
    version: RECIPE_VERSION,
    ladder: IMAGE_LADDER,
    nearNativeFactor: NEAR_NATIVE_FACTOR,
    image: IMAGE_RECIPE,
    video: VIDEO_RECIPE,
  });
}
