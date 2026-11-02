import { Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import laira_calling from "#/assets/laira/laira-calling.webp";
import laira_shake_hands from "#/assets/laira/laira-shaking-hands.webp";
import { BOOK_A_DEMO } from "#/constants/urls";

export function BottomCta({ classes = "" }) {
  return (
    <div className={`${classes} grid gap-4`}>
      <CtaCard
        classes="from-primary "
        title="Ready to unlock your fundraising potential?"
        to={{ href: href("/register"), title: "Get started" }}
        img={{
          src: laira_shake_hands,
          width: 140,
          alt: "laira shaking hands with another character",
        }}
      />
      <CtaCard
        classes="from-primary"
        title="Want to learn more first?"
        to={{ href: BOOK_A_DEMO, title: "Book a demo" }}
        img={{
          src: laira_calling,
          width: 80,
          alt: "laira holding a phone to her ear",
        }}
      />
    </div>
  );
}

interface ICtaCard {
  classes?: string;
  title: string;
  to: { href: string; title: string };
  img: { src: string; width: number; alt: string };
}
export function CtaCard({ classes = "", title, to, img }: ICtaCard) {
  return (
    <div
      className={`${classes} grid @md:grid-cols-2 w-full bg-linear-to-br to-transparent p-6 rounded`}
    >
      <h3 className="@3xl:text-left text-primary-fg @3xl:leading-snug  text-xl @sm:text-2xl mb-4 col-span-full">
        {title}
      </h3>
      <Link
        to={to.href}
        className="btn btn-lg btn-primary active:translate-x-1 self-start justify-self-start"
      >
        {to.title}
      </Link>
      <Image
        width={img.width}
        src={img.src}
        alt={img.alt}
        className="justify-self-end mt-8"
      />
    </div>
  );
}
