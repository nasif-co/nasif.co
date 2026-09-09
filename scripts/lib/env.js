// The single place that knows env var names and validates them.
//
// dotenv's only job is populating process.env from .env — it has no getter
// API, so reads are always process.env.X. Centralising both here means one
// module owns loading and one module owns validation.
//
// Loading is safe in every context: locally .env is read; on Cloudflare Pages
// there is no .env file and dotenv silently no-ops, leaving the real Pages
// environment variables untouched.
import "dotenv/config";

function requireEnv(names) {
  const out = {};
  const missing = [];
  for (const name of names) {
    const value = process.env[name];
    if (!value) missing.push(name);
    out[name] = value;
  }
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}\n` +
        `Check your .env file — see SETUP.md §4.`
    );
  }
  return out;
}

/** Credentials for talking to R2. sync.js only — build.js must never need these. */
export function syncEnv() {
  const e = requireEnv([
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "S3_ENDPOINT",
  ]);
  return {
    accessKeyId: e.R2_ACCESS_KEY_ID,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY,
    bucket: e.R2_BUCKET,
    endpoint: e.S3_ENDPOINT,
  };
}

/** URLs the build substitutes into HTML. No credentials, no network access. */
export function buildEnv() {
  const e = requireEnv(["ASSET_BASE_URL", "SITE_URL"]);
  return {
    assetBaseUrl: e.ASSET_BASE_URL.replace(/\/$/, ""),
    siteUrl: e.SITE_URL.replace(/\/$/, ""),
  };
}
