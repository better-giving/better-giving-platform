import { EMAILS } from "@better-giving/brand";
import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { base_url } from "#/constants/env";
import { Footer } from "./footer";

const stb = (variant: "full" | "minimal" | "app") =>
  createRoutesStub([
    {
      path: "/",
      Component: () => <Footer variant={variant} />,
      HydrateFallback: () => null,
    },
  ]);

describe("footer donate link", () => {
  test("full variant links to the Better Giving donate page", async () => {
    const Stub = stb("full");
    const screen = await render(<Stub />);

    const link = screen.getByRole("link", { name: /^donate$/i });
    await expect.element(link).toBeVisible();
    await expect.element(link).toHaveAttribute("href", "/donate/1");
  });

  test("minimal variant has no donate link", async () => {
    const Stub = stb("minimal");
    const screen = await render(<Stub />);

    // sanity: the minimal footer did render
    await expect
      .element(screen.getByRole("link", { name: /privacy policy/i }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /^donate$/i }))
      .not.toBeInTheDocument();
  });
});

describe("footer legal links", () => {
  test.each(["full", "minimal"] as const)(
    "%s variant links donor terms and nonprofit terms",
    async (variant) => {
      const Stub = stb(variant);
      const screen = await render(<Stub />);

      const donor = screen.getByRole("link", { name: /^donor terms$/i });
      await expect.element(donor).toBeVisible();
      await expect.element(donor).toHaveAttribute("href", "/terms-of-use");

      const nonprofit = screen.getByRole("link", {
        name: /^nonprofit terms$/i,
      });
      await expect.element(nonprofit).toBeVisible();
      await expect
        .element(nonprofit)
        .toHaveAttribute("href", `${base_url}/terms-of-use-npo/`);
    }
  );
});

describe("app footer", () => {
  test("is one line of legal links and a support mailto, with no socials", async () => {
    const Stub = stb("app");
    const screen = await render(<Stub />);

    const support = screen.getByRole("link", { name: /^contact support$/i });
    await expect.element(support).toBeVisible();
    await expect
      .element(support)
      .toHaveAttribute("href", `mailto:${EMAILS.support}`);

    await expect
      .element(screen.getByRole("link", { name: /^privacy policy$/i }))
      .toHaveAttribute("href", "/privacy-policy");
    await expect
      .element(screen.getByRole("link", { name: /^donor terms$/i }))
      .toHaveAttribute("href", "/terms-of-use");
    await expect
      .element(screen.getByRole("link", { name: /^nonprofit terms$/i }))
      .toHaveAttribute("href", `${base_url}/terms-of-use-npo/`);

    for (const name of ["LinkedIn", "Facebook", "X", "YouTube", "Instagram"]) {
      await expect
        .element(screen.getByRole("link", { name, exact: true }))
        .not.toBeInTheDocument();
    }
    await expect
      .element(screen.getByRole("img", { name: /better giving/i }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link").elements()).toHaveLength(4);
  });
});

describe("footer landscape", () => {
  test("full variant draws it as decoration only", async () => {
    const Stub = stb("full");
    const screen = await render(<Stub />);

    const art = screen.container.querySelector("footer > svg");
    expect(art).not.toBeNull();
    expect(art?.getAttribute("aria-hidden")).toBe("true");
  });

  test.each(["minimal", "app"] as const)(
    "%s variant has none",
    async (variant) => {
      const Stub = stb(variant);
      const screen = await render(<Stub />);

      await expect.element(screen.getByRole("contentinfo")).toBeVisible();
      expect(screen.container.querySelector("footer svg")).toBeNull();
    }
  );
});
