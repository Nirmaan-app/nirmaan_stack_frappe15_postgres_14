// Move's words (spec #1753 stories 37-39; the domain's Rectify, GLOSSARY.md): one rule for every wired source --
// Cashbook (#1757) and Porter (#1759) -- on the Bulk Import line's button, the toolbar, the Move dialog's title and run
// button, and an expense's locked-project hint. Pure: `moveLabel.test.ts` pins it.

const PROJECT_EXPENSE = "Project Expenses";

export const MOVE_TO_A_PROJECT = "Move to a project";
export const CHANGE_PROJECT = "Change project";

/**
 * The words over the expenses' ledgers: "Move to a project" when none is a Project Expense, "Change project" when
 * every one is, "Move N expenses" for a mixed selection.
 */
export const moveLabel = (ledgers: readonly (string | null | undefined)[]): string => {
    const onProject = ledgers.filter((ledger) => ledger === PROJECT_EXPENSE).length;
    if (onProject === 0) return MOVE_TO_A_PROJECT;
    if (onProject === ledgers.length) return CHANGE_PROJECT;
    return `Move ${ledgers.length} expenses`;
};
