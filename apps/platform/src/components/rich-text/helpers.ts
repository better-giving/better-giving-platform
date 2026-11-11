import type { PortableTextBlock } from "@portabletext/editor";
import { toPlainText } from "@portabletext/toolkit";
import type { RichTextContent } from "#/types/components";

const EMPTY_DOC: PortableTextBlock[] = [];

/** parse stored json → portable text blocks */
export function to_document(json: string | undefined): PortableTextBlock[] {
  if (!json) return EMPTY_DOC;
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (b) => b && typeof b === "object" && (b as any)._type === "block"
      )
    ) {
      return parsed as PortableTextBlock[];
    }
    return EMPTY_DOC;
  } catch {
    return EMPTY_DOC;
  }
}

export function to_content(json: string | undefined): RichTextContent {
  return {
    length: to_text(json).length,
    value: json || "",
  };
}

/** extract plain text from PT json */
export function to_text(json: string | undefined): string {
  const doc = to_document(json);
  return toPlainText(doc);
}

/** PT json as one line of plain text, cut on a word boundary when it runs
 * past `max` characters. a cut that ends a sentence stands as is; any other
 * ends in "…", which replaces a trailing comma, colon or semicolon */
export function to_excerpt(json: string | undefined, max = 160): string {
  const text = to_text(json).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const room = max - 1; // the ellipsis takes the last character
  const space = text.lastIndexOf(" ", room);
  const cut = text.slice(0, space > 0 ? space : room);
  if (/[.!?]$/.test(cut)) return cut;
  return `${cut.replace(/[,;:]+$/, "")}…`;
}

interface IListBlock {
  _key: string;
  listItem?: string;
  level?: number;
}

/** the number a numbered item paints, counted the way the editor counts its
 *  `data-list-index`: consecutive items of one list at one level, with deeper
 *  items passed over and anything shallower, unlisted or of another list at
 *  this level ending the run. the editor puts that index on its own wrapper,
 *  out of reach of `renderListItem`, and each `<li>` sits in a block of its
 *  own, so no `<ol>` is there to count them. */
export function list_ordinal(
  blocks: readonly Partial<IListBlock>[],
  key: string
): number {
  const at = blocks.findIndex((b) => b._key === key);
  const self = blocks[at];
  if (!self?.listItem || self.level === undefined) return 1;
  let n = 1;
  for (let i = at - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!b.listItem || b.level === undefined || b.level < self.level) break;
    if (b.level > self.level) continue;
    if (b.listItem !== self.listItem) break;
    n++;
  }
  return n;
}

/** the length a story's cap counts: its text when it is a rich-text document,
 * else the string itself. `to_text` reads anything that isn't one as empty, and
 * a cap must not take unparseable or non-text input at any size for 0 */
export function story_length(json: string): number {
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (b) => b && typeof b === "object" && (b as any)._type === "block"
      )
    ) {
      return toPlainText(parsed as PortableTextBlock[]).length;
    }
  } catch {}
  return json.length;
}
