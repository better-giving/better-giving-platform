import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { SectionLink } from "./section-link";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", window.location.pathname);
  window.scrollTo(0, 0);
});

function reduce_motion(on: boolean) {
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((q) =>
    q.includes("prefers-reduced-motion")
      ? ({ matches: on, media: q } as MediaQueryList)
      : real(q)
  );
}

describe("SectionLink", () => {
  test.each([false, true])(
    "moves to the section, focuses it and replaces the hash, adding no history entry (reduced motion: %s)",
    async (reduced) => {
      reduce_motion(reduced);
      const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
      const screen = await render(
        <>
          <SectionLink id="story">Story</SectionLink>
          <div style={{ height: "300dvh" }} />
          <section id="story">The story</section>
        </>
      );
      const entries = window.history.length;
      await screen.getByRole("link", { name: "Story" }).click();

      expect(scroll).toHaveBeenCalledWith({
        behavior: reduced ? "auto" : "smooth",
      });
      expect(window.location.hash).toBe("#story");
      expect(window.history.length).toBe(entries);
      expect(document.activeElement).toBe(document.getElementById("story"));
    }
  );
});
