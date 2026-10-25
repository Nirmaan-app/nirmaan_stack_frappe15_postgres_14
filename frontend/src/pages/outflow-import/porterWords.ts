// src/pages/outflow-import/porterWords.ts
//
// How the Porter screens count things in words: "1 order", "12 orders". The one copy every Porter helper
// imports, so two screens never count the same thing differently.

/** `count` with the noun for that count: `plural(1, "invoice", "invoices")` is "1 invoice". */
export const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** "1 order", "12 orders". */
export const orders = (count: number): string => plural(count, "order", "orders");
