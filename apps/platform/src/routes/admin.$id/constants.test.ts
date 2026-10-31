import { HandshakeIcon, MegaphoneIcon } from "lucide-react";
import { describe, expect, it } from "vitest";
import { linkGroups as page_link_groups } from "#/pages/admin/constants";
import { routes } from "#/pages/admin/routes";
import { linkGroups } from "./constants";

function link(title: string) {
  return linkGroups
    .flatMap((group) => group.links)
    .find((item) => item.title === title);
}

describe("admin sidebar", () => {
  it("keeps Campaigns clickable under a campaign route and leaves the other ends", () => {
    const titles = linkGroups
      .flatMap((group) => group.links)
      .filter((item) => item.end)
      .map((item) => item.title);
    // membership, not sidebar order — a reorder is not an exact-match change
    expect(new Set(titles)).toEqual(new Set(["Dashboard", "Campaigns"]));
    expect(link("Campaigns")?.icon.fn).toBe(MegaphoneIcon);
  });

  it("drops supporter fundraisers and keeps campaigns and referrals", () => {
    expect(link("Supporter fundraisers")).toBeUndefined();
    expect(link("Fundraiser opt-outs")).toBeUndefined();
    expect(link("Campaign opt-outs")).toBeUndefined();
    expect(link("Campaigns")?.to).toBe(routes.campaigns);
    expect(link("Referrals")?.to).toBe(routes.referrals);
    expect(link("Referrals")?.icon.fn).toBe(HandshakeIcon);
  });

  it("has no Public Profile group or Media; Manage opens with Organization, Programs", () => {
    expect(linkGroups.map((g) => g.title)).not.toContain("Public Profile");
    expect(link("Edit profile")).toBeUndefined();
    const manage = linkGroups.find((g) => g.title === "Manage");
    expect(manage?.links.slice(0, 2).map((l) => l.title)).toEqual([
      "Organization",
      "Programs",
    ]);
    expect(link("Programs")?.to).toBe(routes.programs);
    // videos live in Organization's Better Giving Page group
    expect(link("Media")).toBeUndefined();
    expect(Object.values(routes)).not.toContain("media");
    expect(Object.keys(routes)).not.toContain("media");
    // the page-level sidebar (src/pages/admin) carries no Media link either
    const page_titles = page_link_groups.flatMap((g) =>
      g.links.map((l) => l.title)
    );
    expect(page_titles).not.toContain("Media");
    expect(page_titles).toContain("Programs");
    expect(
      page_link_groups.flatMap((g) => g.links.map((l) => l.to))
    ).not.toContain("media");
  });
});
