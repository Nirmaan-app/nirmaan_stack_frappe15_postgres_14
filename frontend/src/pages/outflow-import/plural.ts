// src/pages/outflow-import/plural.ts
//
// A count with its noun, as the import screens word it: "1 line", "3 lines". Shared by the Porter and Credit
// Card import views.

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
