import {
  Badge,
  type BadgeTone,
  ImagePlaceholder,
  Target,
} from "@better-giving/ui";
import { to_usd } from "@better-giving/ui/helpers";
import { type ReactNode, useId } from "react";
import { MAX_EXPIRATION_ISO } from "@/campaign/schema";
import type { STATUS_WORD } from "./copy";

export type TRowStatus =
  | (typeof STATUS_WORD)[keyof typeof STATUS_WORD]
  | "Profile";

const STATUS_TONE: Record<TRowStatus, BadgeTone> = {
  Live: "success",
  Draft: "neutral",
  Ended: "secondary",
  Closed: "destructive",
  Profile: "primary",
};

interface IStatusBadge {
  status: TRowStatus;
  /** outer placement only */
  className?: string;
}

export function StatusBadge({ status, className }: IStatusBadge) {
  return (
    <Badge tone={STATUS_TONE[status]} className={className}>
      {status}
    </Badge>
  );
}

const NO_END_MS = Date.parse(MAX_EXPIRATION_ISO);

/** a closed row stopped taking donations, so its end date reads as past whatever the date */
export function when(iso: string | null, status: TRowStatus) {
  if (!iso) return "No end date";
  const date = new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const verb = status === "Ended" || status === "Closed" ? "Ended" : "Ends";
  return `${verb} ${date}`;
}

/** fund search docs store expiration as unix seconds; the year-9999 sentinel is no end date */
export function fund_end(expiration: number, status: TRowStatus) {
  if (expiration * 1000 >= NO_END_MS) return "No end date";
  return when(new Date(expiration * 1000).toISOString(), status);
}

/** a smart or absent target has no fixed goal to measure against */
function fixed_goal(target: IRow["target"]): number | null {
  const n = Number(target);
  return target && n > 0 ? n : null;
}

export interface IRow {
  name: string;
  status: TRowStatus;
  thumb: string | null;
  raised: number;
  /** the stored target: a number string, "smart", or absent */
  target: string | null | undefined;
  byline?: ReactNode;
  /** absent for the profile, which never ends */
  ends?: string;
  /** given the id of the row's name, for a control that names itself by the row */
  actions?: (name_id: string) => ReactNode;
}

export function Row({
  name,
  status,
  thumb,
  raised,
  target,
  byline,
  ends,
  actions,
}: IRow) {
  const goal = fixed_goal(target);
  const name_id = useId();
  return (
    <li className="card grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-6">
      {thumb ? (
        <img
          src={thumb}
          alt=""
          className="size-16 rounded object-cover self-start"
        />
      ) : (
        <ImagePlaceholder classes="size-16 rounded self-start" />
      )}
      <div className="grid gap-2 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p id={name_id} className="font-semibold">
            {name}
          </p>
          <StatusBadge status={status} />
        </div>
        {byline}
        {goal ? (
          <Target classes="max-w-sm" progress={raised} target={goal} />
        ) : (
          <p className="flex items-center gap-x-1 text-sm text-gray-11">
            <span className="font-medium">{to_usd(raised)}</span>{" "}
            <span className="text-xs">Raised</span>
          </p>
        )}
        {ends && <span className="text-sm text-gray-11">{ends}</span>}
      </div>
      {actions && (
        <div className="col-span-full sm:col-span-1 flex flex-wrap items-center justify-end gap-3">
          {actions(name_id)}
        </div>
      )}
    </li>
  );
}
