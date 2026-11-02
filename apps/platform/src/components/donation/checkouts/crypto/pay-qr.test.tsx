import type { IToken } from "@better-giving/crypto";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { PayQr } from "./pay-qr";

const xrp: IToken = {
  id: "22",
  code: "XRP",
  name: "Ripple",
  symbol: "XRP",
  precision: 8,
  logo: "/images/coins/xrp.svg",
  network: "xrp",
  color: "#fa6800",
  cg_id: "ripple",
};

const xlm: IToken = {
  id: "28",
  code: "XLM",
  name: "Stellar",
  symbol: "XLM",
  precision: 7,
  logo: "/images/coins/xlm.svg",
  network: "xlm",
  color: "#000",
  cg_id: "stellar",
};

const recipient = "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh";
const warning = (label: string) =>
  `Include this ${label} with your transfer. Without it we can't credit your donation.`;

describe("PayQr", () => {
  test("an XRP transfer warns that its destination tag is required, and copies it by that name", async () => {
    const screen = await render(
      <PayQr token={xrp} recipient={recipient} extraId="123456" />
    );

    await expect
      .element(screen.getByText(warning("destination tag")))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("button", {
          name: "Copy Destination tag",
          exact: true,
        })
      )
      .toBeVisible();
    // the bare number is meaningless read out alone
    await expect
      .element(screen.getByText("Destination tag: 123456", { exact: true }))
      .toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy Memo", exact: true }).query()
    ).toBeNull();
  });

  test("any other coin with an extra id warns that its memo is required, and copies it by that name", async () => {
    const screen = await render(
      <PayQr token={xlm} recipient={recipient} extraId="884213" />
    );

    await expect.element(screen.getByText(warning("memo"))).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Copy Memo", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Memo: 884213", { exact: true }))
      .toBeInTheDocument();
  });

  test("no extra id: no warning and no memo copier", async () => {
    const screen = await render(
      <PayQr token={xlm} recipient={recipient} extraId={null} />
    );

    await expect
      .element(screen.getByRole("button", { name: "Copy address" }))
      .toBeVisible();
    expect(screen.getByText("Include this").query()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy Memo" }).query()
    ).toBeNull();
  });
});
