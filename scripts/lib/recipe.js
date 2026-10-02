// Single source of truth for asset encoding settings. Bump RECIPE_VERSION
// whenever sharp/ffmpeg is upgraded and you want to force a full re-encode —
// see SETUP.md "Bump RECIPE_VERSION after upgrading sharp or ffmpeg".
// v2: native top rung no longer emitted for sources at or above the top
// ladder rung, so 3200 is a real ceiling.
// v3: video gains a ladder and a poster frame; recipe serialization split per
// media type so a video change no longer re-encodes every image.
export const RECIPE_VERSION = 3;

export const IMAGE_LADDER = [640, 960, 1440, 2160, 3200];

export const IMAGE_RECIPE = {
  format: "webp",
  quality: 80,
  stripMetadata: true,
  withoutEnlargement: true,
};

// Widest the layout ever asks for: .main-content caps content at 1600 CSS px,
// and the hero's tall variant needs about 3278 at 2x. See README "Optimization".
export const VIDEO_LADDER = [
  // The default. Everything at 1x is covered by this, whatever the screen size.
  { width: 1920, media: null },
  /* Opt-in, via data-large. Two clauses, comma meaning or.

     800px at 2x or better: a deliberate floor rather than a measured one. The
     layout reverts to its short hero below 450px, so 450 is where the
     requirement actually jumps; 800 trades a softer hero on small portrait
     tablets for not sending a 3200px video down a phone connection.

     1800px at any density: low density large monitors need this more than
     retina laptops do, not less. The hero box is 12:9 and the masters are
     16:9, so cover crops the sides and the height decides: a 1600px wide box
     asks for 1600 * 16/9 / (12/9) = 2133px of source, which 1920 cannot meet.
     The crossover is a 1700px viewport; 1800 is the round number just past it
     and still catches a full screen 1080p monitor, which is exactly the low
     density case where the shortfall shows. */
  {
    width: 3200,
    media: "(min-resolution: 2dppx) and (min-width: 800px), (min-width: 1800px)",
  },
];

export const VIDEO_RECIPE = {
  container: "mp4",
  videoCodec: "libx264",
  ffmpegFlags: ["-movflags", "+faststart", "-crf", "26", "-pix_fmt", "yuv420p"],
  // Audio is kept only when the source has an audio stream, so nothing here
  // decides it. These settings apply when it is kept.
  audioCodec: "aac",
  audioBitrate: "128k",
};

// Every video gets one, shown until the first frame decodes. A single width,
// because the poster attribute takes one URL and has no srcset. Deliberately
// not the top rung: it is on screen for a moment and must not compete for
// bandwidth with the video it is covering.
export const POSTER_RECIPE = {
  width: 1600,
  format: "webp",
  quality: 75,
  // Overridden per video by data-post-frame in the HTML.
  defaultFrame: 0,
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
 * Rungs to encode for a video of this source width, ascending. Never upscales.
 * A source smaller than the lowest rung is kept at its own size, so the ladder
 * is a ceiling and never a target: uploading a 1080p master is how you say
 * "this one does not need the big file".
 */
export function computeVideoLadder(sourceWidth) {
  const rungs = VIDEO_LADDER.filter((r) => r.width <= sourceWidth);
  if (rungs.length > 0) return rungs;

  return [{ width: sourceWidth, media: VIDEO_LADDER[0].media }];
}

/**
 * Canonical, stable string representations of the recipe, used as hash input
 * alongside source bytes. Must change whenever encoding output would change.
 *
 * Split per media type so that tuning video settings does not re-encode and
 * re-upload the entire image library, and the other way round.
 */
export function serializeImageRecipe() {
  return JSON.stringify({
    version: RECIPE_VERSION,
    ladder: IMAGE_LADDER,
    nearNativeFactor: NEAR_NATIVE_FACTOR,
    image: IMAGE_RECIPE,
  });
}

export function serializeVideoRecipe() {
  return JSON.stringify({
    version: RECIPE_VERSION,
    ladder: VIDEO_LADDER,
    video: VIDEO_RECIPE,
  });
}

/**
 * Poster hash input. Carries the chosen frame, so changing data-post-frame
 * re-extracts the poster without touching the video derivatives beside it.
 */
export function serializePosterRecipe(frame) {
  return JSON.stringify({
    version: RECIPE_VERSION,
    poster: POSTER_RECIPE,
    frame,
  });
}
