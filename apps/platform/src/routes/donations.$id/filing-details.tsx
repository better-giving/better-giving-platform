import { ADDRESS, EIN, LEGAL_NAME } from "@better-giving/brand";
import { Copier } from "@better-giving/ui";
import { BuildingIcon, CheckCircle2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { Form, useFetcher } from "react-router";
import { useRemixForm } from "remix-hook-form";
import { emails } from "@/constants/common";
import { to_utc_day } from "@/helpers/date";
import { humanize } from "@/helpers/decimal";
import { EmployerForm } from "./employer-form";
import type { IFiledFv } from "./schema";

interface IFilingDetails {
  /** the donation row's own id — the reference an arriving match is tied to */
  id: string;
  /** iso date the donation was made */
  date: string;
  /** donation amount, in `currency` */
  amount: number;
  currency: string;
  /** public url of this donation page — the donor's record of the gift */
  record_url: string;
  /** the nonprofit this gift went to — where an arriving match went too */
  recipient: string;
  /** employer already recorded against this donation, if any */
  employer?: string;
  /**
   * the employer's match landed: the amount that actually arrived, read off the
   * employer's own donation row. undefined until money is recorded against it.
   */
  matched?: { amount: number; currency: string };
  /** the donor already told us they filed; self-reported, never confirmed */
  filed?: boolean;
  /** the gift went back to the donor — there is nothing left to file for */
  voided?: boolean;
  classes?: string;
}

/**
 * the paperwork an employer's matching-gift form asks for. shown to every
 * donor: the payload is ours (legal name, EIN, address) plus the donation's own
 * date and amount, so it's identical for everyone and independent of which
 * employer — if any — the donor works for. asserts nothing about any specific
 * employer's programme; we have no employer data and make no promises about one.
 *
 * the whole matching subject lives here, capture included. everything on the
 * panel is one thought — here is what to file, tell us where you work and we'll
 * send it, tell us when you've filed — so it is one card, not a collapsible
 * asking for an employer above a panel that never mentions the answer.
 */
export function FilingDetails({ classes = "", ...p }: IFilingDetails) {
  // a returned gift is not matchable, and printing the paperwork for one would
  // walk a donor into filing a claim against money we no longer hold. the
  // panel says so and asks nothing — no paperwork, and no employer field:
  // the void gate refuses the pack, so asking would promise an email that is
  // never sent. the employer is never named back either, because we still know
  // nothing about them.
  if (p.voided) {
    return (
      <section
        className={`w-full bg-card rounded-card shadow-card overflow-hidden ${classes}`}
      >
        <div className="flex items-start gap-x-2 p-4">
          <span className="h-lh flex items-center shrink-0">
            <BuildingIcon className="stroke-gray-11 icon-md" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">
              This donation was refunded
            </h3>
            <p className="text-sm text-gray-11 mt-1">
              {p.filed
                ? "You told us you filed a matching-gift claim for it. Since the gift went back to you, that claim no longer applies — let your employer know if they haven't already closed it."
                : "There's nothing to file with an employer for a gift that's been returned. If you give again, the details will be here."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  // second, never first: a refund can land *after* a match arrived — the
  // arrival claim gates on `voided_at`, but voiding gates on nothing — and a
  // gift that went back is the more urgent of the two things to tell a donor.
  // ordering these the other way would confirm a match on money we returned.
  if (p.matched) {
    return (
      <section
        className={`w-full bg-card rounded-card shadow-card overflow-hidden ${classes}`}
      >
        <div className="flex items-start gap-x-2 p-4">
          <span className="h-lh flex items-center shrink-0">
            <CheckCircle2Icon className="stroke-success icon-md" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">
              {p.employer
                ? `${p.employer} matched this gift`
                : "Your employer matched this gift"}
            </h3>
            {/* the paperwork is gone rather than merely marked done: a donor
                reading filing details beside a completed match has every reason
                to file again, and the second claim is the one that bounces. */}
            <p className="text-sm text-gray-11 mt-1">
              A matching gift of {humanize(p.matched.amount)}{" "}
              {p.matched.currency.toUpperCase()} reached {p.recipient}. There's
              nothing left to file — thank you for asking them.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`w-full bg-card rounded-card shadow-card overflow-hidden ${classes}`}
    >
      <div className="flex items-start gap-x-2 p-4">
        <span className="h-lh flex items-center shrink-0">
          <BuildingIcon className="stroke-primary icon-md" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">
            Ask your employer to match this gift
          </h3>
          <p className="text-sm text-gray-11 mt-1">
            If your employer runs a matching gift program, filing takes a few
            minutes. Better Giving is the 501(c)(3) that received your donation,
            so these are the details the form will ask for.
          </p>
        </div>
      </div>
      {/* above the table, not below it: the table is seven rows and a donor who
          scrolls past it has left the page. this is the cheaper of the two
          paths out of here and the only one that reaches them later. */}
      <div className="p-4 border-t border-hairline">
        <EmployerForm init={p.employer} filed={p.filed} />
      </div>
      <dl className="grid sm:grid-cols-[auto_auto_1fr] border-t border-hairline">
        <Row label="Recipient legal name" value={LEGAL_NAME} />
        <Row label="EIN (tax ID)" value={EIN} />
        <Row label="Mailing address" value={ADDRESS} />
        <Row label="Donation date" value={to_utc_day(p.date)} />
        <Row
          label="Donation amount"
          value={`${humanize(p.amount)} ${p.currency.toUpperCase()}`}
        />
        <Row label="Donation ID" value={p.id} />
        <Row label="Record of this gift" value={p.record_url} last>
          <span className="break-all">{p.record_url}</span>
        </Row>
      </dl>
      {/* the beneficiary named alongside our own details, same wording as the
          filing pack email: a donor who thinks of the gift as going to the
          nonprofit reads a form full of Better Giving's details as wrong and
          stops. the second sentence answers the question that raises — where a
          match ends up — before it costs us the filing. */}
      <p className="text-xs text-gray-11 p-4 border-t border-hairline">
        {LEGAL_NAME} granted your gift on to {p.recipient}, and a match works
        the same way: your employer pays {LEGAL_NAME}, and we forward it on to{" "}
        {p.recipient}.
      </p>
      {/* remittance, kept apart from the identity rows above: those map 1:1 to what
          an employer's form asks, and an employer who pays us directly asks
          something else entirely. no bank details — this page is public to
          anyone holding its url, so check and mail only. */}
      <div className="p-4 border-t border-hairline">
        <h3 className="text-sm font-semibold">
          If your employer sends the match directly
        </h3>
        <p className="text-sm text-gray-11 mt-1">
          Most employers pay through their giving platform, which already holds
          our details. If yours mails a check instead, this is what they need.
        </p>
      </div>
      <dl className="grid sm:grid-cols-[auto_auto_1fr] border-t border-hairline">
        <Row label="Make checks payable to" value={LEGAL_NAME} />
        <Row label="Mail to" value={ADDRESS} />
        {/* the only thing tying an arriving payment back to the gift it
            matches — an employer's check names the employer, never the donor */}
        <Row label="Reference" value={`Donation ${p.id}`} />
        <Row label="Employer questions" value={emails.hi} last />
      </dl>
      <p className="text-sm text-gray-11 p-4 border-t border-hairline">
        Not sure where to file? Check your employer's giving portal, or forward
        these details to your HR team. They can reach us at {emails.hi} with any
        questions.
      </p>
      <div className="p-4 border-t border-hairline">
        <FiledBtn filed={p.filed} />
      </div>
    </section>
  );
}

interface IFiledBtn {
  filed?: boolean;
}

/**
 * the donor telling us they filed — the only signal we will ever get. employers
 * verify a gift with the charity, they never report back, so nothing else can
 * mark this.
 *
 * a POST and nothing else. the filing pack mails a link to this page, and
 * corporate mail security prefetches inbound urls before the recipient ever
 * opens them — a GET link, or a stamp written on load, would file claims for
 * donors who never clicked.
 */
function FiledBtn({ filed }: IFiledBtn) {
  const fetcher = useFetcher({ key: "donation" });
  const { handleSubmit } = useRemixForm<IFiledFv>({
    fetcher,
    defaultValues: { type: "filed" },
  });

  if (filed) {
    return (
      <p className="flex items-start gap-x-2 text-sm">
        <span className="h-lh flex items-center shrink-0">
          <CheckCircle2Icon className="stroke-success icon-md" />
        </span>
        <span>
          <span className="font-semibold">You told us you filed this.</span>{" "}
          <span className="text-gray-11">
            We'll expect your employer's verification request and answer it.
          </span>
        </span>
      </p>
    );
  }

  return (
    <Form onSubmit={handleSubmit} method="POST" className="grid">
      <p className="text-sm text-gray-11">
        Filed it already? Tell us, so we know to expect your employer's
        verification request.
      </p>
      <button
        disabled={fetcher.state !== "idle"}
        type="submit"
        className="btn btn-secondary mt-4 justify-self-end"
      >
        I've filed this with my employer
      </button>
    </Form>
  );
}

interface IRow {
  label: string;
  /** the copyable text; also the rendered value unless `children` overrides it */
  value: string;
  children?: ReactNode;
  last?: boolean;
}

function Row({ label, value, children, last }: IRow) {
  return (
    <>
      <dt className="px-4 max-sm:pt-3 sm:p-3 flex items-center text-xs font-semibold uppercase text-gray-11">
        {label}
      </dt>
      <div
        aria-hidden={true}
        className="max-sm:hidden w-px border-r border-hairline last:border-none"
      />
      <dd className="px-4 max-sm:pb-3 sm:p-3 flex items-center gap-x-2 text-sm">
        {children ?? value}
        <Copier
          text={value}
          classes={{
            container: "text-gray-11 hover:text-gray-12 shrink-0",
            icon: "size-4",
          }}
        />
      </dd>
      {!last && (
        <div
          aria-hidden={true}
          className="h-px col-span-full border-b border-hairline"
        />
      )}
    </>
  );
}
