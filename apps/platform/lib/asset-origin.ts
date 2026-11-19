/** origin of the vite `base` (`import.meta.env.BASE_URL`) for a cross-origin
 * preconnect; null when the base is same-origin ("/") so nothing is emitted. */
export function asset_origin(base: string): string | null {
  try {
    const { origin } = new URL(base);
    // opaque schemes (data:, blob:) serialise as "null"
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}
