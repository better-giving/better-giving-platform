import { ExtLink, Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import laira_cheering from "#/assets/laira/laira-cheering.webp";
import { BOOK_A_DEMO } from "#/constants/urls";

interface ICtaBand {
  title: string;
  subtitle: string;
  classes?: string;
  /** the ask the page has been making — audience pages name their own */
  cta_label?: string;
}

export function CtaBand({
  title,
  subtitle,
  classes = "",
  cta_label = "Join free forever",
}: ICtaBand) {
  return (
    <section
      className={`${classes} relative overflow-hidden bg-band border-t border-hairline px-6 py-20 text-center`}
    >
      <Image
        src={laira_cheering}
        width={140}
        alt="Laira celebrating"
        className="mx-auto mb-4"
      />
      <h2 className="section-heading max-w-2xl mx-auto">{title}</h2>
      <p className="mt-4 text-lg text-gray-11 max-w-xl mx-auto text-pretty">
        {subtitle}
      </p>
      <div className="flex max-sm:flex-col sm:flex-wrap justify-center gap-3.5 mt-8">
        <Link to={href("/register")} className="btn btn-primary btn-lg">
          {cta_label}
        </Link>
        <ExtLink href={BOOK_A_DEMO} className="btn btn-lg btn-secondary">
          Book a demo
        </ExtLink>
      </div>
    </section>
  );
}
