import { Text } from "react-email";
import { ErrorBand } from "../components/error-band";
import { MailTo } from "../components/mail-to";
import { PublicLayout } from "../components/public-layout";
import { EMAILS } from "../constants";

export interface IData {
  registrant_first_name: string;
  rejection_reason: string;
  /** the application still holds a connected stripe account */
  stripe_connected?: boolean;
}

function Jsx({
  registrant_first_name,
  rejection_reason,
  stripe_connected,
}: IData) {
  return (
    <PublicLayout type="registration">
      <Text>Hi {registrant_first_name},</Text>
      <Text>
        Unfortunately, upon careful review from the Better Giving team we have
        deemed that this application to register with Better Giving did not pass
        the acceptance process for the following reason(s):
      </Text>
      <ErrorBand>{rejection_reason}</ErrorBand>
      {stripe_connected && (
        <Text>
          Your Stripe account is still connected, so you can resubmit. If you're
          not reapplying, you can disconnect Better Giving from your Stripe
          dashboard.
        </Text>
      )}
      <Text>
        {stripe_connected
          ? "You will need to rectify these issues and resubmit, but"
          : "You will need to make a new application that rectifies these issues, but"}{" "}
        if you have any questions at all, just get in touch at{" "}
        <MailTo email={EMAILS.hi} />
      </Text>
    </PublicLayout>
  );
}

export const template = (data: IData) => {
  return {
    node: <Jsx {...data} />,
    subject: "Your application has been rejected.",
  };
};
