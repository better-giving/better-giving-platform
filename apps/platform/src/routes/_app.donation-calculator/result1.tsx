import { Image } from "@better-giving/ui";
import { to_usd } from "@better-giving/ui/helpers";
import { Arrow, Content, Tooltip } from "@better-giving/ui/tooltip";
import { CircleHelpIcon, TrendingDown, TrendingUp } from "lucide-react";
import laira_coin from "#/assets/laira/laira-coin.webp";
import type { View } from "./types";
import { Usd } from "./usd";

interface Props extends View {
  classes?: string;
}

export function Result1({ classes = "", ...v }: Props) {
  return (
    <div className={`${classes} @container p-6`}>
      <h3 className="text-lg sm:text-xl font-bold mb-4">
        Annual Impact Summary
      </h3>

      <div className="mb-6">
        <p className="text-gray-11">Current Online Donations</p>
        <p className="text-lg sm:text-xl font-bold">{to_usd(v.amount)}</p>
      </div>

      <div className="border-t border-hairline my-6" />

      <h3 className="text-lg sm:text-xl font-bold mb-4">
        Donation Processing Impact
      </h3>

      <div className="grid @md:grid-cols-2 @md:bg-panel rounded mb-6 divide-hairline divide-y @md:divide-x @md:divide-y-0">
        <div className="@md:p-5 pb-2">
          <p className="max-sm:text-sm text-gray-11 mb-2">
            Current Amount Received
          </p>
          <p className="text-lg sm:text-xl font-bold">
            <Usd relative={v.amount}>{v.ogNet}</Usd>{" "}
            <Usd parens classes="text-lg sm:text-xl">
              {-v.ogDeductions}
            </Usd>
          </p>
        </div>
        <div className="@md:p-5 pt-2">
          <p className="max-sm:text-sm text-gray-11 mb-2">With Better Giving</p>
          <p className="text-lg sm:text-xl font-bold">
            <Usd relative={v.ogNet}>{v.bgNet}</Usd>{" "}
            <Usd sign parens classes="text-lg sm:text-xl">
              {v.advantage}
            </Usd>
          </p>
        </div>
      </div>

      <h3 className="text-lg sm:text-xl font-bold mb-4 text-balance">
        Donation Processing Impact Details
      </h3>

      {/* the three rows are the additive terms of `advantage` (bg-view.ts): a
          positive figure is a gain in every one of them. the subscription is a
          cost the org stops paying under bg, not one it takes on. */}
      <div className="space-y-3 mb-6">
        <div className="flex gap-x-4 @max-md:flex-col justify-between @md:items-center">
          <p className="max-sm:text-sm">Fee Savings:</p>
          <Usd sign classes="font-semibold">
            {v.feeSavings}
          </Usd>
        </div>

        <div className="flex gap-x-4 @max-md:flex-col justify-between @md:items-center">
          <p className="max-sm:text-sm text-balance">
            Additional donations from expanded payment types:
            <Tooltip
              tip={
                <Content className="max-w-xs text-center text-xs">
                  Based on industry data, each payment type represents a portion
                  of potential donations: Credit Card (63%), Bank/ACH (10%),
                  Digital Wallets (7%), DAF (12%), Stocks (6%), Crypto (2%).
                  Better Giving enables all these payment methods. This assumes
                  that 50% of donors will choose not to donate if their
                  preferred payment type is unavailable
                  <Arrow />
                </Content>
              }
            >
              <CircleHelpIcon className="relative inline bottom-px ml-1 icon-sm" />
            </Tooltip>
          </p>

          <Usd sign classes="font-semibold">
            {v.ogMissedFromDonTypes}
          </Usd>
        </div>
        <div className="flex gap-x-4 @max-md:flex-col justify-between @md:items-center">
          <p className="max-sm:text-sm">Subscription cost eliminated:</p>
          <Usd sign classes="font-semibold">
            {v.ogSubsCost}
          </Usd>
        </div>
      </div>

      <div
        className={`${v.advantage > 0 ? "bg-success-subtle" : v.advantage < 0 ? "bg-destructive-subtle" : "bg-gray-3"} p-4 @md:p-6 rounded @md:flex items-center gap-4`}
      >
        {v.advantage > 0 ? (
          <TrendingUp className="size-8 sm:size-10 text-success" />
        ) : v.advantage < 0 ? (
          <TrendingDown className="size-8 sm:size-10 text-destructive" />
        ) : null}
        <div>
          <p className="sm:text-lg font-bold text-balance">
            Annual Donation Processing Impact
          </p>
          <Usd classes="text-lg font-bold">{v.advantage}</Usd>
        </div>
        {v.advantage > 0 && (
          <Image
            alt="laira holding coin"
            src={laira_coin}
            width={70}
            className="@max-md:hidden ml-auto"
          />
        )}
      </div>
      <p className="mt-6 text-sm text-gray-11">
        Illustrative example. Returns vary, and past performance isn't a
        guarantee. Rates are variable.
      </p>
    </div>
  );
}
