import { Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import type { DonateData } from "#/api/donate-loader";
import { to_text } from "#/components/rich-text";

interface Props extends Pick<DonateData, "program"> {
  id: number;
  name: string;
  logo: string;
  tagline?: string;
  classes?: string;
}
export function OrgCard({ classes = "", program, ...props }: Props) {
  return (
    <div
      className={`md:card max-md:p-4 grid grid-cols-[auto-1fr] gap-x-4 justify-start ${classes}`}
    >
      <Image
        src={props.logo}
        width={56}
        height={56}
        className="size-14 border rounded object-cover bg-panel row-span-2"
      />
      <Link
        to={href("/org/:org", { org: props.id.toString() })}
        className="link text-ellipsis overflow-hidden text-nowrap @xl/org-card:text-balance col-start-2 w-full"
      >
        <span>{props.name}</span>
        {program ? (
          <>
            {" "}
            - <span>{program.title}</span>
          </>
        ) : null}
      </Link>
      {props.tagline && !program && (
        <p className="text-gray-11 text-sm w-full line-clamp-2">
          {props.tagline}
        </p>
      )}
      {program && (
        <p className="text-gray-11 text-sm w-full line-clamp-2">
          {props.tagline || to_text(program.description_pt)}
        </p>
      )}
    </div>
  );
}
