import { ArrowLeft, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { ISub } from "@/subscriptions";
import type { Route } from "./+types/route";
import { since_label, sub_color } from "./helpers";
import { Stewardship } from "./stewardship";
import { GiftsTable } from "./table";

export { ErrorBoundary } from "#/components/error";
export { loader } from "./api";

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  admin_page_meta(loaderData?.name || loaderData?.email || "Donor", matches);

export default function Page({
  loaderData: { name, email, since, subs, dists, pend_month, pend_year },
}: Route.ComponentProps) {
  const { id: npo_id } = useParams();
  const location = useLocation();
  const from =
    (location.state as { from?: "donors" | "subscribers" } | null)?.from ??
    "donors";
  const back_label = from === "subscribers" ? "Subscribers" : "Donors";
  const back_to =
    from === "subscribers"
      ? `/admin/${npo_id}/donors/subscribers`
      : `/admin/${npo_id}/donors`;

  const sub_index = Object.fromEntries(subs.map((s, i) => [s.id, i]));
  const settled = dists.filter((d) => d.status === "settled");
  const lifetime_count = settled.length;
  const lifetime_usd = settled.reduce((a, d) => a + (d.amount_usd ?? 0), 0);
  const active_subs = subs.filter((s) => s.status === "active");
  const inactive_count = subs.filter((s) => s.status === "inactive").length;
  const has_subs = active_subs.length > 0 || inactive_count > 0;

  return (
    <div className="px-6 py-4 md:px-10 md:py-8">
      <Link
        to={back_to}
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium link"
      >
        <ArrowLeft className="icon-md" />
        {back_label}
      </Link>

      <h1 className="text-4xl font-bold leading-tight tracking-tight">
        {name ?? email}
      </h1>
      {name && <p className="mt-1.5 text-base text-gray-11">{email}</p>}

      <Section heading="Lifetime">
        <div className="flex flex-wrap items-baseline gap-x-14 gap-y-2">
          <Stat
            value={lifetime_count.toLocaleString("en-US")}
            label="donations"
          />
          <Stat
            value={`$${lifetime_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            label="total"
          />
        </div>
        <p className="mt-2 text-xs text-gray-11">since {since_label(since)}</p>
      </Section>

      {has_subs && (
        <Section
          heading={
            active_subs.length === 0
              ? `Subscriptions (${inactive_count} inactive)`
              : "Subscriptions"
          }
        >
          <SubscriptionPills
            subs={subs}
            sub_index={sub_index}
            inactive_count={inactive_count}
            no_active={active_subs.length === 0}
          />
          {active_subs.length > 0 && (
            <>
              <div className="mt-6">
                <Stewardship subs={subs} dists={dists} />
              </div>
              {(pend_month > 0 || pend_year > 0) && (
                <div className="mt-4 flex flex-wrap items-baseline justify-end gap-x-10 gap-y-2">
                  <Stat
                    value={`$${pend_month.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                    label="pending this month"
                    size="sm"
                  />
                  <Stat
                    value={`$${pend_year.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                    label="pending this year"
                    size="sm"
                  />
                </div>
              )}
            </>
          )}
        </Section>
      )}

      <div className="mt-14">
        <GiftsTable dists={dists} subs={subs} />
      </div>
    </div>
  );
}

interface ISectionProps {
  heading: string;
  children: React.ReactNode;
}

function Section({ heading, children }: ISectionProps) {
  return (
    <section className="mt-8 border-t border-hairline pt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-11">
        {heading}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

interface IStatProps {
  value: string;
  label: string;
  size?: "lg" | "sm";
}

function Stat({ value, label, size = "lg" }: IStatProps) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span
        className={`font-bold leading-none tracking-tight figures ${size === "lg" ? "text-3xl" : "text-xl"}`}
      >
        {value}
      </span>
      <span className="text-sm text-gray-11">{label}</span>
    </span>
  );
}

interface IPillsProps {
  subs: ISub[];
  sub_index: Record<string, number>;
  inactive_count: number;
  no_active: boolean;
}

function SubscriptionPills({
  subs,
  sub_index,
  inactive_count,
  no_active,
}: IPillsProps) {
  const [show_inactive, set_show_inactive] = useState(no_active);
  const active = subs.filter((s) => s.status === "active");
  const inactive = subs.filter((s) => s.status === "inactive");
  const shown = show_inactive ? [...active, ...inactive] : active;

  return (
    <ul className="flex flex-wrap gap-2">
      {shown.map((s) => {
        const idx = sub_index[s.id] ?? 0;
        const cancelled = s.status === "inactive";
        const amount = s.amount_usd;
        const freq_label =
          s.interval_count === 1
            ? `per ${s.interval}`
            : `per ${s.interval_count} ${s.interval}s`;
        return (
          <li
            key={s.id}
            title={cancelled ? "cancelled" : undefined}
            className={`inline-flex items-center gap-1.5 rounded border bg-panel px-2.5 py-1 text-xs ${
              cancelled ? "border-dashed border-gray-6" : "border-gray-6"
            }`}
          >
            <RefreshCw className="icon-xs" style={{ color: sub_color(idx) }} />
            <span className="font-semibold">
              ${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
            <span className="text-gray-11">{freq_label}</span>
          </li>
        );
      })}
      {inactive_count > 0 && !no_active && (
        <li>
          <button
            type="button"
            onClick={() => set_show_inactive((v) => !v)}
            className="inline-flex items-center rounded border border-dashed border-gray-6 px-2.5 py-1 text-xs text-gray-11 hover:text-gray-12"
          >
            {show_inactive
              ? `hide ${inactive_count} inactive`
              : `+ ${inactive_count} inactive`}
          </button>
        </li>
      )}
    </ul>
  );
}
