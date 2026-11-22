import { href } from "react-router";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { TERMS_RECOVERY_FROM, TERMS_ZONE, terms_date_label } from "@/terms";
import type { Route } from "./+types/route";

const EFFECTIVE = terms_date_label("2026-10-23");
// the cookie window change has its own date; the header and recovery dates stay
const COOKIE_CHANGE_EFFECTIVE = terms_date_label("2026-12-07");
const RECOVERY_FROM = terms_date_label(TERMS_RECOVERY_FROM);

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/terms-of-use-referrals")}`,
    title: "Referral Program Terms of Use",
  });

export default function TermsReferrals() {
  return (
    <div className="page prose lg:prose-lg py-20">
      <h2 className="text-center">
        Better Giving Referral Program Terms of Use
      </h2>
      <p>
        <strong>Effective Date:</strong> {EFFECTIVE}
      </p>
      <p>
        These Referral Program Terms of Use (“Terms”) govern your participation
        in the Better Giving Referral Program (the “Program”), offered by Better
        Giving, Inc., a Delaware nonprofit organization recognized as tax-exempt
        under IRC 501(c)(3) (“Better Giving”, “we”, or “us”).
      </p>
      <ol>
        <li>
          <h3>Program Overview</h3>
          <p>
            The Program allows eligible users of Better Giving to earn rewards
            by referring nonprofit organizations to Better Giving. By
            participating in the Program, you agree to these Terms, as well as
            Better Giving’s General Terms of Use and Privacy Policy.
          </p>
        </li>
        <li>
          <h3>Eligibility</h3>
          <p>
            The Program is open to individuals and organizations who have an
            active Better Giving account and are in good standing. Participation
            is subject to Better Giving’s discretion.
          </p>
        </li>
        <li>
          <h3>How Referral Rewards Work</h3>
          <p>
            If a nonprofit signs up for Better Giving using your referral link
            or code, and begins accepting donations via Better Giving, you will
            earn a referral reward equal to 30% of the platform revenue
            generated from that nonprofit for a period of three (3) years.
          </p>
          <p>Platform revenue is defined as:</p>
          <ul>
            <li>
              Voluntary donor contributions to Better Giving (default model), or
            </li>
            <li>
              A flat 1.5% platform fee if the nonprofit opts out of donor
              contributions.
            </li>
          </ul>
          <p>
            Better Giving uses a first-click attribution model and tracks
            referrals via:
          </p>
          <ul>
            <li>Your unique referral link or code</li>
            <li>
              A 90-day cookie window (in the United Kingdom, the European Union
              and wherever we cannot tell a visitor’s location, only if the
              visitor accepts our referral cookie)
            </li>
            <li>Manual attribution upon review by Better Giving</li>
          </ul>
          <p>
            A visitor who declines the cookie, deletes it, or switches browser
            or device before registering may not be credited automatically; we
            may still attribute the referral manually on review.
          </p>
          <p>This change takes effect on {COOKIE_CHANGE_EFFECTIVE}.</p>
        </li>
        <li>
          <h3>Payment Terms</h3>
          <p>
            Referral payments are calculated monthly and issued after a 30-day
            hold to account for refunds and chargebacks. You must submit a valid
            W-9 (U.S.) or W-8BEN (non-U.S.) before any payments can be made.
            Referral earnings are subject to a minimum payout threshold of $25.
            U.S.-based referrers will receive a 1099-MISC if earnings exceed
            $600 in a calendar year.
          </p>
        </li>
        <li>
          <h3>Refunds and Chargebacks After Payment</h3>
          <p>
            The 30-day hold in Section 4 covers refunds and chargebacks that
            happen before a referral reward is paid. If a donation is refunded,
            reversed or charged back after the referral reward earned on it has
            been paid to you, Better Giving may deduct that reward from your
            next referral payments until it is recovered in full. If only part
            of a donation is refunded or reversed, you owe the same share of the
            reward.
          </p>
          <p>
            If a donor disputes a payment with their bank or payment provider
            after the referral reward earned on it has been paid to you, Better
            Giving may deduct the disputed share of that reward as soon as the
            dispute is opened. If the dispute is resolved in Better Giving’s
            favor, or the donor withdraws it, or it closes without the payment
            being reversed, Better Giving will cancel the amount owed; if it is
            resolved partly in Better Giving’s favor, you owe only the share of
            the reward on the part the donor keeps. Any part of a cancelled
            amount already deducted is added to your next referral payment. If a
            dispute that closed in Better Giving’s favor is later reopened,
            appealed or reversed and the donor keeps all or part of the payment,
            Better Giving may deduct the share of the reward on that part.
          </p>
          <p>
            Better Giving will notify you of each amount before deducting it,
            and may waive any amount in whole or in part at its discretion. This
            section applies only to donations made on or after the later of (i)
            12:00 a.m. Eastern Time ({TERMS_ZONE}) on{" "}
            {/* the recovery cut-off follows TERMS_RECOVERY_FROM, not the effective line */}
            {RECOVERY_FROM} and (ii) the date these revised Program Terms take
            effect.
          </p>
        </li>
        <li>
          <h3>Annual Earnings Cap</h3>
          <p>
            To comply with nonprofit regulatory and reasonable compensation
            guidelines, the total amount of referral rewards paid to any one
            participant shall not exceed $100,000 in any 12-month period. This
            cap applies regardless of the number of referred nonprofits or
            platform revenue generated.
          </p>
        </li>
        <li>
          <h3>Prohibited Conduct</h3>
          <p>Participants must not:</p>
          <ul>
            <li>Use spam, bots, or misleading marketing</li>
            <li>Misrepresent Better Giving</li>
            <li>Use paid search targeting Better Giving brand keywords</li>
          </ul>
          <p>
            Violation of these terms may result in forfeiture of earnings and
            removal from the Program.
          </p>
        </li>
        <li>
          <h3>No Guarantee of Acceptance</h3>
          <p>
            Better Giving reserves full discretion to accept or reject any
            referred nonprofit. Participation in the Program does not constitute
            employment, partnership, or agency.
          </p>
        </li>
        <li>
          <h3>Confidentiality</h3>
          <p>
            You may receive confidential or proprietary information during the
            course of your participation. You agree not to disclose or use any
            such information outside the scope of the Program.
          </p>
        </li>
        <li>
          <h3>Termination</h3>
          <p>
            Better Giving may suspend or terminate your participation at any
            time, for any reason, including abuse of the Program. Termination
            will not affect any referral rewards already earned through the
            termination date, unless such earnings were obtained in violation of
            these Terms.
          </p>
        </li>
        <li>
          <h3>Modifications</h3>
          <p>
            Better Giving reserves the right to modify these Terms at any time.
            A change takes effect seven (7) days after we post it, unless the
            posting states a later date. Continued participation after a change
            takes effect constitutes acceptance of the new Terms.
          </p>
        </li>
        <li>
          <h3>Governing Law</h3>
          <p>These Terms are governed by the laws of the State of Delaware.</p>
        </li>
      </ol>
    </div>
  );
}
