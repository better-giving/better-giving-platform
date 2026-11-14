/** the route every uploaded document is opened through */
export const DOCS_PATH = "/api/docs";

/** the link to open an uploaded document. `ref` is what the record stores for
 * it: a private-store url, or an older stored url that still reads through the
 * same route. the route checks the caller; the link itself opens nothing. */
export const doc_href = (ref: string, origin = ""): string =>
  `${origin}${DOCS_PATH}?ref=${encodeURIComponent(ref)}`;
