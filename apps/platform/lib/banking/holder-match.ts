export type THolderMatch = "match" | "mismatch" | "unknown" | "no_legal_name";

const SUFFIXES = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "llc",
  "ltd",
  "co",
  "company",
]);

/** lowercased words, accents, punctuation, `&`, a leading "the" and trailing
 * corporate suffixes gone. dots and apostrophes join (`L.L.C.` → `llc`), any
 * other punctuation splits */
function name_words(name: string): string[] {
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words[0] === "the") words.shift();
  while (words.length > 0 && SUFFIXES.has(words[words.length - 1]!)) {
    words.pop();
  }
  return words;
}

/** whether a bank account's holder name is the nonprofit's legal name, as
 * far as case, punctuation, spacing and corporate suffixes go. no holder on
 * record is "unknown", never a mismatch; a holder with no legal name to
 * compare it to is "no_legal_name", which approval confirms as a mismatch */
export function holder_match(
  holder: string | null | undefined,
  legal_name: string | undefined
): THolderMatch {
  if (!holder?.trim()) return "unknown";
  if (!legal_name?.trim()) return "no_legal_name";
  const a = name_words(holder).join(" ");
  const b = name_words(legal_name).join(" ");
  return a !== "" && a === b ? "match" : "mismatch";
}
