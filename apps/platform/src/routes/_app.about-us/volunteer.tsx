import { EMAILS } from "@better-giving/brand";
import { Image } from "@better-giving/ui";
import { ArrowRight } from "lucide-react";
import laira_cheering from "#/assets/laira/laira-cheering.webp";

interface IVolunteer {
  classes?: string;
}

export function Volunteer({ classes = "" }: IVolunteer) {
  return (
    <section className={classes} aria-labelledby="volunteer-heading">
      <div className="page grid gap-14 lg:grid-cols-[0.95fr_1.05fr] items-center">
        <Image
          src={laira_cheering}
          width={340}
          alt="Laira celebrating"
          className="w-full max-w-xs justify-self-center max-lg:order-2"
        />
        <div className="grid gap-4 justify-items-start">
          <p className="text-sm font-semibold text-gray-11">Contribute</p>
          <h2 id="volunteer-heading" className="section-heading">
            Lend your skills
          </h2>
          <p className="text-gray-11 leading-relaxed text-pretty">
            Want to help with code, design, writing, or nonprofit expertise?
            We'd love to have you.
          </p>
          <a
            href={`mailto:${EMAILS.support}`}
            className="inline-flex items-center gap-1.5 font-bold link"
          >
            Get in touch
            <ArrowRight className="icon-md" />
          </a>
        </div>
      </div>
    </section>
  );
}
