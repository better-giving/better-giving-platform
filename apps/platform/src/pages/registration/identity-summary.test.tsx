import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { IReg, TStatus } from "@/reg";
import { IdentitySummary } from "./identity-summary";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const summary = (status: TStatus) => {
  const reg = { id: RID, status, o_type: "501c3", o_ein: "123456789" };
  const Stub = createRoutesStub([
    {
      path: "/register/:reg_id/5",
      Component: () => <IdentitySummary reg={reg as IReg} />,
    },
  ]);
  return render(<Stub initialEntries={[`/register/${RID}/5`]} />);
};

describe("IdentitySummary", () => {
  // the rejection mail asks for the application to be put right and resubmitted
  test.each<TStatus>(["01", "04"])(
    "offers a %s application the identity form",
    async (status) => {
      const screen = await summary(status);

      await expect
        .element(screen.getByRole("link", { name: "Change" }))
        .toHaveAttribute("href", `/register/${RID}/identity`);
    }
  );

  test.each<TStatus>(["02", "03"])(
    "keeps a %s application's identity closed",
    async (status) => {
      const screen = await summary(status);

      await expect.element(screen.getByText("EIN 123456789")).toBeVisible();
      expect(screen.getByRole("link", { name: "Change" }).query()).toBeNull();
    }
  );
});
