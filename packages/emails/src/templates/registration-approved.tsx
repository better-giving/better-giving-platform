import { Text } from "react-email";
import { Link } from "../components/link";
import { PublicLayout } from "../components/public-layout";
import { APP_NAME, HELP } from "../constants";

export interface IData {
  /** the sending environment's origin, no trailing slash; every app link is built on it */
  base_url: string;
  /** absent: the mail says "your organization" in its own sentences */
  org_name?: string;
  registrant_first_name: string;
  /** absent: no profile link; the reader is sent to log in instead */
  endow_id?: string;
}

function Jsx({ org_name, registrant_first_name, endow_id, base_url }: IData) {
  const profile_link = endow_id && `${base_url}/profile/${endow_id}`;
  const login_link = `${base_url}/login`;

  return (
    <PublicLayout type="registration">
      <Text>Hi {registrant_first_name},</Text>
      <Text>
        We've got great news for you: the documentation you provided was
        successfully vetted by our team and approved.{" "}
        {org_name
          ? `The account for ${org_name} is now live.`
          : "Your organization's account is now live."}
      </Text>
      {profile_link ? (
        <>
          <Text>
            You can see{" "}
            {org_name
              ? `the Better Giving page for ${org_name}`
              : "your organization's Better Giving page"}{" "}
            here: <Link href={profile_link}>{profile_link}</Link> and start
            receiving donations from visitors.
          </Text>
          <Text>
            Once you've logged in with your email, your Better Giving page is
            where you can access your account's Admin area and edit it.
          </Text>
        </>
      ) : (
        <Text>
          Log in with your email at <Link href={login_link}>{login_link}</Link>{" "}
          to access your account's Admin area and edit your Better Giving page.
        </Text>
      )}
      <Text>
        NOTE: your details will NOT be visible on the marketplace until you have
        'published' your new page, with a nice banner, words about your
        organization and such as social media links. That all helps potential
        donors decide to donate!
      </Text>
      <Text>
        Details on all aspects of editing your page can be found{" "}
        <Link href={HELP.edit_overview}>here</Link>.
      </Text>
      <Text>
        Along with a {APP_NAME} marketplace page to enable 'global browsers' to
        see your nonprofit, the use of the embedded donation form on your own
        website donation page is key to the success of increasing your
        donations. Instruction on how to do that{" "}
        <Link href={HELP.embed_form}>can be found here</Link>.
      </Text>
    </PublicLayout>
  );
}

export const template = (data: IData) => {
  return {
    node: <Jsx {...data} />,
    subject: data.org_name
      ? `Good news: the account for ${data.org_name} has been created`
      : "Good news: your organization's account has been created",
  };
};
