import { to_usd } from "@better-giving/ui/helpers";
import { SparklesIcon } from "lucide-react";
import type { IFees } from "./helpers";

interface Props extends IFees {
  classes?: string;
}

export function Fees({ classes = "", ...f }: Props) {
  const covered_by_donor = f.processing_allowance > 0;
  if (!(f.base > 0 || f.fsa > 0 || f.processing > 0)) {
    return <span className={classes}>{to_usd(0, 2)}</span>;
  }
  return (
    <div className={`${classes} grid gap-y-2 text-xs`}>
      {f.base > 0 && (
        <div>
          <p className="text-xs uppercase text-gray-11">base</p>
          <span>{to_usd(f.base, 2)}</span>
        </div>
      )}
      {f.fsa > 0 && (
        <div>
          <p className="text-xs uppercase text-gray-11">fiscal sponsorship</p>
          <span>{to_usd(f.fsa, 2)}</span>
        </div>
      )}
      {f.processing > 0 && (
        <div>
          <p className="text-xs uppercase text-gray-11">processing</p>
          <p className="flex items-center justify-end">
            <span
              className={`${covered_by_donor ? "line-through text-gray-11" : ""}`}
            >
              {to_usd(f.processing, 2)}
            </span>
            {covered_by_donor && (
              <SparklesIcon className="fill-success stroke-success ml-1 icon-xs" />
            )}
          </p>
        </div>
      )}
    </div>
  );
}
