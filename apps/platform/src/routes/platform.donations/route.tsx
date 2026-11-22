import { Badge, EmptyRow, LoadMoreRow } from "@better-giving/ui";
import { format } from "date-fns";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigation,
  useSearchParams,
} from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { Money } from "#/components/money";
import { metas } from "#/helpers/seo";
import { use_table } from "#/hooks/use-table";
import type { IPaginator } from "#/types/components";
import { via_name } from "@/donations/helpers";
import type { Route } from "./+types/route";
import type { PaymentRow } from "./api";
import {
  is_default_filter,
  method_param,
  parse_method,
  parse_status,
  status_param,
} from "./filter/constants";
import { Filters, type ISel, useHeaderFilters } from "./filter/filters";
import { donation_tag } from "./filter/tag";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta: Route.MetaFunction = () => metas({ title: "Donations" });

export default CacheRoute(Page);
function Page({ loaderData: page1 }: Route.ComponentProps) {
  const [committed, set_params] = useSearchParams();
  const { state, location } = useNavigation();
  const here = useLocation();
  // a tick starts a navigation that lands when the loader is done. the lists
  // stay open meanwhile, so the next tick must build on this one, not on the
  // url that is still on screen: read the pending search while one is in flight
  const params =
    state !== "idle" && location?.pathname === here.pathname
      ? new URLSearchParams(location.search)
      : committed;
  const status = parse_status(params.get("status"));
  const method = parse_method(params.get("method"));
  const off_default = !is_default_filter(status, method);

  // the key resets paging when page 1 changes: the filters, and the first
  // page itself, so a refund that shifts the rows also starts over
  const { next } = page1 as { next?: string };
  const filter_key = [
    status_param(parse_status(committed.get("status"))),
    method_param(parse_method(committed.get("method"))),
    next,
    page1.items.length,
    (page1.items[0] as PaymentRow | undefined)?.id,
  ].join(":");

  const { node, loading } = use_table<PaymentRow>({
    table: (props) => <Table {...props} />,
    page1,
    filter_key,
    gen_loader: (load, next) => () => {
      const copy = new URLSearchParams(params);
      if (next) copy.set("cursor", next);
      load(`?${copy.toString()}`);
    },
  });

  // each change applies at once: defaults stay out of the url, the cursor
  // belongs to the old filter, and replace keeps Back free of filter steps
  const on_change = (next: ISel) => {
    const p = new URLSearchParams(params);
    p.delete("cursor");
    for (const [k, v] of [
      ["status", status_param(next.status)],
      ["method", method_param(next.method)],
    ] as const) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    set_params(p, { replace: true, preventScrollReset: true });
  };

  return (
    <div className="px-4 py-4 md:px-10 md:py-8 w-full grid content-start">
      <h1 className="sr-only">Donations</h1>
      <Filters
        status={status}
        method={method}
        loading={loading}
        off_default={off_default}
        on_change={on_change}
      >
        <div className="table-scroll">{node}</div>
      </Filters>

      <Outlet />
    </div>
  );
}

/**
 * every stamp on the donation's match event, in lifecycle order.
 *
 * the stamps are read-only. nothing about a match is ours to approve — no
 * employer is resolved, no programme is known, and the sends are claimed by the
 * handlers themselves — so a button beside one would only re-drive work that is
 * already at-most-once by construction.
 *
 * the void is the one action, and it is a different kind: it records a fact the
 * app cannot observe. only the stripe refund seam voids an event on its own; a
 * crypto, paypal or chariot refund happens entirely at the processor and no code
 * path ever learns of it, so without this the chase and the pack keep treating a
 * gift the donor already got back as matchable.
 *
 * this is also the only reader `send_failed_kind` has: a mail the provider
 * refused is otherwise recorded and invisible, answerable only by hand-written
 * sql.
 */
function Match({ payment: c }: { payment: PaymentRow }) {
  const { search } = useLocation();
  const stamps = [
    ["pack", c.match_pack_sent_at],
    ["chased", c.match_chased_at],
    ["filed", c.match_submitted_at],
  ] as const;
  const reached = stamps.filter(([, at]) => at);

  return (
    <div className="flex flex-col items-start gap-0.5 min-w-32">
      <span
        className="text-xs font-medium truncate max-w-40"
        title={c.company_name ?? ""}
      >
        {/* donor-entered and never resolved — there is no employer row behind
            this string, so it is shown exactly as typed */}
        {c.company_name || <span className="text-gray-11">No employer</span>}
      </span>
      {reached.length > 0 && (
        <span className="text-xs text-gray-11">
          {reached
            .map(([label, at]) => `${label} ${format(new Date(at!), "MMM d")}`)
            .join(" · ")}
        </span>
      )}
      {c.match_voided_at && (
        <span className="text-xs text-gray-11">
          voided · {c.match_void_reason}
        </span>
      )}
      {c.match_send_failed_kind && (
        <span className="text-destructive-subtle-fg text-xs font-semibold">
          {c.match_send_failed_kind} mail refused
        </span>
      )}
      {c.match_event_id && !c.match_voided_at && (
        <NavLink
          to={{ pathname: `${c.donation_id}/void-match`, search }}
          aria-label={`Void match for donation from ${c.email ?? c.donation_id}`}
          preventScrollReset
          replace
          className="btn-secondary btn btn-sm"
        >
          Void
        </NavLink>
      )}
    </div>
  );
}

interface ITableProps extends IPaginator<PaymentRow> {
  empty_msg?: string;
}

function Table({
  items,
  load_next,
  loading,
  disabled,
  empty_msg = "No donations found",
}: ITableProps) {
  const filters = useHeaderFilters();
  return (
    <table className="table">
      <thead>
        <tr className="whitespace-nowrap">
          <th>Date</th>
          <th>
            <span className="inline-flex items-center gap-1">
              Status
              {filters?.status}
            </span>
          </th>
          <th>Email</th>
          <th>NPO</th>
          <th>Amount</th>
          <th>
            <span className="inline-flex items-center gap-1">
              Method
              {filters?.method}
            </span>
          </th>
          <th>Tip</th>
          <th>Fee cover</th>
          <th>Fee</th>
          <th>Match</th>
          <th className="md:sticky md:right-0 md:bg-panel" />
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <EmptyRow col_span={11}>{empty_msg}</EmptyRow>
        ) : (
          items.map((p) => <Row key={p.donation_id} payment={p} />)
        )}
      </tbody>
      {load_next && (
        <LoadMoreRow
          col_span={11}
          disabled={disabled}
          loading={loading}
          on_load_next={load_next}
        />
      )}
    </table>
  );
}

function Row({ payment: c }: { payment: PaymentRow }) {
  // the modal routes hand the filters back on close, so they ride the link
  const { search } = useLocation();
  // the method half of the via ("Card" for "stripe:card"); one with no method
  // names its processor. a crypto via keeps its network, which via_name drops
  const method = c.via.startsWith("crypto:") ? c.via : via_name(c.via);
  const can_refund = c.status === "settled" && c.via.startsWith("stripe:");
  const tag = donation_tag(c.status, c.via);
  return (
    <tr className="text-sm">
      <td className="whitespace-nowrap">
        {format(new Date(c.created_at), "MMM d, yyyy")}
      </td>
      <td>
        <Badge variant={tag.variant}>{tag.label}</Badge>
      </td>
      <td className="truncate max-w-40" title={c.email ?? ""}>
        {c.email ?? "—"}
      </td>
      <td className="truncate max-w-40" title={c.npo_name ?? ""}>
        {c.npo_name ?? "—"}
      </td>
      <td className="font-medium whitespace-nowrap">
        <Money amount={c.amount_base} currency={c.currency} />
      </td>
      <td className="whitespace-nowrap">{method}</td>
      <td className="whitespace-nowrap">
        {c.amount_tip ? (
          <Money amount={c.amount_tip} currency={c.currency} />
        ) : (
          "—"
        )}
      </td>
      <td className="whitespace-nowrap">
        {c.amount_fee_allowance ? (
          <Money amount={c.amount_fee_allowance} currency={c.currency} />
        ) : (
          "—"
        )}
      </td>
      <td className="whitespace-nowrap">
        {c.sttl_fee ? (
          <Money amount={c.sttl_fee} currency={c.sttl_currency ?? "USD"} />
        ) : (
          "—"
        )}
      </td>
      <td>
        <Match payment={c} />
      </td>
      <td className="md:sticky md:right-0 md:bg-card">
        {can_refund ? (
          <NavLink
            to={{ pathname: `${c.donation_id}/refund`, search }}
            preventScrollReset
            replace
            aria-label={`Refund donation from ${c.email ?? c.donation_id}`}
            className="btn-secondary btn btn-sm"
          >
            Refund
          </NavLink>
        ) : (
          <span className="text-gray-11 text-xs">N/A</span>
        )}
      </td>
    </tr>
  );
}
