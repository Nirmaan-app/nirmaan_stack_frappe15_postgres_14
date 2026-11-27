// The one rule the in-page search boxes share (Material Plan, Work Plan): the typed text is split into words, and
// a row matches when EVERY word appears somewhere in its text. Case is ignored; a word never matches across two
// fields. Pure (F4).

/** The typed search as lower-case words; blank text gives no words (= no search). */
export const searchWords = (query: string | null | undefined): string[] =>
  (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/** Whether the texts together hold every word. No words matches everything. */
export function hasAllWords(texts: (string | null | undefined)[], words: string[]): boolean {
  if (words.length === 0) return true;
  // Joined with a newline: words hold no whitespace, so one can never span two fields.
  const text = texts.filter(Boolean).join("\n").toLowerCase();
  return words.every((word) => text.includes(word));
}
