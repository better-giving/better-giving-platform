import { Tabs } from "@ark-ui/react/tabs";
import { Image, Label } from "@better-giving/ui";
import {
  Building2,
  ChartSpline,
  Coins,
  CreditCard,
  Landmark,
} from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";
import dafPayLogo from "#/assets/icons/dafpay.svg";
import type { DonateMethodId } from "@/npo";
import { all_method_ids } from "../common/constants";
import type { TDonation, TMethodState } from "../types";
import { Form as Crypto } from "./crypto";
import { Form as Daf } from "./daf";
import { Form as IraQcd } from "./ira-qcd";
import { Form as Stocks } from "./stocks";
import { Form as Stripe } from "./stripe";
import { Form as StripeBank } from "./stripe-bank";

const methods: {
  [K in DonateMethodId]: {
    name: string;
    icon: ReactNode;
    panel: (props: TMethodState<K>) => React.JSX.Element;
  };
} = {
  stripe: {
    name: "Card",
    icon: <CreditCard className="icon-lg shrink-0" />,
    panel: Stripe,
  },
  stripe_bank: {
    name: "Bank Transfer",
    icon: <Landmark className="icon-lg shrink-0" />,
    panel: StripeBank,
  },
  stocks: {
    name: "Stocks",
    icon: <ChartSpline className="icon-lg shrink-0" />,
    panel: Stocks,
  },
  daf: {
    name: "Donor Advised Fund",
    icon: <Image src={dafPayLogo} className="shrink-0 h-4" />,
    panel: Daf,
  },
  ira_qcd: {
    name: "IRA / QCD",
    icon: <Building2 className="icon-lg shrink-0" />,
    panel: IraQcd,
  },
  crypto: {
    name: "Crypto",
    icon: <Coins className="shrink-0 icon-xl" />,
    panel: Crypto,
  },
};

const tab_classes =
  "outline outline-(--form-secondary) @xl/steps:not-focus-visible:outline-0 text-gray-11 data-selected:bg-(--form-secondary) data-selected:text-gray-12 flex items-center gap-2 p-2 @xl/steps:px-3 @xl/steps:py-5 @xl/steps:grid @xl/steps:grid-cols-subgrid @xl/steps:col-span-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 @xl/steps:w-full rounded @xl/steps:rounded-none";

export function DonateMethods(props: TDonation) {
  const { config, method, ...fvs } = props;
  const { method_ids: tabs = all_method_ids } = config || {};
  const tab_idx_found = tabs.indexOf(method);

  if (tabs.length === 1) {
    const Panel = methods[method].panel;
    const s: TMethodState<typeof method> = fvs[method] || {
      type: method,
      step: "form",
    };
    return (
      <div
        className={
          props.pin
            ? "flex min-h-full flex-1 flex-col"
            : "grid p-4 @xl/steps:p-8"
        }
      >
        <Panel {...(s as any)} />
      </div>
    );
  }

  return (
    <Tabs.Root
      data-testid="donate-methods"
      className={
        props.pin
          ? "flex min-h-full flex-1 flex-col"
          : "grid @xl/steps:grid-cols-[auto_1fr]"
      }
      defaultValue={tabs[tab_idx_found === -1 ? 0 : tab_idx_found]}
      lazyMount
      unmountOnExit
    >
      <Label
        className={
          props.pin
            ? "px-5 sm:px-6 pt-4 pb-0 col-span-full font-bold"
            : "p-4 pb-0 col-span-full @xl/steps:hidden font-bold"
        }
      >
        Payment method
      </Label>
      <Tabs.List
        className={
          props.pin
            ? "grid @md/steps:grid-cols-2 gap-2 px-5 sm:px-6 py-4 content-start"
            : "grid @md/steps:grid-cols-2 gap-2 @xl/steps:gap-0 p-4 @xl/steps:p-0 @xl/steps:grid-cols-[auto_1fr] @2xl/steps:min-w-48 content-start @xl/steps:divide-y @xl/steps:divide-hairline @xl/steps:border-r @xl/steps:border-hairline"
        }
      >
        {tabs.map((tab) => (
          <Tabs.Trigger key={tab} value={tab} className={tab_classes}>
            {methods[tab].icon}
            <span className="text-left text-sm">
              {methods[tab].name}
              {tab === "stripe_bank" && (
                <span className="block text-xs leading-none font-medium text-primary">
                  Lowest fee
                </span>
              )}
            </span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <div
        className={
          props.pin
            ? "flex min-h-0 flex-1 flex-col"
            : "grid p-4 @xl/steps:p-8 pt-0 @xl/steps:pt-4"
        }
      >
        {tabs.map((tab) => {
          const Panel = methods[tab].panel;
          const s: TMethodState<typeof tab> = fvs[tab] || {
            type: tab,
            step: "form",
          };
          return (
            <Tabs.Content key={tab} value={tab}>
              <Panel {...(s as any)} />
            </Tabs.Content>
          );
        })}
      </div>
    </Tabs.Root>
  );
}
