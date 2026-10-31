import { Portal } from "@ark-ui/react/portal";
import { createListCollection, Select } from "@ark-ui/react/select";
import { popup_anim } from "@better-giving/ui";
import { ChevronDownIcon } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

export type FormStatusFilter = "all" | "active" | "inactive";
const OPTS: FormStatusFilter[] = ["all", "active", "inactive"];
const LABEL: Record<FormStatusFilter, string> = {
  all: "All",
  active: "Active",
  inactive: "Inactive",
};
const COLLECTION = createListCollection({
  items: OPTS,
  itemToString: (v) => LABEL[v],
});

/** the Status column's header: the filter lives in the table card's header
 *  strip, so an empty result still shows the control that emptied it. */
export function StatusFilter({ value }: { value: FormStatusFilter }) {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  return (
    <Select.Root
      collection={COLLECTION}
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
            {OPTS.map((v) => (
              <Select.Item key={v} item={v} className="selector-opt text-sm">
                <Select.ItemText>{LABEL[v]}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
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
