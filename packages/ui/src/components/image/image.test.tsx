import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Image } from "./image";

// a png signature with nothing after it: the browser settles it as a failed
// decode (complete, naturalWidth 0) without a network round trip
const BROKEN = "data:image/png;base64,iVBORw0KGgo=";
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** paints the server markup, lets the browser settle the request with no react
 *  listening, then hydrates — the order a slow bundle produces in production.
 *  the markup is what `Image` server-renders for these props, spelled out:
 *  react-dom/server here is a dep vite discovers mid-run, and the reload it
 *  forces fails a cold first run on a second copy of react. */
async function hydrate_after_settle(src: string) {
  const el = <Image src={src} alt="Org logo" className="size-12" />;
  host = document.createElement("div");
  host.innerHTML = `<img src="${src}" class="object-contain size-12 " alt="Org logo">`;
  document.body.append(host);
  const img = host.querySelector("img") as HTMLImageElement;
  await vi.waitFor(() => expect(img.complete).toBe(true));
  await act(async () => {
    root = hydrateRoot(host as HTMLElement, el);
  });
  return host;
}

describe("Image: a src that fails before hydration", () => {
  test("swaps the broken glyph for the placeholder", async () => {
    const el = await hydrate_after_settle(BROKEN);

    await vi.waitFor(() => {
      expect(el.querySelector("img")).toBeNull();
      expect(el.querySelector(".lucide-image")).not.toBeNull();
    });
  });

  test("keeps an image that loaded before hydration", async () => {
    const el = await hydrate_after_settle(PIXEL);

    const img = el.querySelector("img") as HTMLImageElement;
    expect(img.naturalWidth).toBe(1);
    expect(el.querySelector(".lucide-image")).toBeNull();
  });
});

describe("Image: a new src after a failure", () => {
  test("gets its own attempt rather than the old placeholder", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const r = createRoot(host);
    root = r;
    const el = host;
    act(() => r.render(<Image src={BROKEN} alt="Org logo" />));
    await vi.waitFor(() => {
      expect(el.querySelector(".lucide-image")).not.toBeNull();
    });

    act(() => r.render(<Image src={PIXEL} alt="Org logo" />));
    await vi.waitFor(() => {
      expect(el.querySelector("img")?.naturalWidth).toBe(1);
    });
    expect(el.querySelector(".lucide-image")).toBeNull();
  });
});

// an svg sized by its viewBox alone has no intrinsic width: firefox reports a
// loaded one as complete with naturalWidth 0, the same reading as a failure
const VIEWBOX_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="red"/></svg>'
)}`;

describe("Image: a viewBox-only svg that loaded before hydration", () => {
  test("is kept, not swapped for the placeholder", async () => {
    host = document.createElement("div");
    host.innerHTML = `<img src="${VIEWBOX_SVG}" class="object-contain size-12 " alt="Google">`;
    document.body.append(host);
    const img = host.querySelector("img") as HTMLImageElement;
    await vi.waitFor(() => expect(img.complete).toBe(true));
    // chromium gives such an svg a default size; read it as firefox does
    Object.defineProperty(img, "naturalWidth", { value: 0 });
    await act(async () => {
      root = hydrateRoot(
        host as HTMLElement,
        <Image src={VIEWBOX_SVG} alt="Google" className="size-12" />
      );
    });
    // the decode the check waits on settles within a task or two
    await new Promise((r) => setTimeout(r, 100));

    expect(host.querySelector("img")).toBe(img);
    expect(host.querySelector(".lucide-image")).toBeNull();
  });
});

describe("Image: a failure under a render wrapper", () => {
  test("keeps the wrapper around the placeholder", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const r = createRoot(host);
    root = r;
    const el = host;
    act(() =>
      r.render(
        <Image
          src={BROKEN}
          alt="Better Giving"
          render={(img) => <a href="/">{img}</a>}
        />
      )
    );
    await vi.waitFor(() => {
      expect(el.querySelector("a .lucide-image")).not.toBeNull();
    });
  });
});
