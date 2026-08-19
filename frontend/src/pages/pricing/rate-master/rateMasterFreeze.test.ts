import { describe, it, expect } from "vitest";
import {
  FREEZE_BLOCKED_MESSAGE,
  UNFROZEN,
  canManageRateMasterFreeze,
  freezeBannerDetail,
  frozenSinceText,
  isRateMasterWriteBlocked,
  type RateMasterFreezeState,
} from "./rateMasterFreeze";
import { isRateMasterAdmin } from "./rateMasterEdit";

const frozenAt = (msAgo: number) => {
  const d = new Date(Date.now() - msAgo);
  // Frappe's own naive "YYYY-MM-DD HH:MM:SS" shape, in site-local time.
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const state = (o: Partial<RateMasterFreezeState> = {}): RateMasterFreezeState => ({
  ...UNFROZEN,
  ...o,
});

describe("FREEZE_BLOCKED_MESSAGE (owner's approved text, VERBATIM)", () => {
  it("is byte-exact, including the spacing inside 'Nitesh/ Abhishek'", () => {
    // POSITIVE PIN. The owner supplied this string verbatim on 2026-08-18 and it must not be
    // reworded, expanded, or given a second sentence. The odd space after the slash is theirs.
    expect(FREEZE_BLOCKED_MESSAGE).toBe(
      "Rate master is locked for deployment. Contact Nitesh/ Abhishek.",
    );
  });
  it("is a single sentence pair with no trailing whitespace", () => {
    // NEGATIVE guard against a well-meaning "let me just add a hint" edit.
    expect(FREEZE_BLOCKED_MESSAGE.trim()).toBe(FREEZE_BLOCKED_MESSAGE);
    expect(FREEZE_BLOCKED_MESSAGE.split(".").filter((s) => s.trim()).length).toBe(2);
  });
});

describe("canManageRateMasterFreeze (owner ruling R5: the freeze population IS the edit population)", () => {
  it("admits Administrator and Nirmaan Admin Profile", () => {
    expect(canManageRateMasterFreeze("Nirmaan Admin Profile", "a@nirmaan.app")).toBe(true);
    expect(canManageRateMasterFreeze("anything", "Administrator")).toBe(true);
  });
  it("NEGATIVE: denies the read-only Estimates population and everyone else", () => {
    expect(canManageRateMasterFreeze("Nirmaan Estimates Executive Profile", "e@nirmaan.app")).toBe(false);
    expect(canManageRateMasterFreeze("Nirmaan Project Manager Profile", "pm@nirmaan.app")).toBe(false);
    expect(canManageRateMasterFreeze("", "x@nirmaan.app")).toBe(false);
  });
  it("NEGATIVE: denies while the role is still Loading, so no control flashes for a non-admin", () => {
    expect(canManageRateMasterFreeze("Loading", "a@nirmaan.app")).toBe(false);
    expect(canManageRateMasterFreeze("Error", "a@nirmaan.app")).toBe(false);
  });
  it("IS the same predicate, not a second copy that could drift (R5)", () => {
    // The whole point of R5 is that these two populations are ONE population. Pinned across a
    // spread of inputs rather than by reading the implementation.
    for (const role of ["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile", "Loading", "Error", ""]) {
      for (const user of ["Administrator", "a@nirmaan.app", ""]) {
        expect(canManageRateMasterFreeze(role, user)).toBe(isRateMasterAdmin(role, user));
      }
    }
  });
});

describe("isRateMasterWriteBlocked (ONE predicate for every disabled write control)", () => {
  it("blocks only when frozen", () => {
    expect(isRateMasterWriteBlocked(state({ frozen: true }))).toBe(true);
    expect(isRateMasterWriteBlocked(state({ frozen: false }))).toBe(false);
  });
  it("NEGATIVE: a missing or failed read degrades to NOT blocked (byte-identical to pre-freeze)", () => {
    // Mirrors the server's fail-open read. A transient error must never brick the screen while
    // naming a deployment nobody is doing.
    expect(isRateMasterWriteBlocked(null)).toBe(false);
    expect(isRateMasterWriteBlocked(undefined)).toBe(false);
    expect(isRateMasterWriteBlocked(UNFROZEN)).toBe(false);
  });
});

describe("frozenSinceText (owner requirement B4: ELAPSED time, not a date)", () => {
  it("renders an elapsed phrase with a suffix", () => {
    expect(frozenSinceText(frozenAt(3 * 24 * 3600 * 1000))).toBe("3 days ago");
    expect(frozenSinceText(frozenAt(2 * 3600 * 1000))).toBe("about 2 hours ago");
  });
  it("accepts Frappe's naive space-separated stamp AND microseconds", () => {
    expect(frozenSinceText("2026-08-18 10:00:00")).toMatch(/ago|in /);
    expect(frozenSinceText("2026-08-18 10:00:00.123456")).toMatch(/ago|in /);
  });
  it("NEGATIVE: returns null for absent or unparseable input rather than 'Invalid Date'", () => {
    expect(frozenSinceText(null)).toBeNull();
    expect(frozenSinceText(undefined)).toBeNull();
    expect(frozenSinceText("")).toBeNull();
    expect(frozenSinceText("not a date")).toBeNull();
  });
});

describe("freezeBannerDetail (B4: since when + who)", () => {
  it("names both halves when both are known", () => {
    const d = freezeBannerDetail(
      state({ frozen: true, frozen_by: "nitesh@nirmaan.app", frozen_at: frozenAt(3 * 24 * 3600 * 1000) }),
    );
    expect(d).toBe("Frozen 3 days ago by nitesh@nirmaan.app.");
  });
  it("degrades one half at a time -- the block is the load-bearing fact, attribution supports it", () => {
    expect(freezeBannerDetail(state({ frozen: true, frozen_at: frozenAt(60_000) }))).toBe(
      "Frozen 1 minute ago.",
    );
    expect(freezeBannerDetail(state({ frozen: true, frozen_by: "x@nirmaan.app" }))).toBe(
      "Frozen by x@nirmaan.app.",
    );
  });
  it("NEGATIVE: returns null when nothing is known, so the caller shows the title alone", () => {
    expect(freezeBannerDetail(state({ frozen: true }))).toBeNull();
    // A blank/whitespace actor is treated as unknown, never rendered as "by  ."
    expect(freezeBannerDetail(state({ frozen: true, frozen_by: "   " }))).toBeNull();
  });
});
