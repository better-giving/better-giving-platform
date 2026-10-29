import { describe, expect, test } from "vitest";
import { GUIDE, MCP_PROTOCOL_VERSION, tools } from "./agents/tools";
import { loader } from "./agents.skill[.md]";

const get = (url: string) =>
  loader({
    request: new Request(url),
    params: {},
    context: {},
  } as never) as Response;

describe("/agents/skill.md", () => {
  test("serves the guide, every tool, and the endpoint at the request origin", async () => {
    const res = await get("https://preview.better.giving/agents/skill.md");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const text = await res.text();
    expect(text.startsWith(GUIDE)).toBe(true);
    for (const tool of tools) {
      expect(text).toContain(`### \`${tool.name}\``);
      expect(text).toContain(tool.description);
    }
    expect(text).toContain("https://preview.better.giving/agents/mcp");
    expect(text).toContain(MCP_PROTOCOL_VERSION);
  });

  test("lists each argument with its type and whether it is required", async () => {
    const text = await (
      await get("https://better.giving/agents/skill.md")
    ).text();

    expect(text).toContain("- `amount` (required): number, minimum 2");
    expect(text).toContain('- `currency`: "USD"');
    expect(text).toContain('- `tip_percent`: "none" | "10" | "15" | "20"');
    expect(text).toContain(
      "- `recipient_id` (required): integer, minimum 1 | string (uuid)\n"
    );
    expect(text).toContain("- `program_id`: string (uuid)\n");
    expect(text).toContain("- `donation_id` (required): string (uuid)\n");
    expect(text).toContain("  - `email` (required): string (email)");
    expect(text).toContain("Requires at least one of `query`, `ein`.");
  });
});
