import { Collapsible } from "@ark-ui/react/collapsible";
import { DrawerIcon, ExtLink } from "@better-giving/ui";
import {
  BrainIcon,
  CheckIcon,
  LightbulbIcon as LightBulbIcon,
  LinkIcon,
  MessageCircleQuestionIcon as QuestionMarkCircleIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { href, Link } from "react-router";
import { app_name } from "#/constants/env";
import { referrals_hub } from "#/constants/urls";

export function Explainer({ classes = "" }) {
  const [open, set_open] = useState(false);

  useEffect(() => {
    const sync = () => set_open(window.innerWidth >= 768);

    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  return (
    <div className={`card w-full ${classes}`}>
      <Collapsible.Root open={open} onOpenChange={(e) => set_open(e.open)}>
        <div className="flex items-center gap-x-2 mb-1">
          <LightBulbIcon className="max-md:hidden text-primary shrink-0 icon-xl" />
          <h3 className="text-lg">About the {app_name} Referral Program</h3>
        </div>
        <p>
          You can earn rewards by helping nonprofits discover {app_name}. When a
          nonprofit signs up using your referral link or code, you'll earn 30%
          of the contributions made by donors to support {app_name} — for the
          next 3 years.
        </p>
        <Collapsible.Content className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
          <div className="flex items-start gap-3 mt-4 max-w-4xl">
            <BrainIcon className="icon-lg max-md:hidden text-primary shrink-0 mt-0.5" />
            <div>
              <p>
                {app_name} doesn't charge fees — instead, donors can choose to
                support our platform directly during checkout. These donor
                contributions average around 5% of each donation.
              </p>
              <p className="mt-2">
                So if a nonprofit receives $100,000 in online donations, donors
                typically contribute about $5,000 to {app_name} — and you'd earn
                $1,500 from that.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2 max-w-4xl">
            <div className="flex items-start gap-2">
              <CheckIcon className="icon-lg text-success shrink-0 mt-0.5" />
              <p>
                Open to all {app_name} users — including donors, nonprofit
                staff, consultants, and fundraising pros
              </p>
            </div>
            <div className="flex items-start gap-2">
              <CheckIcon className="icon-lg text-success shrink-0 mt-0.5" />
              <p>Share your unique referral link or code</p>
            </div>
            <div className="flex items-start gap-2">
              <CheckIcon className="icon-lg text-success shrink-0 mt-0.5" />
              <p>Track your referrals and payouts in this dashboard</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 mt-4">
            <Link
              target="_blank"
              to={href("/terms-of-use-referrals")}
              className="inline-flex items-center link text-sm font-medium"
            >
              <LinkIcon className="icon-md mr-1" />
              View Full Program Terms
            </Link>
            <ExtLink
              href={referrals_hub}
              className="inline-flex items-center link text-sm font-medium"
            >
              <QuestionMarkCircleIcon className="icon-md mr-1" />
              Referral FAQ
            </ExtLink>
          </div>
        </Collapsible.Content>

        <Collapsible.Trigger
          className={`flex items-center justify-center text-primary ${open ? "mt-4" : "mt-2"}`}
        >
          <span className="text-sm font-medium mr-1">
            {open ? "Show less" : "Read more"}
          </span>
          <DrawerIcon className="icon-lg" is_open={open} />
        </Collapsible.Trigger>
      </Collapsible.Root>
    </div>
  );
}
