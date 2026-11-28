import { AskHost } from "@better-giving/ui";
import type { ReactNode } from "react";
import { createRoutesStub } from "react-router";
import type { DafDonationDetails } from "#/components/donation/types";

export const fv: DafDonationDetails = {
  amount: "100",
  tip: "",
  tip_format: "none",
  cover_processing_fee: false,
};

/** what chariot hands back on CHARIOT_SUCCESS — a grant that has already been
 * recommended, in cents, with the donor's details off their daf account. */
export const success_detail = {
  workflowSessionId: "ws_1",
  grantIntent: {
    amount: 10_000,
    metadata: {
      don_id: "11111111-1111-4111-8111-111111111111",
      amount: { base: 100, tip: 0, fee_allowance: 0 },
    },
  },
  user: {
    firstName: "John",
    lastName: "Doe",
    email: "john@doe.com",
    address: {
      line1: "1 Main St",
      line2: "",
      city: "Springfield",
      state: "IL",
      postalCode: "62701",
    },
  },
};

// the checkout's prompts are raised through `ask`, which mounts at `AskHost`
export const stb = (node: ReactNode) =>
  createRoutesStub([
    {
      path: "/",
      Component: () => (
        <>
          {node}
          <AskHost />
        </>
      ),
      HydrateFallback: () => null,
    },
  ]);
