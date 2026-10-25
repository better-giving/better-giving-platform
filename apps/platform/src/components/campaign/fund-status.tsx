import { Badge, type BadgeTone } from "@better-giving/ui";
import { unpack } from "@better-giving/ui/helpers";
import { fund_is_open } from "@/campaign/is-open";
import { MAX_EXPIRATION_ISO } from "@/campaign/schema";

interface IStatus {
  active: boolean;
  text?: "closed" | "completed" | "expired" | (string & {});
}

// compared as instants: the same sentinel arrives as `…59Z` and `…59.000Z`
const NO_END_MS = Date.parse(MAX_EXPIRATION_ISO);

// fixed locale + UTC, so server and client render the creator's date identically
const month_day = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const month_day_year = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export const status = (
  expiry: string | undefined,
  active: boolean,
  progress: number,
  now: Date = new Date()
): IStatus => {
  if (!active) return { active: false, text: "closed" };

  if (!expiry || Date.parse(expiry) >= NO_END_MS) return { active: true };

  if (!fund_is_open({ active, expiration: expiry }, now))
    return {
      active: false,
      text: progress ? "completed" : "expired",
    };

  const end = new Date(expiry);
  const end_date_starts = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );
  if (now.getTime() >= end_date_starts)
    return { active: true, text: "last day" };

  const fmt =
    end.getUTCFullYear() === now.getUTCFullYear() ? month_day : month_day_year;
  return { active: true, text: `ends ${fmt.format(end)}` };
};

interface IFundStatus {
  classes?: {
    container?: string;
    inactive?: string;
    expired?: string;
    completed?: string;
    active?: string;
  };
  status: IStatus;
}

export const FundStatus = (props: IFundStatus) => {
  const s = unpack(props.classes);
  if (!props.status.text) return null;
  const style = ((t) => {
    switch (t) {
      case "closed":
        return s.inactive;
      case "completed":
        return s.completed;
      case "expired":
        return s.expired;
      default:
        return s.active;
    }
  })(props.status.text);

  return <div className={`${s.container} ${style}`}>{props.status.text}</div>;
};

/** the status as a pill, for a fund card */
export const FundStatusBadge = ({ status }: { status: IStatus }) => {
  if (!status.text) return null;
  const tone = ((t): BadgeTone => {
    switch (t) {
      case "closed":
        return "destructive";
      case "completed":
        return "success";
      case "expired":
        return "neutral";
      default:
        return "secondary";
    }
  })(status.text);
  return <Badge tone={tone}>{status.text}</Badge>;
};
