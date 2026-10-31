import { to_usd } from "@better-giving/ui/helpers";
import { format, formatDistance } from "date-fns";
import { PencilIcon } from "lucide-react";
import { Link } from "react-router";

interface Props {
  bal_cash: number;
  threshold: number;
  next_payout: string;
  pm?: { bank_summary: string };
  classes?: string;
}

export function Payout({ classes = "", ...p }: Props) {
  const progress = Math.min(p.bal_cash / p.threshold, 1);
  return (
    <div className={`${classes}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="space-x-1 mb-1">
          <span className="text-xs uppercase">total</span>
          <span className="font-bold">{to_usd(p.bal_cash, 2)}</span>
        </div>
        <div className="space-x-1">
          <span className="text-xs">of</span>
          <span className="text-sm">{to_usd(p.threshold, 2)}</span>
          <Link
            to={{ pathname: "payout-min", search: `?min=${p.threshold}` }}
            replace
            preventScrollReset
            aria-label="Edit payout threshold"
            className="text-xs inline-block"
          >
            <PencilIcon className="icon-xs" />
          </Link>
        </div>
      </div>
      <div
        style={{
          backgroundImage: `linear-gradient(to right, var(--success) 0%, var(--success) ${Math.min(progress * 100, 100)}%, color-mix(in oklch, var(--success) 15%, transparent) ${Math.min(progress * 100, 100)}%, color-mix(in oklch, var(--success) 15%, transparent) 100%)`,
        }}
        className="py-1 rounded-full inset-shadow-track mb-2"
      />
      <p className="text-sm">
        {progress < 1 ? "Once desired amount is accumulated, " : ""}
        will be paid out to{" "}
        {
          <Link to="../banking" className="link font-medium">
            {p.pm?.bank_summary || "your default payout method"}
          </Link>
        }{" "}
        on{" "}
        {
          <span className="">
            {format(p.next_payout, "PP")}
            <span className="text-gray-11">
              - in {formatDistance(p.next_payout, new Date())}
            </span>
            .
          </span>
        }
      </p>
    </div>
  );
}
