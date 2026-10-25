import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IOrgShape } from "@/org-shape";

const jev_choice = vi.hoisted(() => vi.fn());
vi.mock("./jev", () => ({ jev_choice }));

const { make_layout_picker } = await import("./org-layout");

/** short story, one row: the thresholds say poster */
const shape: IOrgShape = {
  story_chars: 120,
  tagline_chars: 40,
  name_chars: 18,
  has_banner: true,
  has_logo: false,
  campaigns: 1,
  supporters: 0,
  programs: 2,
  videos: 0,
};

describe("pick_layout", () => {
  let pick_layout: ReturnType<typeof make_layout_picker>;
  beforeEach(() => {
    jev_choice.mockReset();
    pick_layout = make_layout_picker();
  });

  it("takes Jev's layout over the thresholds", async () => {
    jev_choice.mockResolvedValueOnce("feature");

    expect(await pick_layout(shape)).toEqual({ layout: "feature", by: "jev" });
  });

  it("falls back to the thresholds when Jev has no answer", async () => {
    jev_choice.mockResolvedValueOnce(null);

    expect(await pick_layout(shape)).toEqual({
      layout: "poster",
      by: "threshold",
    });
  });

  it("takes card from Jev for an org with no story", async () => {
    jev_choice.mockResolvedValueOnce("card");
    const storyless = { ...shape, story_chars: 0 };

    expect(await pick_layout(storyless)).toEqual({ layout: "card", by: "jev" });
  });

  it("refuses card for an org with a story, which card has no room for, and keeps nothing", async () => {
    jev_choice.mockResolvedValueOnce("card").mockResolvedValueOnce("letter");

    expect(await pick_layout(shape)).toEqual({
      layout: "poster",
      by: "threshold",
    });
    expect(await pick_layout(shape)).toEqual({ layout: "letter", by: "jev" });
  });

  it("sends Jev the measures alone, asking for one of the five layouts", async () => {
    jev_choice.mockResolvedValueOnce(null);

    await pick_layout(shape);

    const [state, question] = jev_choice.mock.calls[0]!;
    expect(state).toEqual({ ...shape });
    expect(Object.keys(question.criteria).sort()).toEqual([
      "card",
      "feature",
      "hub",
      "letter",
      "poster",
    ]);
  });
});

describe("pick_layout memo", () => {
  beforeEach(() => jev_choice.mockReset());

  it("asks Jev once per shape, whatever its key order, and keeps the answer", async () => {
    const pick_layout = make_layout_picker();
    jev_choice.mockResolvedValueOnce("feature");

    const reordered = Object.fromEntries(
      Object.entries(shape).reverse()
    ) as unknown as IOrgShape;

    expect(await pick_layout(shape)).toEqual({ layout: "feature", by: "jev" });
    expect(await pick_layout(reordered)).toEqual({
      layout: "feature",
      by: "jev",
    });
    expect(jev_choice).toHaveBeenCalledOnce();
  });

  it("gives overlapping renders of one shape a single question and answer", async () => {
    const pick_layout = make_layout_picker();
    let answer!: (v: string) => void;
    jev_choice
      .mockReturnValueOnce(new Promise((r) => (answer = r)))
      .mockResolvedValueOnce("letter");

    const first = pick_layout(shape);
    const second = pick_layout(shape);
    answer("hub");

    expect(await first).toEqual({ layout: "hub", by: "jev" });
    expect(await second).toEqual({ layout: "hub", by: "jev" });
    expect(jev_choice).toHaveBeenCalledOnce();
  });

  it("keeps no fallback, so the next render asks Jev again", async () => {
    const pick_layout = make_layout_picker();
    jev_choice.mockResolvedValueOnce(null).mockResolvedValueOnce("hub");

    expect(await pick_layout(shape)).toEqual({
      layout: "poster",
      by: "threshold",
    });
    expect(await pick_layout(shape)).toEqual({ layout: "hub", by: "jev" });
    expect(await pick_layout(shape)).toEqual({ layout: "hub", by: "jev" });
    expect(jev_choice).toHaveBeenCalledTimes(2);
  });

  it("asks Jev again once a kept answer is past its ttl", async () => {
    let t = 0;
    const pick_layout = make_layout_picker({ ttl_ms: 1000, now: () => t });
    jev_choice.mockResolvedValueOnce("hub").mockResolvedValueOnce("letter");

    await pick_layout(shape);
    t = 999;
    expect((await pick_layout(shape)).layout).toBe("hub");
    t = 1000;
    expect((await pick_layout(shape)).layout).toBe("letter");
    expect(jev_choice).toHaveBeenCalledTimes(2);
  });

  it("keeps at most `max` shapes, dropping the oldest first", async () => {
    const pick_layout = make_layout_picker({ max: 2 });
    jev_choice.mockResolvedValue("hub");
    const sized = (programs: number) => ({ ...shape, programs });

    await pick_layout(sized(1));
    await pick_layout(sized(2));
    await pick_layout(sized(3));
    expect(jev_choice).toHaveBeenCalledTimes(3);

    // 2 and 3 are kept; 1 was dropped for 3
    await pick_layout(sized(2));
    await pick_layout(sized(3));
    expect(jev_choice).toHaveBeenCalledTimes(3);
    await pick_layout(sized(1));
    expect(jev_choice).toHaveBeenCalledTimes(4);
  });
});
