import { Badge, ExtLink, Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import donation_form from "#/assets/images/donation-form.png";
import laira_heart from "#/assets/laira/laira-heart.webp";
import { BOOK_A_DEMO } from "#/constants/urls";

const gift_types = [
  "Card",
  "Bank / ACH",
  "PayPal",
  "Apple / Google Pay",
  "Stock",
  "DAF",
  "IRA",
  "Crypto",
] as const;

interface IHero {
  classes?: string;
}

export function Hero({ classes = "" }: IHero) {
  return (
    <div
      className={`${classes} bg-linear-to-b from-background to-band pt-16 pb-20`}
    >
      <div className="page grid gap-12 lg:grid-cols-[minmax(22rem,1fr)_minmax(18rem,33rem)] items-center">
        <div className="grid gap-5 justify-items-start">
          <div className="flex flex-wrap gap-2">
            <Badge size="md" tone="secondary">
              Built by and for nonprofits
            </Badge>
            <Badge size="md" tone="secondary">
              Open source
            </Badge>
          </div>
          <h1 className="hero-heading">
            Every way to give.
            <br />
            One form. <span className="text-primary">Free forever.</span>
          </h1>
          <p className="text-lg/relaxed text-gray-11 max-w-lg text-pretty">
            Better Giving is a donation platform for nonprofits: one form takes
            card, bank, PayPal, stock, DAF, IRA and crypto gifts, and you can
            earn interest on your balance or invest it in the Sustainability
            Fund.
          </p>
          <p className="text-lg/relaxed text-gray-11 max-w-lg text-pretty">
            One brandable, embeddable donation form. No platform fee while the
            optional donor contribution stays on (1.5% if you turn it off).
            Open-source code you can read.
          </p>
          <div className="flex flex-wrap gap-2 max-w-lg">
            {gift_types.map((g) => (
              <Badge key={g} size="md" tone="secondary">
                {g}
              </Badge>
            ))}
          </div>
          <div className="flex max-sm:flex-col max-sm:w-full sm:flex-wrap sm:items-center gap-3.5 mt-2">
            <Link
              to={href("/register")}
              className="btn btn-lg btn-primary shadow-lift-cta"
            >
              Join free forever
            </Link>
            <ExtLink href={BOOK_A_DEMO} className="btn btn-lg btn-secondary">
              Book a demo
            </ExtLink>
          </div>
          <p className="text-sm text-gray-11">
            The optional donor contribution is opt-in and starts off. Turning
            that ask off is a 1.5% fee.
          </p>
        </div>

        <div className="relative max-lg:justify-self-center">
          <div
            className="absolute size-50 bg-secondary rounded-full -top-8 -right-4"
            aria-hidden
          />
          <div className="relative bg-card rounded-card shadow-lift-media overflow-hidden -rotate-1">
            <img
              src={donation_form}
              alt="Better Giving embeddable donation form"
              className="block w-full h-auto"
            />
          </div>
          <Image
            src={laira_heart}
            width={150}
            alt="Laira holding a heart"
            className="absolute -bottom-9 -left-8 rotate-3 max-lg:hidden"
          />
        </div>
      </div>
    </div>
  );
}
