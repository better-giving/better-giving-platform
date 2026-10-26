/** what `/api/file-upload` stores: each accepted type, with the extensions
 * that stand in for it when the browser reports no type */
export const upload_limits = {
  types: {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "image/svg+xml": [".svg"],
    "application/pdf": [".pdf"],
  } as Record<string, readonly string[]>,
  /** under Vercel Functions' 4.5 MB request-body cap, which refuses a larger
   * upload before this route runs; MiB, so a client limit of 4 MB in either
   * convention fits under it */
  max_bytes: 4 * 1024 * 1024,
};

/** the refusal for a photo past `max_bytes`: the photo page's server check
 * and its file input both show it */
export const photo_too_large = `That photo is over ${upload_limits.max_bytes / (1024 * 1024)} MB. Choose a smaller one.`;

/** the opening bytes each binary format must carry; `null` is any byte.
 * svg is text with no fixed signature, so it has no entry here. */
export const upload_signatures: Record<string, readonly (number | null)[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  // RIFF, a 4-byte chunk size, WEBP
  "image/webp": [
    0x52,
    0x49,
    0x46,
    0x46,
    null,
    null,
    null,
    null,
    0x57,
    0x45,
    0x42,
    0x50,
  ],
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
};

/** the types the photo-upload page takes: its picker's `accept`, and the
 * hold on a drop or pick of anything else */
export const photo_types = ["image/jpeg", "image/png", "image/webp"] as const;

/** the refusal for a photo the page doesn't take, held before it uploads */
export const photo_wrong_type =
  "That file isn't a photo we can use. Choose a JPEG, PNG or WebP photo.";

/** how long a photo-upload link works after it's issued */
export const photo_link_ttl_ms = 15 * 60 * 1000;

/** the per-address cap on photo uploads; the page's "too many uploads" copy
 * names the window */
export const photo_upload_quota = { max: 30, window_s: 60 } as const;
