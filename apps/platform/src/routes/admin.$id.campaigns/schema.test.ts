import { safeParse } from "valibot";
import { describe, expect, it } from "vitest";
import { form_schema } from "./form-schema";
import { campaign_body } from "./schema";

const LINK = "Enter the end of the link. Use letters, numbers, and - . _ ~.";

describe("campaign field messages", () => {
  it("asks for a name, a link, and a story", () => {
    const server = safeParse(campaign_body, {
      name: "",
      slug: "",
      description_pt: "",
      donate_methods: ["stripe"],
      donate_frequencies: ["one-time"],
      target: "0",
    });
    const messages = server.issues?.map((issue) => issue.message) ?? [];
    expect(messages).toContain("Enter a name.");
    expect(messages).toContain(LINK);
    expect(messages).toContain("Enter a story.");

    const client = safeParse(form_schema, {
      name: " ",
      slug: "",
      description: { value: "" },
      banner: "",
      logo: "",
      videos: [],
      target: { type: "none" },
      increments: [],
      donate_methods: [{ id: "stripe", name: "Card", disabled: false }],
      freqs: [true, false, false, false],
      hide_bg_tip: false,
      program_id: "",
      campaign_type: "",
    });
    const client_messages = client.issues?.map((issue) => issue.message) ?? [];
    expect(client_messages).toContain("Enter a name.");
    expect(client_messages).toContain(LINK);
    expect(client_messages).toContain("Enter a story.");
  });

  it("asks for an https link when a banner is not a url", () => {
    const server = safeParse(campaign_body, {
      name: "Winter",
      slug: "winter",
      description_pt: "A story",
      banner: "not a link",
      donate_methods: ["stripe"],
      donate_frequencies: ["one-time"],
      target: "0",
    });
    const banner = server.issues?.find((issue) =>
      issue.path?.some((step) => step.key === "banner")
    );
    expect(banner?.message).toBe("Enter a valid https link.");
  });
});

describe("campaign story length", () => {
  const story = (n: number) =>
    JSON.stringify([
      {
        _type: "block",
        _key: "k",
        style: "normal",
        markDefs: [],
        children: [
          { _type: "span", _key: "s", text: "a".repeat(n), marks: [] },
        ],
      },
    ]);
  const body = (description_pt: string) => ({
    name: "Winter",
    slug: "winter",
    description_pt,
    donate_methods: ["stripe"],
    donate_frequencies: ["one-time"],
    target: "0",
  });

  it("refuses a story past 8000 characters on a direct request", () => {
    const r = safeParse(campaign_body, body(story(8001)));
    expect(r.issues?.map((i) => i.message)).toContain(
      "max length is 8000 chars"
    );
  });

  it("accepts a story at the cap", () => {
    expect(safeParse(campaign_body, body(story(8000))).success).toBe(true);
  });
});
