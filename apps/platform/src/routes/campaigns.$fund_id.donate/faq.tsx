import { ADDRESS_LINES, EIN, LEGAL_NAME } from "@better-giving/brand";
import { Accordion, ExtLink } from "@better-giving/ui";
import { Fragment, type PropsWithChildren } from "react";
import { href, Link } from "react-router";

interface Props {
  classes?: string;
  endowId: number;
}

export default function FAQ({ classes = "", endowId }: Props) {
  return (
    <div className={`${classes} md:card grid gap-2 md:gap-4`}>
      <h2 id="faqs">Frequently asked questions</h2>
      <Accordion
        items={faqs(endowId).map((faq) => ({
          value: String(faq.id),
          trigger: faq.question,
          content: faq.paragraphs.map((p, idx) => (
            <Fragment key={idx}>{p}</Fragment>
          )),
        }))}
      />
    </div>
  );
}

const faqs = (_: number) => [
  {
    id: 1,
    question: "How does my donation work to benefit nonprofits?",
    paragraphs: [
      <p key={0}>
        Donations are made to Altruistic Partners Empowering Society, DBA Better
        Giving, a registered charitable 501(c)(3) (EIN {EIN}).
      </p>,
      <p key={1}>
        <Em intensity={2}>For immediate donations</Em>, Better Giving grants out
        the donations to the chosen nonprofit on a weekly basis.
      </p>,
      <p key={2}>
        <Em intensity={2}>For Sustainability Fund donations</Em>, these are
        invested as a Board Managed quasi-endowment, and Better Giving grants
        out 75% of the yield every quarter to the nonprofit, investing the other
        25% of the yield into the sustainability fund to mitigate against such
        as inflation. In this way, donors can give today, but see the impact
        continue into the future.
      </p>,
    ],
  },
  {
    id: 2,
    question: "Can I receive a tax receipt?",
    paragraphs: [
      <p key={0}>
        Yes! We will email you a tax receipt immediately after your donation.
      </p>,
      <p key={1}>
        To ensure deductibility, please check with your tax advisor, as rules
        vary by country and state.
      </p>,
      <p key={2}>
        To access your receipts or a year-end donation summary,{" "}
        <Link to={href("/signup")} className="link">
          create a free donor account
        </Link>{" "}
        (
        <ExtLink href="https://youtu.be/74kEk7aQauA" className="link">
          video guide
        </ExtLink>
        ).
      </p>,
    ],
  },
  {
    id: 3,
    question: "How much does Better Giving charge?",
    paragraphs: [
      <p key={0}>
        It is free to set up and use a Better Giving account. No subscriptions.
        No upfront costs. No platform fees (unless a nonprofit has opted out of
        offering donors a voluntary donation to Better Giving).
      </p>,
      <p key={1}>Payment processing fees from 3rd parties may apply.</p>,
    ],
  },
  {
    id: 4,
    question: "How do I donate by Check?",
    paragraphs: [
      <p key={0} className="leading-normal">
        For gifts by check: Make your check out to{" "}
        <Em classes="text-gray-12">{LEGAL_NAME}</Em> and send it to:{" "}
        <Em intensity={1} classes="text-gray-12 block mt-2">
          {LEGAL_NAME}
          {ADDRESS_LINES.map((line) => (
            <Fragment key={line}>
              <br /> {line}
            </Fragment>
          ))}
        </Em>
      </p>,
      <p key={1}>
        IMPORTANT: Add the name of the Nonprofit you are donating to in the
        memo.
      </p>,
      <p key={2}>
        If you would like to add a contribution for Better Giving to help keep
        our services free, you may add that in the memo with{" "}
        <Em
          intensity={1}
          classes="text-gray-12 text-xs font-mono bg-secondary p-0.5"
        >
          BG:&nbsp;$amount
        </Em>
        .
      </p>,
    ],
  },
];

function Em({
  classes = "",
  children,
  intensity = 1,
}: PropsWithChildren & { intensity?: 1 | 2 | 3; classes?: string }) {
  return (
    <span
      className={`${
        intensity === 1
          ? "font-medium"
          : intensity === 2
            ? "font-semibold"
            : "font-semibold text-gray-12"
      } ${classes}`}
    >
      {children}
    </span>
  );
}
