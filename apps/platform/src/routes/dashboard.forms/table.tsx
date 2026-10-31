import { Portal } from "@ark-ui/react/portal";
import { createListCollection, Select } from "@ark-ui/react/select";
import { EmptyRow, LoadMoreRow, popup_anim, Target } from "@better-giving/ui";
import { to_usd } from "@better-giving/ui/helpers";
import { ChevronDownIcon, TagIcon } from "lucide-react";
import { href, NavLink, useNavigate, useSearchParams } from "react-router";
import type { IPaginator } from "#/types/components";
import { toPP } from "@/helpers/date";
import type { IFormListed } from "$/pg/queries/form";

type Filter = "all" | "active" | "inactive";
const FILTER_OPTS: Filter[] = ["all", "active", "inactive"];
const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  active: "Active",
  inactive: "Inactive",
};
const FILTER_COLLECTION = createListCollection({
  items: FILTER_OPTS,
  itemToString: (v) => FILTER_LABEL[v],
});

interface Props extends IPaginator<IFormListed> {
  status: string;
}

export function FormsTable({
  items,
  load_next,
  loading,
  disabled,
  status,
  classes = "",
}: Props) {
  return (
    <div className={classes}>
      <div className="table-scroll">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Form</th>
              <th>
                <StatusFilter value={status as Filter} />
              </th>
              <th>Raised / Goal</th>
              <th className="text-right">Donations</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <EmptyRow col_span={6}>
                No {status === "all" ? "" : status} forms found
              </EmptyRow>
            ) : (
              items.map((f) => (
                <tr key={f.id}>
                  <Row {...f} />
                </tr>
              ))
            )}
          </tbody>
          {load_next && (
            <LoadMoreRow
              col_span={6}
              disabled={disabled}
              loading={loading}
              on_load_next={load_next}
            />
          )}
        </table>
      </div>
    </div>
  );
}

function Row(f: IFormListed) {
  const target = f.target_smart ? "smart" : (f.target_number ?? null);
  return (
    <>
      {/* form name + tag → links to edit */}
      <td>
        <NavLink
          to={href("/forms/:id/edit", { id: f.id })}
          className="font-medium link"
        >
          {f.name}
        </NavLink>
        {f.tag && (
          <p className="flex items-center gap-1 text-xs text-gray-11 mt-0.5">
            <TagIcon className="shrink-0 icon-xs" />
            {f.tag}
          </p>
        )}
      </td>

      {/* status */}
      <td>
        <StatusBadge status={f.status} />
      </td>

      {/* raised / goal */}
      <td>
        {target !== null ? (
          <Target.Inline target={target} progress={f.ltd ?? 0} />
        ) : (
          <span className="text-sm text-gray-11">{to_usd(f.ltd ?? 0)}</span>
        )}
      </td>

      {/* donation count */}
      <td className="text-right figures">
        {f.donation_count.toLocaleString()}
      </td>

      {/* created */}
      <td className="whitespace-nowrap text-gray-11">
        {f.date_created ? toPP(f.date_created) : "—"}
      </td>

      {/* actions */}
      <td className="text-right">
        {f.status === "active" && (
          <NavLink
            to={`${f.id}/disable`}
            className="text-destructive-subtle-fg hover:text-destructive-subtle-fg text-xs font-medium"
          >
            Disable
          </NavLink>
        )}
      </td>
    </>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const is_active = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium ${
        is_active
          ? "bg-success-subtle text-success-subtle-fg"
          : "bg-gray-3 text-gray-11"
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${is_active ? "bg-success" : "bg-gray-11"}`}
      />
      {is_active ? "Active" : "Inactive"}
    </span>
  );
}

function StatusFilter({ value }: { value: Filter }) {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  return (
    <Select.Root
      collection={FILTER_COLLECTION}
      value={[value]}
      onValueChange={(e) => {
        const v = e.value[0];
        if (!v) return;
        const p = new URLSearchParams(search);
        p.set("status", v);
        p.delete("next");
        navigate(`?${p.toString()}`);
      }}
      positioning={{ placement: "bottom-start", gutter: 4 }}
    >
      <Select.Trigger className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide cursor-pointer">
        <Select.ValueText placeholder="Status" />
        <ChevronDownIcon className="text-gray-11 icon-sm" />
      </Select.Trigger>
      <Portal>
        <Select.Positioner>
          <Select.Content
            className={`bg-card rounded-card shadow-floating text-gray-12 min-w-28 overflow-hidden z-floating ${popup_anim}`}
          >
            {FILTER_OPTS.map((v) => (
              <Select.Item key={v} item={v} className="selector-opt text-sm">
                <Select.ItemText>{FILTER_LABEL[v]}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}
