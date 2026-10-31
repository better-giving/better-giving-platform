import { safeParse } from "valibot";
import { describe, expect, test } from "vitest";
import { schema } from "./schema";

const ID = "dQw4w9WgXcQ";
const REFUSED = "only YouTube links are supported";

const messages = (url: string) =>
  safeParse(schema, { url }).issues?.map((i) => i.message) ?? [];

describe("video link schema", () => {
  test.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?feature=share&v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=-WX60lgPXUWAXPCY`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://youtube-nocookie.com/embed/${ID}`,
  ])("accepts %s", (url) => {
    expect(messages(url)).toEqual([]);
  });

  test.each([
    `https://example.org/youtube.com/watch?v=${ID}`,
    `https://example.org/?next=https://youtu.be/${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://youtube.com.example.org/watch?v=${ID}`,
    `ftp://youtube.com/watch?v=${ID}`,
    "https://vimeo.com/123456",
    "https://www.youtube.com/watch?v=short",
  ])("refuses %s as not a YouTube link", (url) => {
    expect(messages(url)).toEqual([REFUSED]);
  });
});
