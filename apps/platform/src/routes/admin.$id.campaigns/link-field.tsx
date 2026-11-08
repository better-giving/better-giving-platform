import { ExtLink, Label } from "@better-giving/ui";
import { Fragment } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { InfoTip } from "../admin.$id.donors/info-tip";
import { SLUG_HELP, SLUG_LOCK_NOTE, SLUG_PUBLISH_LOCK } from "./copy";

const PLACEHOLDER_SEGMENT = "your-campaign";

interface ILinkField {
  reg: UseFormRegisterReturn<"slug">;
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
  /** the line under the label */
  help?: string;
  /** what the field is for, behind an info icon beside the label */
  tip?: string;
  /** what donors find at the link, e.g. "this campaign" */
  subject: string;
  placeholder?: string;
  /** the previewed link while the slug is empty */
  empty_url: string | null;
  /** follows the empty link in the preview, e.g. " until you set a link" */
  empty_suffix?: string;
  /** ids of notes rendered outside the field */
  describedby?: string;
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

/** the slug input, framed as the last segment of the campaign's public link */
export function LinkField(props: ILinkField) {
  return (
    <PublicLinkField
      {...props}
      label="Campaign link"
      required
      help={
        props.locked ? SLUG_LOCK_NOTE : `${SLUG_HELP}. ${SLUG_PUBLISH_LOCK}`
      }
      subject="this campaign"
      empty_url={props.base && `${props.base}${PLACEHOLDER_SEGMENT}`}
    />
  );
}

/** a slug input framed as the last segment of a public link, with a live
 *  preview of the whole link */
export function PublicLinkField({
  reg,
  value,
  base,
  locked,
  error,
  label,
  required,
  help,
  tip,
  subject,
  placeholder,
  empty_url,
  empty_suffix,
  describedby,
}: IPublicLinkField) {
  const id = `__${reg.name}`;
  const sub_id = `__sub_${reg.name}`;
  const prefix_id = `__prefix_${reg.name}`;
  const error_id = `__error_${reg.name}`;
  const segment = value.trim();
  const url = segment ? base && `${base}${segment}` : empty_url;
  const url_text = url && break_at_slashes(url);
  const described = [
    help || tip ? sub_id : "",
    base ? prefix_id : "",
    error ? error_id : "",
    describedby ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="min-w-0">
      <div className={`flex items-center gap-1.5 ${help ? "" : "mb-2"}`}>
        <Label required={required} htmlFor={id}>
          {label}
        </Label>
        {tip && <InfoTip label={tip} />}
      </div>
      {help && (
        <p id={sub_id} className="text-gray-11 text-sm mb-2 break-words">
          {help}
        </p>
      )}
      {/* a tooltip is read only when its icon is focused; this copy
          describes the input itself */}
      {!help && tip && (
        <p id={sub_id} className="sr-only">
          {tip}
        </p>
      )}
      {/* the prefix gives way first: it truncates from its start so the org
          segment beside the input stays readable, and the input keeps a floor */}
      <div className="field-input-container flex min-h-(--field-size)">
        {base && (
          <span
            id={prefix_id}
            className="flex items-center min-w-0 pl-4 text-gray-11 select-none"
          >
            {/* rtl puts the ellipsis at the start; the inner ltr span keeps
                the url's own order */}
            <span dir="rtl" className="truncate min-w-0">
              <span dir="ltr">{base.replace(/^https?:\/\//, "")}</span>
            </span>
          </span>
        )}
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
          aria-describedby={described}
          autoComplete="off"
          spellCheck={false}
          className={`min-w-32 flex-1 bg-transparent py-3.5 pr-4 outline-none ${base ? "" : "pl-4"}`}
        />
      </div>
      {url && (
        <p className="mt-1 text-sm text-gray-11 break-words">
          Donors will find {subject} at{" "}
          {locked ? (
            <ExtLink href={url} className="link">
              {url_text}
            </ExtLink>
          ) : (
            url_text
          )}
          {!segment && empty_suffix}
        </p>
      )}
      <p id={error_id} className="field-err mt-1 empty:hidden">
        {error}
      </p>
    </div>
  );
}
