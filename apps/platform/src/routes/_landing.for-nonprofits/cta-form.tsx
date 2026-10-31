import {
  ExtLink,
  Field,
  Honeypot,
  LoadText,
  MaskedInput,
  RmxForm,
} from "@better-giving/ui";
import { ein } from "@better-giving/ui/masks";
import { useEffect, useRef, useState } from "react";
import { BOOK_A_DEMO } from "#/constants/urls";
import { FormNotice } from "#/pages/@sections/form-notice";
import { SignedInNotice } from "#/pages/@sections/signed-in-notice";
import type { ILeadValues } from "@/reg/lead";

/** one message per field, keyed by the name the action reads off the post */
export interface ICtaFormErrors {
  o_name?: string;
  o_ein?: string;
  email?: string;
}

type Key = keyof ICtaFormErrors;

/** ask order. the focus move walks this, so a failed submit always lands on
 * the earliest field that needs changing rather than the first one found. */
const fields: readonly [Key, string][] = [
  ["o_name", "Nonprofit name"],
  ["o_ein", "EIN"],
  ["email", "Work email"],
];

interface ICtaForm {
  classes?: string;
  /** what the last submit came back marked with — absent until one fails */
  errors?: ICtaFormErrors;
  /** what the last submit posted, so a failure repopulates instead of clearing */
  values?: ILeadValues;
  /** the address the browser is signed in as, when it isn't the one posted */
  signed_in_as?: string;
  /** a form-level refusal no field owns, e.g. over the submission quota */
  message?: string;
  pending?: boolean;
}

/** the page's only conversion point: enough identity to open a U.S. 501(c)(3)
 * application, posted to its own route. Validation is the action's — the fields
 * carry no native constraint so an incomplete post still reaches it. */
export function CtaForm({
  classes = "",
  errors,
  values,
  signed_in_as,
  message,
  pending,
}: ICtaForm) {
  // seeded, not synced: the client keeps this state across the POST because the
  // form never remounts, and a document POST renders the round trip's value on
  // the first pass. an effect writing it back would arrive too late for the
  // second case and would leave the mask empty in the served html. the echo is
  // already masked, so it goes in as-is.
  const [ein_value, set_ein] = useState(values?.o_ein ?? "");

  const refs = useRef<Record<Key, HTMLElement | null>>({
    o_name: null,
    o_ein: null,
    email: null,
  });
  const notice_ref = useRef<HTMLDivElement>(null);
  const message_ref = useRef<HTMLDivElement>(null);

  // a refused submit round-trips as props, so the focus move is the component's:
  // the remedy is always above the button that was just pressed.
  useEffect(() => {
    if (signed_in_as) {
      notice_ref.current?.focus();
      return;
    }
    if (message) {
      message_ref.current?.focus();
      return;
    }
    if (!errors) return;
    const first = fields.find(([k]) => errors[k])?.[0];
    if (first) refs.current[first]?.focus();
  }, [errors, signed_in_as, message]);

  return (
    <div className={`${classes} card w-full max-w-115 text-left`}>
      <h2 className="text-xl font-bold">Create your free account</h2>
      <p className="mt-2 text-sm text-gray-11">
        Takes about 2 minutes. Most accounts are approved within 3 business
        days.
      </p>

      {signed_in_as && (
        <SignedInNotice ref={notice_ref} classes="mt-4" email={signed_in_as} />
      )}

      <RmxForm
        method="post"
        // a failed submit stays where the form is: the default reset would
        // throw the page back to the top, above everything just marked
        preventScrollReset
        /* `Field` withholds both halves of native validation — `required` and a
         * constrained `type` — so the email below hands the browser no rule of
         * its own. this is the form-wide floor for what `Field` does not reach:
         * `MaskedInput`, and any raw control added here. a browser bubble fires
         * before the action runs and bypasses the summary, the marking and the
         * focus move. */
        noValidate
        disabled={pending}
        className="grid gap-4 mt-5"
        aria-label="Create your free account"
      >
        <input type="hidden" name="o_type" value="501c3" />
        <Honeypot />

        <Field
          ref={(el) => {
            refs.current.o_name = el;
          }}
          name="o_name"
          label="Nonprofit name"
          defaultValue={values?.o_name}
          required
          placeholder="e.g. Riverside Youth Alliance"
          error={errors?.o_name}
        />

        <MaskedInput
          ref={(el) => {
            refs.current.o_ein = el;
          }}
          id="o_ein"
          name="o_ein"
          mask={ein}
          value={ein_value}
          onChange={set_ein}
          inputMode="numeric"
          label="EIN"
          required
          placeholder="XX-XXXXXXX"
          error={errors?.o_ein}
        />

        <Field
          ref={(el) => {
            refs.current.email = el;
          }}
          name="email"
          type="email"
          label="Work email"
          defaultValue={values?.email}
          required
          placeholder="you@yourorg.org"
          error={errors?.email}
        />

        {message && <FormNotice ref={message_ref}>{message}</FormNotice>}

        <button type="submit" disabled={pending} className="btn btn-primary">
          <LoadText is_loading={pending}>Join free forever</LoadText>
        </button>

        {/* the hero's copy carries this link while the two sit side by side;
            below that the copy's whole button row is gone, so it lands here */}
        <ExtLink
          href={BOOK_A_DEMO}
          className="lg:hidden text-sm font-semibold text-center"
        >
          Book a demo
        </ExtLink>
      </RmxForm>
    </div>
  );
}
