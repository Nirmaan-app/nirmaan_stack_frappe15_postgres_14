/**
 * SLICE 12c-F (owner R-E, 2026-10-06) -- THE NOTE BOX, MADE PROMINENT.
 *
 * Owner: "blue boxes need to be made more prominent". The box rendered at `bg-accent/40` with
 * `text-accent-foreground` -- a 40%-opacity tint of a THEME ROLE (the same token hover states use),
 * whose text is the ordinary foreground colour. On a busy panel it read as a slightly grey paragraph,
 * and what it had to say -- that the pricing substituted a size, defaulted a value, or could not match
 * one -- was the easiest line on the card to skim past.
 *
 * There is no DOM test environment in this repo (see frontend/CLAUDE.md), so these pin the CLASS the
 * two call sites share. That is the honest limit of what a unit test can see here: it cannot prove the
 * box looks right, only that the owner's ruling has not been quietly reverted. The look itself is
 * certified in the browser.
 */
import { describe, expect, it } from "vitest";
import { NOTE_BOX_CLASS, NOTE_ICON_CLASS } from "./RateHelperPanel";

// ── R-E: the note box, made prominent ────────────────────────────────────────────────────────────

describe("the note box is blue, not an accent tint (owner R-E)", () => {
  it("is a SOLID blue box with blue text, in both themes", () => {
    // owner: "blue boxes need to be made more prominent". `accent` is a theme ROLE -- the same token
    // hover states use -- which is why a 40% tint of it disappeared on a busy panel.
    expect(NOTE_BOX_CLASS).toContain("bg-blue-50");
    expect(NOTE_BOX_CLASS).toContain("border-blue-300");
    expect(NOTE_BOX_CLASS).toContain("text-blue-900");
    expect(NOTE_BOX_CLASS).toContain("dark:bg-blue-950/60");
    expect(NOTE_BOX_CLASS).toContain("dark:text-blue-100");
  });

  it("carries no accent token at all -- the tint it replaced cannot creep back", () => {
    expect(NOTE_BOX_CLASS).not.toMatch(/accent/);
    expect(NOTE_ICON_CLASS).not.toMatch(/accent/);
  });

  it("the info icon is blue too", () => {
    expect(NOTE_ICON_CLASS).toContain("text-blue-600");
    expect(NOTE_ICON_CLASS).toContain("dark:text-blue-300");
  });
});
