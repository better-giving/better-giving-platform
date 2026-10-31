import { Accordion, ExtLink } from "@better-giving/ui";
import { ArrowRight } from "lucide-react";
import type React from "react";
import { Fragment } from "react";
import { INTERCOM_HELP } from "#/constants/urls";

interface IFaq {
  id: number;
  question: string;
  paragraphs: React.JSX.Element[];
}

interface Props {
  classes?: string;
  items: IFaq[];
  heading?: string;
  /** lead paragraph between the heading and the first question */
  sub?: string;
}

export const faqs = [
  {
    id: 0,
    question:
      "Are Better Giving’s fundraising solutions really free? How do you sustain your operations?",
    paragraphs: [
      <p key={0}>
        Donors can add an optional contribution at checkout. It is opt-in and
        starts off. There is no platform fee while that ask stays on the form.
        Turning it off is a 1.5% fee. Fiscal sponsorship is 2.9% of each
        sponsored gift.
      </p>,
      <p key={1} className="italic">
        Maximize your impact without worrying about fees eating into donations.
      </p>,
    ],
  },
  {
    id: 1,
    question: "What types of donations can I accept?",
    paragraphs: [
      <p key={0}>
        Our platform supports traditional methods like credit/debit card and
        bank transfers, and enables you to benefit from modern options like
        crypto, stock, donor-advised funds (DAF), checks, and digital wallets.
        We provide localized and express checkout options to ensure a seamless
        donation experience. This flexibility ensures you never miss an
        opportunity to receive a donation, regardless of how your donors prefer
        to give.
      </p>,
      <p key={1} className="italic">
        More donation options mean more opportunities to engage donors and
        increase contributions.
      </p>,
    ],
  },
  {
    id: 2,
    question: "How quickly can I start fundraising with Better Giving?",
    paragraphs: [
      <p key={0}>
        Register online, then add your donation form to your website or share
        your fundraising page.
      </p>,
      <p key={1} className="italic">
        Add the form when you are ready to raise funds.
      </p>,
    ],
  },
  {
    id: 3,
    question: "How easy is it to embed your donation forms on our website?",
    paragraphs: [
      <p key={0}>
        Our donation forms are designed to be easily embeddable on any website,
        with no technical expertise required. Whether you use WordPress, Wix, or
        a custom-built site, our forms integrate seamlessly with just a few
        clicks. We provide step-by-step guides, and if you need additional
        support, our team is always available to help.
      </p>,
      <p key={1} className="italic">
        Start accepting donations quickly, with no tech headaches or lengthy
        setup processes.
      </p>,
    ],
  },
  {
    id: 4,
    question: "How does your platform reduce administrative burdens?",
    paragraphs: [
      <p key={0}>
        Better Giving takes care of all the heavy lifting when it comes to tax
        reporting, donor receipts, and compliance. Once your donations are
        processed, we automatically send receipts to donors, simplifying your
        record-keeping. Additionally, our embeddable forms integrate seamlessly
        with your website, meaning there’s no need for extra development work.
        You get a fully operational donation system without adding
        administrative overhead.
      </p>,
      <p key={1} className="italic">
        Save your organization valuable time and resources, letting you focus on
        your mission rather than paperwork.
      </p>,
    ],
  },
  {
    id: 5,
    question: "How does the high-yield savings account work?",
    paragraphs: [
      <p key={0}>
        Our high-yield savings account provides a secure, low-risk way for
        nonprofits to grow their donations. Donated funds are automatically
        placed in a US Treasury yield money market account with Fidelity
        Investments to earn steady interest as soon as possible, helping you
        build financial stability without risking your principal. As a nonprofit
        ourselves, we use the same savings services to manage our own funds,
        ensuring reliability and trust.
      </p>,
      <p key={1} className="italic">
        Simple, hassle-free way to grow donations without extra overhead.
      </p>,
    ],
  },
  {
    id: 6,
    question:
      "How do the managed investment funds work, and how do they benefit nonprofits?",
    paragraphs: [
      <p key={0}>
        The Sustainability Fund can hold a share of donations for longer-term
        growth. Returns vary, and past performance isn't a guarantee. Withdrawal
        requests are reviewed before payout.
      </p>,
      <p key={1} className="italic">
        Turn today’s donations into long-term financial security for your
        nonprofit.
      </p>,
    ],
  },
  {
    id: 7,
    question: "Can I track my donation and fund performance?",
    paragraphs: [
      <p key={0}>
        Yes, we offer real-time donation tracking, so you can monitor
        contributions as they come in. Alongside this, quarterly reports detail
        your fund performance, including the growth of your savings account and
        Sustainability Fund. These reports help you track your financial
        progress and make informed decisions about future fundraising and
        investment strategies.
      </p>,
      <p key={1} className="italic">
        Stay informed with transparent, regular updates on your financial
        performance.
      </p>,
    ],
  },
  {
    id: 9,
    question: "Can international nonprofits and NGOs use Better Giving?",
    paragraphs: [
      <p key={0}>
        Yes, Better Giving supports charitable organizations all around the
        world. Our platform offers fiscal sponsorship to help organizations
        outside the U.S. access U.S. grants and donations while also simplifying
        tax compliance. With our global reach, you can accept donations from
        anywhere in the world in multiple currencies.
      </p>,
      <p key={1} className="italic">
        Global nonprofits can access U.S. funding and donors with ease.
      </p>,
    ],
  },
  {
    id: 10,
    question:
      "What’s fiscal sponsorship? And why should my organization be interested?",
    paragraphs: [
      <p key={0}>
        Fiscal sponsorship lets a US 501(c)(3) nonprofit (the sponsor) receive
        and manage donations for a non-US charity (the sponsee).
      </p>,
      <p key={1}>
        With Better Giving as your sponsor, your organization can accept
        tax-deductible US donations without forming a US nonprofit.
      </p>,
      <p key={2}>
        <span className="font-semibold">Why it matters</span>
        <br />
        <span className="font-medium">Reach US donors:</span> Tap into America’s
        $499B+ giving market.
        <br />
        <span className="font-medium">Build credibility:</span> Partner with a
        trusted US nonprofit.
        <br />
        <span className="font-medium">Grow smarter:</span> Get expert help with
        fundraising, crypto giving, and endowments.
      </p>,
    ],
  },
  {
    id: 11,
    question: "How much does Fiscal Sponsorship cost?",
    paragraphs: [
      <p key={0}>
        The Better Giving Fiscal Sponsorship service costs just 2.9% of each
        donation.
      </p>,
      <p key={1}>
        That 2.9% comes out of the sponsored gift.
        <br />
        This is well below the industry average of 4-10% for similar services
        (as of 2026)
      </p>,
      <p key={2}>
        There is no platform fee while the optional donor contribution stays on.
        Turning that ask off is a 1.5% fee.
      </p>,
    ],
  },
  {
    id: 12,
    question: "How do I ensure my donations are safe?",
    paragraphs: [
      <p key={0}>
        Better Giving is a nonprofit ourselves, committed to financial
        transparency. Our platform is integrated with trusted financial partners
        such as Fidelity Investments and is fully compliant with regulatory
        standards, ensuring that all donations are processed securely. For
        nonprofits using our savings and investment services, we offer detailed,
        transparent reporting so you always know where your funds are and how
        they are performing.
      </p>,
      <p key={1} className="italic">
        Security and transparency build trust, ensuring your donations are safe,
        and your donors feel confident.
      </p>,
    ],
  },
];

export function FAQ({
  classes = "",
  items,
  heading = "Got questions? We've got answers.",
  sub,
}: Props) {
  return (
    <section className={`${classes} grid`} aria-labelledby="faq-heading">
      <h2
        id="faq-heading"
        className="col-span-full text-center section-heading mb-10 border-b-0"
      >
        {heading}
      </h2>
      {sub && (
        <p className="col-span-full text-center text-lg text-gray-11 text-pretty -mt-6 mb-10">
          {sub}
        </p>
      )}
      <Accordion
        variant="divided"
        items={items.map((faq) => ({
          value: String(faq.id),
          trigger: faq.question,
          content: faq.paragraphs.map((p, idx) => (
            <Fragment key={idx}>{p}</Fragment>
          )),
        }))}
      />
      <footer className="grid pt-8">
        <ExtLink
          href={INTERCOM_HELP}
          className="justify-self-center flex items-center gap-x-2 link md:text-lg font-semibold"
        >
          <span>Complete FAQs</span>
          <ArrowRight className="icon-md" />
        </ExtLink>
        <button
          type="button"
          onClick={() => {
            if ((window as any).Intercom) {
              return (window as any).Intercom("show");
            }
            window.open(INTERCOM_HELP, "_blank");
          }}
          className="mt-4 justify-self-center flex items-center gap-x-2 text-primary hover:text-primary md:text-lg font-semibold"
        >
          Need additional support? Live Chat.
        </button>
      </footer>
    </section>
  );
}
