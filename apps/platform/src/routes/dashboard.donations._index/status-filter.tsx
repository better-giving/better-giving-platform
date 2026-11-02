import { useSearchParams } from "react-router";
import type { TStatus } from "@/donations";

const filter_options: { value: "" | TStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "settled", label: "Settled" },
  { value: "refunded", label: "Refunded" },
  { value: "intent", label: "Awaiting payment" },
  { value: "confirmed", label: "Confirmed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
];

export function StatusFilter() {
  const [params, set_params] = useSearchParams();
  const current = params.get("status") ?? "";

  return (
    <select
      aria-label="Filter by status"
      value={current}
      onChange={(e) => {
        const p = new URLSearchParams(params);
        if (e.target.value) {
          p.set("status", e.target.value);
        } else {
          p.delete("status");
        }
        // reset cursor when changing filter
        p.delete("next");
        set_params(p);
      }}
      className="self-stretch rounded border border-input hover:border-input-hover bg-surface px-3 py-1.5 text-sm font-medium text-gray-12 focus-visible:outline-2 outline-ring"
    >
      {filter_options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
