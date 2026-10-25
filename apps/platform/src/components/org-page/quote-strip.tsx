import { ArrowRight } from "lucide-react";
import { type TransitionEvent, useState } from "react";
import type { IDonorMessage } from "./items";

export interface IQuoteStrip {
  messages: IDonorMessage[];
  /** `light` on the page, `dark` on the brand's deep ground, `pull` in a
   * reading column */
  tone: "light" | "dark" | "pull";
  /** set while more pages exist. called when the reader reaches the last
   * loaded message, and again if they press next there before it lands, so
   * the caller drops a call made while its fetch is in flight */
  on_more?: () => void;
  classes?: string;
}

const TONE = {
  light: {
    ground: "rounded bg-band p-5 text-gray-12 md:p-6",
    mark: "text-primary",
    quote: "md:text-lg",
    column_mark: true,
    meta: "text-gray-11",
    next: "link",
  },
  pull: {
    ground: "border-l-4 border-primary pl-5 text-gray-12 md:pl-6",
    mark: "text-primary",
    quote: "text-lg md:text-xl",
    column_mark: false,
    meta: "text-gray-11",
    next: "link",
  },
  // white on the deep fill is Lc 99.6, and has no hover rung (ledger: the
  // --primary-fg alpha ladder is unmeasured)
  dark: {
    ground: "rounded bg-primary-deep p-5 text-primary-fg md:p-6",
    mark: "",
    quote: "md:text-lg",
    column_mark: true,
    meta: "",
    next: "focus-visible:outline-2 focus-visible:outline-primary-fg focus-visible:outline-offset-2",
  },
} as const;

/** a message next brings in, from the reading direction */
const STEP_IN =
  "transition-[opacity,translate] duration-base ease-out starting:translate-x-2 starting:opacity-0";

/** one donor message at a time, with its donor and a next control; never the
 * amount. past the last loaded message it waits for `on_more`'s page, or
 * wraps to the first when there is none. nothing when there are no messages */
export function QuoteStrip({
  messages,
  tone,
  on_more,
  classes = "",
}: IQuoteStrip) {
  const [index, set_index] = useState(0);
  // the index next is bringing in, until it has eased in. the first message is
  // already there, and one that has settled stays put when a hidden tab panel
  // is shown again, which would otherwise replay `@starting-style`
  const [stepping_to, set_stepping_to] = useState<number | null>(null);
  // the index the next page's first message will take, while waiting on it
  const [waiting_at, set_waiting_at] = useState<number | null>(null);
  const n = messages.length;

  if (waiting_at != null && n > waiting_at) {
    set_waiting_at(null);
    set_index(waiting_at);
  }

  if (n === 0) return null;
  const at = Math.min(index, n - 1);
  const m = messages[at];
  const t = TONE[tone];

  function next() {
    if (at < n - 1) {
      set_stepping_to(at + 1);
      set_index(at + 1);
      if (at + 1 === n - 1) on_more?.();
      return;
    }
    if (on_more) {
      set_stepping_to(n);
      set_waiting_at(n);
      on_more();
      return;
    }
    set_stepping_to(0);
    set_index(0);
  }

  const has_next = n > 1 || !!on_more;
  const step_in = stepping_to === at ? STEP_IN : "";

  function settle(e: TransitionEvent<HTMLElement>) {
    if (e.target === e.currentTarget) set_stepping_to(null);
  }

  // a phone (and a pull-quote at any width) has no room for the mark as a
  // column: it opens the message inline. on a phone next shares the donor's
  // line, laid over the caption's cell, so the message keeps the full width
  return (
    <section
      aria-label="Donor messages"
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center md:flex md:gap-6 ${t.ground} ${classes}`}
    >
      {t.column_mark && (
        <span
          aria-hidden
          className={`text-5xl font-bold leading-none max-md:hidden ${t.mark}`}
        >
          “
        </span>
      )}
      {/* next changes the whole figure, so it is what's announced: the
          position, the message and its donor */}
      <figure
        aria-live={has_next ? "polite" : undefined}
        aria-atomic={has_next || undefined}
        className="col-span-full row-start-1 flex min-w-0 grow flex-col gap-1"
      >
        {/* the position alone: messages arrive a page at a time, so there is
            no total to give */}
        {has_next && <span className="sr-only">Message {at + 1}</span>}
        {/* keyed, so each message is a new node and eases in; the figure
            itself stays, which is what keeps it a live region */}
        <blockquote
          key={`q${at}`}
          className={`break-words ${t.quote} ${step_in}`}
        >
          <span
            aria-hidden
            className={`font-bold ${t.column_mark ? "md:hidden" : ""} ${t.mark}`}
          >
            “{" "}
          </span>
          {m.message}
        </blockquote>
        <figcaption
          key={`c${at}`}
          // the quote and its caption ease in together; a panel hidden
          // mid-step cancels it
          onTransitionEnd={settle}
          onTransitionCancel={settle}
          className={`text-sm ${t.meta} ${step_in} ${has_next ? "max-md:flex max-md:min-h-11 max-md:items-center max-md:pr-14" : ""}`}
        >
          {m.name}
        </figcaption>
      </figure>
      {has_next && (
        <button
          type="button"
          aria-label="Next message"
          onClick={next}
          className={`group/next glyph-btn col-start-2 row-start-1 size-11 shrink-0 self-end ${t.next}`}
        >
          <ArrowRight
            aria-hidden
            className="icon-lg transition-[translate] motion-safe:group-hover/next:translate-x-0.5"
          />
        </button>
      )}
    </section>
  );
}
