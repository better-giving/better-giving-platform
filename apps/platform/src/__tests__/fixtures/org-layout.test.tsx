import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { npo, org_figures } from "./org-layout";

afterEach(cleanup);

const org = npo({ contributions_total: 3322, contributions_count: 49 });

async function figures(ui: React.ReactElement, o = org) {
  const screen = await render(ui);
  return org_figures(screen.container, o);
}

describe("org_figures reads every shape a page could show a figure in", () => {
  test("a page with none reports nothing", async () => {
    expect(
      await figures(
        <section>
          <h1>Riverside Literacy</h1>
          <p>Every adult a reader.</p>
        </section>
      )
    ).toEqual([]);
  });

  test("the raised total beside its label", async () => {
    expect(
      await figures(
        <p>
          <strong>$3,322</strong> raised
        </p>
      )
    ).toEqual(["$3,322", "raised"]);
  });

  test("a donor count, with and without the space a flex column drops", async () => {
    expect(
      await figures(
        <p>
          <strong>49</strong> donors
        </p>
      )
    ).toEqual(["49 donors"]);
    await cleanup();
    expect(
      await figures(
        <div className="flex flex-col">
          <strong>49</strong>
          <span>donors</span>
        </div>
      )
    ).toEqual(["49donors"]);
  });

  test("the other names a donor count goes by", async () => {
    expect(
      await figures(
        <p>
          <b>49</b> supporters
        </p>
      )
    ).toEqual(["49 supporters"]);
  });

  test("the total spelled without a dollar sign or abbreviated", async () => {
    expect(await figures(<p>3,322 given</p>)).toEqual(["3,322", "given"]);
    await cleanup();
    expect(await figures(<p>$3.3K funded</p>)).toEqual(["3.3K", "funded"]);
  });

  test("a goal bar with a role, and one without", async () => {
    expect(
      await figures(
        <div role="progressbar" aria-label="Goal progress" aria-valuenow={41} />
      )
    ).toEqual(["progressbar Goal progress"]);
    await cleanup();
    expect(
      await figures(
        <div className="bg-gray-3">
          <div className="bg-primary h-2" style={{ width: "41%" }} />
        </div>
      )
    ).toEqual(["bar"]);
  });

  test("a bar drawn as a native meter or progress element", async () => {
    expect(await figures(<meter value={41} max={100} />)).toEqual([
      "progressbar",
    ]);
    await cleanup();
    expect(await figures(<progress value={41} max={100} />)).toEqual([
      "progressbar",
    ]);
  });

  test("a goal line and the first-gift ask", async () => {
    expect(await figures(<p>of $8,000 goal</p>)).toEqual(["goal"]);
    await cleanup();
    expect(await figures(<p>Be the first to give</p>)).toEqual([
      "Be the first to give",
    ]);
  });

  test("a total of zero is not found in unrelated numbers", async () => {
    expect(
      await figures(
        <p>EIN 10-2003004 since 2020</p>,
        npo({ contributions_total: 0 })
      )
    ).toEqual([]);
  });
});
