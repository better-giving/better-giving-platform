import { Copier } from "@better-giving/ui";
import { href, Link } from "react-router";

interface Props {
  classes?: string;
  referral_id: string;
  base_url: string;
}

export function ReferralId({ classes = "", ...p }: Props) {
  return (
    <div className={`card ${classes}`}>
      <div className="mb-4">
        <div className="text-sm font-medium text-gray-11 mb-1">REFERRAL ID</div>
        <div className="flex items-center">
          <div className="text-xl font-semibold mr-2">{p.referral_id}</div>
          <Copier
            text={p.referral_id}
            classes={{
              container: "text-gray-11 hover:text-gray-12",
              icon: "size-5",
            }}
          />
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-gray-11 mb-1">
          REFERRAL LINK
        </div>
        <div className="flex items-center">
          <p className="text-primary truncate max-w-xs font-mono">
            {p.base_url}
            {href("/register")}?referrer={p.referral_id}
          </p>
          <Copier
            text={`${p.base_url}${href("/register")}?referrer=${p.referral_id}`}
            classes={{
              container: "text-gray-11 hover:text-gray-12 ml-2",
              icon: "size-5",
            }}
          />
        </div>
      </div>

      <div className="mt-3 text-sm text-gray-11">
        By sharing your referral link or code, you agree to our{" "}
        <Link
          target="_blank"
          to={href("/terms-of-use-referrals")}
          className="link"
        >
          Referral Program Terms of Use
        </Link>
        .
      </div>
    </div>
  );
}
