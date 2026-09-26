import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutosaveController, type AutosaveStatus, type DurableStore } from "./controller";

function memoryStore(): DurableStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

type Snap = { text: string; ready?: boolean };

function setup(save: (s: Snap) => Promise<void>) {
  const store = memoryStore();
  const statuses: AutosaveStatus[] = [];
  const saved: Snap[] = [];
  const c = new AutosaveController<Snap>({
    save,
    canSave: (s) => s.ready !== false,
    storageKey: "k",
    store,
    onStatus: (s) => statuses.push(s),
    onSaved: (s) => saved.push(s),
  });
  return { c, store, statuses, saved };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AutosaveController", () => {
  it("debounces rapid edits into one save of the latest snapshot", async () => {
    const save = vi.fn(async () => {});
    const { c } = setup(save);
    c.update({ text: "a" });
    c.update({ text: "ab" });
    c.update({ text: "abc" });
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ text: "abc" });
    expect(c.getStatus()).toBe("saved");
    expect(c.hasUnsaved()).toBe(false);
  });

  it("mirrors every change durably and clears it only after confirmation", async () => {
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const { c, store } = setup(save);
    c.update({ text: "x" });
    expect(JSON.parse(store.data.get("k")!).snapshot).toEqual({ text: "x" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.getStatus()).toBe("saving");
    expect(store.data.has("k")).toBe(true); // not confirmed yet
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.data.has("k")).toBe(false);
  });

  it("saves edits made during an in-flight save right afterwards, in order", async () => {
    const calls: string[] = [];
    let release!: () => void;
    const save = vi.fn(async (s: Snap) => {
      calls.push(s.text);
      if (calls.length === 1) await new Promise<void>((r) => (release = r));
    });
    const { c, store } = setup(save);
    c.update({ text: "first" });
    await vi.advanceTimersByTimeAsync(1000);
    c.update({ text: "second" }); // while saving
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(["first", "second"]);
    expect(c.getStatus()).toBe("saved");
    expect(store.data.has("k")).toBe(false);
  });

  it("retries failures with backoff and never drops the change", async () => {
    let fail = 2;
    const save = vi.fn(async () => {
      if (fail-- > 0) throw new Error("network");
    });
    const { c, statuses, store } = setup(save);
    c.update({ text: "keep me" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.getStatus()).toBe("error");
    expect(store.data.has("k")).toBe(true);
    await vi.advanceTimersByTimeAsync(2000); // 1st retry fails
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000); // 2nd retry succeeds
    expect(save).toHaveBeenCalledTimes(3);
    expect(c.getStatus()).toBe("saved");
    expect(statuses.filter((s) => s === "error")).toHaveLength(2);
    expect(store.data.has("k")).toBe(false);
  });

  it("manual retry saves immediately", async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error("x");
    });
    const { c } = setup(save);
    c.update({ text: "y" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.getStatus()).toBe("error");
    fail = false;
    await c.retry();
    expect(c.getStatus()).toBe("saved");
  });

  it("holds changes as 'blocked' until required fields exist, but still mirrors them", async () => {
    const save = vi.fn(async () => {});
    const { c, store } = setup(save);
    c.update({ text: "draft", ready: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    expect(c.getStatus()).toBe("blocked");
    expect(store.data.has("k")).toBe(true);
    c.update({ text: "draft", ready: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("exposes an unconfirmed snapshot for crash recovery", () => {
    const store = memoryStore();
    store.set("k", JSON.stringify({ snapshot: { text: "lost?" }, at: 123 }));
    const c = new AutosaveController<Snap>({ save: async () => {}, storageKey: "k", store });
    expect(c.readRecovery()).toEqual({ snapshot: { text: "lost?" }, at: 123 });
    c.clearRecovery();
    expect(c.readRecovery()).toBeNull();
  });

  it("flush() saves pending changes without waiting for the debounce", async () => {
    const save = vi.fn(async () => {});
    const { c } = setup(save);
    c.update({ text: "now" });
    await c.flush();
    expect(save).toHaveBeenCalledWith({ text: "now" });
  });
});
