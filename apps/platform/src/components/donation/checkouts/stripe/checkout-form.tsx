import { LoadText, use_ask_prompt } from "@better-giving/ui";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { CircleAlert } from "lucide-react";
import {
  type FormEventHandler,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { error_prompt, user_error_prompt } from "#/helpers/error-prompt";
import type { IDonationIntent } from "@/donations";
import { ErrorTrigger } from "../../../error";
import { use_donation_redirect } from "../../common/redirect";
import {
  donation_return_url,
  type IDonationDest,
} from "../../common/return-url";
import { StuckMsg, stuck_prompt } from "../../common/stuck-prompt";
import { use_donation } from "../../context";
import { pin_bar, pin_bleed } from "../../pin";
import { use_pay_hold } from "../../use-pay-hold";
import { Loader } from "../loader";

const BANK_COULD_NOT_VERIFY =
  "Your bank couldn't verify this card. Try again or use another card.";

/** what to tell the donor, or nothing when the failure is ours to report.
 * authentication failures are not `card_error` — stripe sends them as
 * `invalid_request_error` — and a card error's own message is the one the
 * donor can act on. */
function donor_card_message(error: {
  type?: string;
  code?: string;
  message?: string;
}): string | undefined {
  if (
    error.code === "payment_intent_authentication_failure" ||
    error.code === "setup_intent_authentication_failure"
  ) {
    return BANK_COULD_NOT_VERIFY;
  }
  if (error.type === "card_error" || error.type === "validation_error") {
    return error.message;
  }
  return undefined;
}

/** `done` is a paid donation whose trip to the receipt never happened: the
 * spinner has to stop, but the donate button must stay shut — a second click
 * is a second donation. */
type Status =
  | "init"
  | "loading"
  | "ready"
  | "submitting"
  | "done"
  | { error: unknown };

interface Props extends IDonationIntent {
  order_id: string;
  bank_only?: boolean;
}
// code inspired by react stripe.js docs, see:
// https://stripe.com/docs/stripe-js/react#useelements-hook
/**
 * one prompt slot: every raise replaces the one on screen rather than stacking
 * over it.
 */
const PROMPT_SLOT = "stripe-checkout";

/** height of a sticky bar sitting on the scroller's top edge. the campaign
 * dialog's close control is one, and an alert parked at 0 would sit under it. */
function sticky_top_cover(scroller: HTMLElement): number {
  const scroller_top = scroller.getBoundingClientRect().top;
  let cover = 0;
  for (const child of scroller.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (getComputedStyle(child).position !== "sticky") continue;
    const rect = child.getBoundingClientRect();
    if (rect.top - scroller_top > 1 || rect.bottom <= scroller_top) continue;
    cover = Math.max(cover, rect.height);
  }
  return cover;
}

/** the alert sits under the summary. the dialog body is the scroller, and
 * putting the alert at its top is what a donor who has scrolled the card
 * fields can actually read. */
function scroll_alert_to_top(node: HTMLElement) {
  let parent = node.parentElement;
  while (parent) {
    const overflow = getComputedStyle(parent).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      const top =
        node.getBoundingClientRect().top -
        parent.getBoundingClientRect().top +
        parent.scrollTop -
        sticky_top_cover(parent);
      parent.scrollTo({ top: Math.max(0, top) });
      return;
    }
    parent = parent.parentElement;
  }
  node.scrollIntoView({ block: "start" });
}

export function Checkout({ order_id, donor, bank_only, ...intent }: Props) {
  const { don } = use_donation();
  const ask_prompt = use_ask_prompt();
  const [complete, set_complete] = useState(false);
  const stripe = useStripe();
  const elements = useElements();

  // there is a small delay before stripe's payment element starts to load.
  // to avoid just showing the "Back" button with nothing else on screen,
  // we first show a Loader ring and when the Stripe Element starts loading
  // (it has an inherent loading animation) that's when we hide the loader ring
  // and start showing the "Back" button
  const [status, set_status] = useState<Status>("init");
  // submitting covers the bank check, which has not returned yet. done is a
  // paid gift whose receipt trip has not finished. either way the dialog has
  // to stay up so a second payment cannot start.
  use_pay_hold(status === "submitting" || status === "done");
  // where the donation the donor already paid for ended up. the prompt saying
  // so can be dismissed and the button behind it never re-opens, so the way
  // to the receipt has to outlive it.
  const [stuck, set_stuck] = useState<IDonationDest>();
  const redirect = use_donation_redirect();
  // the campaign dialog only. a failure the element does not paint stays on
  // this form instead of opening a second dialog. other mounts keep the prompt.
  const pinned = don.pin === true;
  const [notice, set_notice] = useState<string | null>(null);
  const notice_ref = useRef<HTMLDivElement>(null);
  // stripe applies a failure to the element in the same turn it reports it.
  // that update is not the donor editing, and it must not retire the failure
  // that was just shown. two frames is past that update and before a keystroke.
  const hold_notice = useRef(false);
  // an edit retires the failure. the change payload has the method and
  // whether the field is complete, not the card number or the cvc, so a
  // replacement that leaves those alone never emits change. focusing the
  // element is that edit. our own inputs bubble to the form. stripe's
  // field errors stay under the fields; this only clears ours.
  const retire_notice = () => {
    if (hold_notice.current) return;
    set_notice((current) => (current == null ? current : null));
  };

  useLayoutEffect(() => {
    const node = notice_ref.current;
    if (!notice || !node) return;
    scroll_alert_to_top(node);
  }, [notice]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    // a new attempt replaces the last failure.
    if (pinned) set_notice(null);

    if (!stripe || !elements) {
      // stripe.js hasn't yet loaded.
      // make sure to disable form submission until stripe.js has loaded.
      return;
    }

    set_status("submitting");

    // resolved before the confirm: stripe needs it for `confirmParams`
    const dest = donation_return_url({
      donation_id: order_id,
      base_url: don.base_url,
      success_redirect: don.config?.success_redirect,
      amount:
        intent.amount.base + intent.amount.tip + intent.amount.fee_allowance,
      currency: intent.currency,
      payment_method: "card",
      donor_name: [donor.first_name, donor.last_name],
    });

    const { error } = await stripe[
      intent.frequency !== "one-time" ? "confirmSetup" : "confirmPayment"
    ]({
      elements,
      confirmParams: { return_url: dest.url },
      redirect: "if_required",
    });

    // with redirect: "if_required", this point will be reached for both
    // successful payments and errors.
    if (error) {
      const donor_message = donor_card_message(error);
      // a card_error is already under the field, so the banner would repeat it.
      if (pinned && error.type === "card_error") {
        set_notice(null);
      } else if (pinned) {
        const shown =
          donor_message ??
          error_prompt(error, { context: "processing payment" }).children;
        if (typeof shown === "string") {
          hold_notice.current = true;
          set_notice(shown);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              hold_notice.current = false;
            });
          });
        } else {
          set_notice(null);
        }
      } else if (donor_message) {
        ask_prompt(user_error_prompt(donor_message), { key: PROMPT_SLOT });
      } else {
        ask_prompt(error_prompt(error, { context: "processing payment" }), {
          key: PROMPT_SLOT,
        });
      }
      set_status("ready");
    } else {
      redirect({
        dest,
        form_id: don.config?.id,
        parent_origin: don.config?.parent_origin,
        on_stuck: () => {
          set_status("done");
          set_stuck(dest);
          ask_prompt(stuck_prompt(dest), { key: PROMPT_SLOT });
        },
      });
    }
  };

  if (typeof status === "object") {
    return <ErrorTrigger error={status.error} />;
  }

  const pin = don.pin === true && status !== "init";
  const pay = (
    <button
      className={
        pin ? "btn btn-form-primary w-full" : "btn btn-form-primary w-full mt-6"
      }
      disabled={
        !stripe || !elements || status !== "ready" || (!complete && !notice)
      }
      type="submit"
    >
      <LoadText text="Processing..." is_loading={status === "submitting"}>
        Donate now
      </LoadText>
    </button>
  );

  return (
    <form
      data-testid="stripe-checkout-form"
      onSubmit={handleSubmit}
      onChange={retire_notice}
      className="contents"
    >
      {notice && (
        <div
          ref={notice_ref}
          role="alert"
          className="mt-4 flex items-start gap-2 rounded border border-destructive bg-destructive-subtle p-3 text-destructive-subtle-fg"
        >
          {/* one line tall, so a wrap keeps the icon on the first line */}
          <span className="flex h-lh shrink-0 items-center">
            <CircleAlert className="icon-sm" />
          </span>
          <p>{notice}</p>
        </div>
      )}
      <PaymentElement
        className="mt-4"
        options={{
          wallets: { applePay: "never", googlePay: "never", link: "never" },
          layout: "tabs",
          ...(bank_only && {
            paymentMethodOrder: ["us_bank_account"],
          }),
          defaultValues: {
            billingDetails: {
              name: `${donor.first_name} ${donor.last_name}`,
              email: donor.email,
            },
          },
        }}
        onReady={() => set_status("ready")}
        onLoadError={(error) => set_status({ error })}
        onLoaderStart={() => set_status("loading")}
        onChange={(x) => {
          set_complete(x.complete);
          retire_notice();
        }}
        onFocus={retire_notice}
      />
      {status === "init" ? (
        <Loader />
      ) : pin ? (
        <div data-pin="" className={`${pin_bar} ${pin_bleed} order-1`}>
          {pay}
        </div>
      ) : (
        pay
      )}
      {stuck && <StuckMsg dest={stuck} classes="mt-4 text-sm text-gray-11" />}
    </form>
  );
}
