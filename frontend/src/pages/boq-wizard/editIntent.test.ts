import { describe, expect, it } from "vitest";
import { afterEditIntent } from "./editIntent";

/** A promise the test settles by hand, to stand in for the page's lock call. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("afterEditIntent (R33 -- the first-click revert)", () => {
  it("does not start the write until the page's lock call has answered", async () => {
    const lock = deferred();
    const events: string[] = [];
    const done = afterEditIntent(
      () => { events.push("lock sent"); return lock.promise; },
      async () => { events.push("write sent"); return "ok"; },
    );
    await tick();
    // The lock call is out and unanswered: the write must not have gone. Fired together, the
    // two requests wrote the one lock row at once and the database refused the write.
    expect(events).toEqual(["lock sent"]);
    lock.resolve();
    await expect(done).resolves.toBe("ok");
    expect(events).toEqual(["lock sent", "write sent"]);
  });

  it("still writes when the lock call fails -- the server decides and words the refusal", async () => {
    const events: string[] = [];
    const result = await afterEditIntent(
      () => Promise.reject(new Error("BOQ_DRAFT_LOCKED")),
      async () => { events.push("write sent"); return 7; },
    );
    expect(result).toBe(7);
    expect(events).toEqual(["write sent"]);
  });

  it("writes at once when the page had nothing to wait for (lock already held, or read-only)", async () => {
    const events: string[] = [];
    await afterEditIntent(() => { events.push("intent"); }, async () => { events.push("write sent"); });
    expect(events).toEqual(["intent", "write sent"]);
  });

  it("writes when no edit-intent call was given at all", async () => {
    await expect(afterEditIntent(undefined, async () => "ok")).resolves.toBe("ok");
  });

  it("passes the write's own failure through untouched", async () => {
    const failure = new Error("There is nothing to revert");
    await expect(afterEditIntent(() => undefined, () => Promise.reject(failure))).rejects.toBe(failure);
  });

  it("calls the edit-intent exactly once", async () => {
    let calls = 0;
    await afterEditIntent(() => { calls += 1; }, async () => undefined);
    expect(calls).toBe(1);
  });
});
