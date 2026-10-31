import { href, NavLink } from "react-router";
import type { IReg } from "@/reg";

type Props = {
  reg: IReg;
  classes?: string;
};

const type_label = { "501c3": "U.S. 501(c)(3)", other: "International" };

/** the one answer the wizard never asks again: what the applicant said they
 * are. Stored rows exist with no identity and even with no type at all, so
 * every part of this is allowed to be missing — what must always be reachable
 * is the way to correct it. */
export function IdentitySummary({ reg, classes = "" }: Props) {
  const label = reg.o_type && type_label[reg.o_type];
  const detail = (() => {
    if (reg.o_type === "501c3") return reg.o_ein ? `EIN ${reg.o_ein}` : "";
    if (reg.o_type === "other") {
      return [reg.o_hq_country, reg.o_registration_number]
        .filter(Boolean)
        .join(" · ");
    }
    // with no type, the country on the row says nothing about identity
    return "";
  })();

  return (
    <div
      className={`${classes} flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 text-sm text-gray-11 border-t border-hairline`}
    >
      <span>
        {label ?? "Organization type not set"}
        {detail ? ` · ${detail}` : ""}
      </span>
      {/* in review, approved and rejected are all closed to edits */}
      {reg.status === "01" && (
        <NavLink
          to={href("/register/:reg_id/identity", { reg_id: reg.id })}
          className="ml-auto underline link"
        >
          Change
        </NavLink>
      )}
    </div>
  );
}
