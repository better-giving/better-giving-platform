import { expect, test } from "vitest";
import { asset_origin } from "./asset-origin";

test("a real origin base yields its origin", () => {
  expect(asset_origin("https://assets.better.giving/")).toBe(
    "https://assets.better.giving"
  );
});

test("a same-origin base yields nothing", () => {
  expect(asset_origin("/")).toBeNull();
});
