import { to_usd } from "@better-giving/ui/helpers";
import { format } from "date-fns";
import { Link } from "react-router";
import { WarningCallout } from "#/components/warning-callout";
import type { IReturnedPayouts } from "$/pg/queries/payout";

interface IReturnedNotice {
  returned: IReturnedPayouts;
  classes?: string;
}

export function ReturnedNotice({ returned, classes = "" }: IReturnedNotice) {
  const total = to_usd(returned.total, 2);
  return (
    <WarningCallout
      title="Your bank sent a payout back"
      classes={classes}
      action={
        <Link to="../banking" className="btn btn-primary btn-sm">
          Check bank details
        </Link>
      }
    >
      {returned.count === 1
        ? `${total} from ${format(returned.latest_date, "MMM d")} didn't reach your bank account, so it's back in your balance. Check your bank details and it goes out again.`
        : `${returned.count} payouts (${total}) didn't reach your bank account, so they're back in your balance. Check your bank details and they go out again.`}
    </WarningCallout>
  );
}
