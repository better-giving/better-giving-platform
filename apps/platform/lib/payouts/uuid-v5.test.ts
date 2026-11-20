import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { sha1, uuid_v5 } from "./uuid-v5";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("sha1", () => {
  test("matches node's digest across the padding boundaries", () => {
    for (const n of [0, 1, 54, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const msg = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
      expect(hex(sha1(msg))).toBe(createHash("sha1").update(msg).digest("hex"));
    }
  });
});

describe("uuid_v5", () => {
  // computed with the `node:crypto` implementation this replaced: a ref
  // already stored on a claimed row must still be the one a retry derives
  test.each([
    ["", "af43fa74-d069-5b15-8900-71a4426edf6f"],
    ["abc", "56842b05-351b-5cf5-b136-bfe658d114eb"],
    [
      JSON.stringify(["manual_wire", "Mercury", "tx-1"]),
      "8e7bae46-2fca-595c-89b2-db505269849c",
    ],
    ["héllo wörld €".repeat(9), "17b76ca8-c081-5b26-ad20-0e9948dcad19"],
  ])("%j is unchanged", (name, expected) => {
    expect(uuid_v5(name)).toBe(expected);
  });
});
