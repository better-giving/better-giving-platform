import { afterEach, describe, expect, test, vi } from "vitest";
import { when_idle } from "./when-idle";

function stub_page(ready: "loading" | "complete", idle = true) {
  const listeners: Record<string, () => void> = {};
  const ric = vi.fn((cb: () => void) => cb());
  const win: Record<string, unknown> = {
    addEventListener: (type: string, cb: () => void) => {
      listeners[type] = cb;
    },
  };
  if (idle) win.requestIdleCallback = ric;
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { readyState: ready });
  vi.stubGlobal("requestIdleCallback", ric);
  return { listeners, ric };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("when_idle", () => {
  test("holds the callback until the load event", () => {
    const { listeners, ric } = stub_page("loading");
    const fn = vi.fn();
    when_idle(fn);
    expect(fn).not.toHaveBeenCalled();
    listeners.load?.();
    expect(ric).toHaveBeenCalledWith(fn, { timeout: 2000 });
    expect(fn).toHaveBeenCalledOnce();
  });

  test("runs on an idle slot at once when the page already loaded", () => {
    const { ric } = stub_page("complete");
    const fn = vi.fn();
    when_idle(fn, 500);
    expect(ric).toHaveBeenCalledWith(fn, { timeout: 500 });
    expect(fn).toHaveBeenCalledOnce();
  });

  test("falls back to a timer where requestIdleCallback is missing", () => {
    vi.useFakeTimers();
    stub_page("complete", false);
    const fn = vi.fn();
    when_idle(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });
});
