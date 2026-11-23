import { ExtLink, Label } from "@better-giving/ui";
import { Fragment } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

const PLACEHOLDER_SEGMENT = "your-campaign";

interface ILinkField {
  reg: UseFormRegisterReturn;
  value: string;
  /** the link up to its slug, e.g. `https://host/org/<org-slug>/`; null when
   * the org has no slug yet, so there is no public link to show */
  base: string | null;
  /** published: the link is live and can no longer change */
  locked: boolean;
  error?: string;
}

interface IPublicLinkField extends ILinkField {
  label: string;
  required?: boolean;
  /** the sentence the previewed link ends, e.g. "Donors will find this
   * campaign at" */
  lead: string;
  /** the sentence while the slug is empty; `lead` when absent */
  empty_lead?: string;
  /** a path segment shown after the link, outside it, e.g. the campaign
   * segment under an org's slug */
  tail?: string;
  placeholder?: string;
  /** the previewed link while the slug is empty */
  empty_url: string | null;
  /** follows the empty link in the preview, e.g. " until you set a link" */
  empty_suffix?: string;
  /** ids of notes rendered outside the field */
  describedby?: string;
}

/** the legal name as lowercase words joined by hyphens, for the empty slug's placeholder */
export function suggest_slug(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 30)
    .replace(/^-+|-+$/g, "");
  return words || "my-nonprofit";
}

/** a url offers no break of its own; one after each slash keeps a wrap
 *  between path segments, never inside a word */
function break_at_slashes(url: string) {
  const parts = url.split("/");
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ));
}

/** the slug input for a campaign's public link */
export function LinkField(props: ILinkField) {
  return (
    <PublicLinkField
      {...props}
      label="Campaign link"
      required
      lead="Donors will find this campaign at"
      empty_url={props.base && `${props.base}${PLACEHOLDER_SEGMENT}`}
    />
  );
}

/** a slug input with a live preview of the whole public link under it */
export function PublicLinkField({
  reg,
  value,
  base,
  locked,
  error,
  label,
  required,
  lead,
  empty_lead,
  tail,
  placeholder,
  empty_url,
  empty_suffix,
  describedby,
}: IPublicLinkField) {
  const id = `__${reg.name}`;
  const error_id = `__error_${reg.name}`;
  const segment = value.trim();
  const url = segment ? base && `${base}${segment}` : empty_url;
  const url_text = url && break_at_slashes(url);
  const described = [error ? error_id : "", describedby ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="min-w-0">
      <Label required={required} htmlFor={id} className="mb-2">
        {label}
      </Label>
      <div className="field-input-container flex min-h-(--field-size)">
        <input
          {...reg}
          id={id}
          type="text"
          disabled={locked}
          aria-disabled={locked || undefined}
          aria-required={required || undefined}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-errormessage={error_id}
          aria-describedby={described || undefined}
          autoComplete="off"
          spellCheck={false}
          className="min-w-32 flex-1 bg-transparent py-3.5 px-4 outline-none"
        />
      </div>
      <p id={error_id} className="field-err mt-1 text-start empty:hidden">
        {error}
      </p>
      {url && (
        <p className="mt-1 text-sm text-gray-11 break-words">
          {segment ? lead : (empty_lead ?? lead)}{" "}
          {locked ? (
            <ExtLink href={url} className="link">
              {url_text}
            </ExtLink>
          ) : (
            url_text
          )}
          {tail && (
            <>
              /<wbr />
              {tail}
            </>
          )}
          {!segment && empty_suffix}
        </p>
      )}
    </div>
  );
}
