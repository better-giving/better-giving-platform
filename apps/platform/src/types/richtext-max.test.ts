import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { form_schema } from "#/routes/admin.$id.campaigns/form-schema";
import { richtext_content } from "./components";

const story = (n: number) =>
  JSON.stringify([
    {
      _type: "block",
      _key: "k",
      style: "normal",
      markDefs: [],
      children: [{ _type: "span", _key: "s", text: "a".repeat(n), marks: [] }],
    },
  ]);

const msg = "max length is 8000 chars";
const field = richtext_content({ maxChars: 8000, required: true });

describe("a story saved without a length", () => {
  test("within the cap passes", () => {
    expect(v.safeParse(field, { value: story(8000) }).success).toBe(true);
  });

  test("past the cap is refused, on the length field", () => {
    const r = v.safeParse(field, { value: story(8001) });
    expect(r.success).toBe(false);
    expect(r.issues?.[0].message).toBe(msg);
    expect(r.issues?.[0].path?.map((p) => p.key)).toEqual(["length"]);
  });

  test("a stored length is the count when there is one", () => {
    expect(v.safeParse(field, { value: story(10), length: 8001 }).success).toBe(
      false
    );
    expect(v.safeParse(field, { value: story(10), length: 10 }).success).toBe(
      true
    );
  });
});

describe("the admin campaign story", () => {
  const description_schema = v.pick(form_schema, ["description"]);

  test("a long story without a length is refused at 8000", () => {
    const r = v.safeParse(description_schema, {
      description: { value: story(8001) },
    });
    expect(r.issues?.[0].message).toBe(msg);
  });

  test("a story at the cap without a length passes", () => {
    const r = v.safeParse(description_schema, {
      description: { value: story(8000) },
    });
    expect(r.success).toBe(true);
  });
});
