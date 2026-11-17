import { TriangleAlert } from "lucide-react";
import type React from "react";
import {
  createElement,
  type HTMLInputTypeAttribute,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { unpack } from "../../helpers/unpack";
import { Label } from "./label";
import type { Classes } from "./types";

const textarea = "textarea" as const;
type TextArea = typeof textarea;
type InputType = HTMLInputTypeAttribute | TextArea;

/** a prefix or suffix: the hint's ink, never selected with the value */
const AFFIX = "shrink-0 select-none whitespace-nowrap text-gray-11";

/** a press on an affix focuses its control, as a press on a label does; the
 *  press itself moves no focus, so the control is not blurred first */
const press_to =
  (control: { current: HTMLElement | null }) => (e: React.MouseEvent) => {
    e.preventDefault();
    control.current?.focus();
  };

/** a constrained *text* type is a rule the browser enforces itself, in its own
 * bubble, before the action ever runs — so a malformed address fires no submit,
 * the app's error summary stays empty, nothing is marked `aria-invalid` and the
 * focus move never happens. `required` is withheld from the control for exactly
 * that reason (see the prop below); a type named here is translated rather than
 * spread, for the same one.
 *
 * the keyboard is the only half worth keeping, and `inputMode` carries it
 * without the constraint. the schema is what validates. `date`, `number` and
 * `checkbox` are absent — their type is the control, not a rule over free
 * text. */
const unconstrained: Partial<Record<string, "email" | "url" | "tel">> = {
  email: "email",
  url: "url",
  tel: "tel",
};

type Props<T extends InputType> = Omit<
  T extends TextArea
    ? React.TextareaHTMLAttributes<HTMLTextAreaElement>
    : React.InputHTMLAttributes<HTMLInputElement>,
  // `prefix` is also RDFa's global attribute, a string: the affix replaces it
  "className" | "id" | "spellCheck" | "type" | "prefix"
> & {
  classes?: Classes | string;
  tooltip?: ReactNode;
  label: string | ReactElement;
  /** help text under the label. a string empty after trim counts as absent;
   * any other truthy value counts as present, so a ReactNode must render
   * text — one that renders nothing leaves the control described by an empty
   * node. */
  sub?: ReactNode;
  /** id(s) of help text the caller renders OUTSIDE this component, joined onto
   * the ids this component mints. nothing here can reach that markup, so its
   * id has to be handed in — notes sitting below a field built at the call
   * site, say. a `sub` needs none of this: it is described either way. */
  describedby?: string;
  /** a button or buttons beside the control. the row is [control][action]:
   * the message and the `tooltip` hint render under the control, in its
   * column, never under the row. give each `<Button>` `size="field"` (the
   * control's height; `btn-field` on a plain button). when the row is under
   * 384px (the field's own width, not the viewport's) one button wraps under
   * the control; two or more wrap under 576px. */
  action?: ReactNode;
  /** what a button in `action` reports, read out by a `role="status"` region
   * after the buttons. pass `""` at rest: the region has to exist before its
   * text does, or the change is not announced. absent, no region renders. */
  status?: string;
  /** a key, secret or id: the mono face, no ligatures, an ellipsis when it
   * overflows; read-only keeps full ink. */
  mono?: boolean;
  type?: T;
  /** the control's own id, for an error summary's link or an outside
   * `<label for>`. absent, one is minted. the help text's ids are minted
   * either way. */
  id?: string;
  /** a unit or sign inside the control's edge, before the value ("$"). it is
   * `aria-hidden`: say the unit in the label or the hint. single-line
   * controls only; a textarea ignores it. */
  prefix?: ReactNode;
  /** the same after the value ("days", "%"). */
  suffix?: ReactNode;
  /** a character limit: a counter at the end of the message slot ("612 of
   * 1,500"), warning ink from 90%, and over it destructive ink, "· N over",
   * `aria-invalid` and a message naming the overage. soft: nothing stops the
   * typing or truncates a paste unless `hard` is set. */
  limit?: number;
  /** add `maxlength={limit}`: the browser stops the typing at the limit. */
  hard?: boolean;
  /** the counter's text. @default "612 of 1,500", "1,512 of 1,500 · 12 over" */
  count_label?: (count: number, limit: number) => string;
  /** the message over the limit, when `error` gives none.
   * @default "12 characters over the limit." */
  over_message?: (over: number) => string;
  /** what the polite status says, a second after typing stops, when the
   * count crosses 90% or the limit. @default "88 characters left",
   * "12 characters over the limit", "Within the limit" */
  limit_messages?: Partial<LimitMessages>;
};

type LimitMessages = {
  near: (left: number) => string;
  over: (over: number) => string;
  within: string;
};

const figure = new Intl.NumberFormat("en-US");
const characters = (n: number) =>
  `${figure.format(n)} character${n === 1 ? "" : "s"}`;
const LIMIT_MESSAGES: LimitMessages = {
  near: (left) => `${characters(left)} left`,
  over: (over) => `${characters(over)} over the limit`,
  within: "Within the limit",
};
const count_text = (count: number, limit: number) =>
  `${figure.format(count)} of ${figure.format(limit)}${count > limit ? ` · ${figure.format(count - limit)} over` : ""}`;
const over_text = (over: number) => `${characters(over)} over the limit.`;

type Zone = "quiet" | "near" | "over";
const zone_of = (count: number, limit: number): Zone =>
  count > limit ? "over" : count >= limit * 0.9 ? "near" : "quiet";

/** the count's zone, and the counter's status line: it speaks only when the
 * zone changes, once the typing has paused for a second, so a reader is not
 * told every keystroke. the zone the field mounts in is never announced. */
function useLimitStatus(
  count: number,
  limit: number | undefined,
  messages: LimitMessages
): { zone: Zone; said: string } {
  const zone = limit === undefined ? "quiet" : zone_of(count, limit);
  const said_zone = useRef(zone);
  const latest = useRef({ count, messages });
  useEffect(() => {
    latest.current = { count, messages };
  });
  const [said, set_said] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: each keystroke (a new count) restarts the pause
  useEffect(() => {
    if (limit === undefined) return;
    const timer = setTimeout(() => {
      const from = said_zone.current;
      if (zone === from) return;
      said_zone.current = zone;
      const { count, messages } = latest.current;
      set_said(
        zone === "over"
          ? messages.over(count - limit)
          : from === "over"
            ? messages.within
            : zone === "near"
              ? messages.near(limit - count)
              : ""
      );
    }, 1000);
    return () => clearTimeout(timer);
  }, [zone, count, limit]);
  return { zone, said };
}

export function Field<T extends InputType = InputType>({
  type = "text" as T,
  label,
  classes,
  tooltip,
  sub,
  describedby,
  action,
  status,
  mono,
  id: control_id,
  prefix,
  suffix,
  limit,
  hard,
  count_label = count_text,
  over_message = over_text,
  limit_messages,
  required, //extract from props to disable native validation
  // off by default: most fields here are somebody else's data (a contact's
  // details, a delivery address), which the browser must not prefill from
  // the user's own saved values
  autoComplete = "off",
  error,
  warning,
  ref,
  ...props
}: Props<T> & {
  error?: string;
  /** a note that does not block: warning ink and a mark under the control,
   * the edge unchanged and no `aria-invalid`. an `error` takes the slot. */
  warning?: string;
  ref?: React.Ref<HTMLInputElement | HTMLTextAreaElement>;
}) {
  const style = unpack(classes);

  // minted, not derived from `name`: two fields of one name (a repeated row,
  // the same form twice on a page) would otherwise share every id
  const uid = useId();
  const id = control_id ?? `${uid}input`;
  const errorId = `${uid}error`;
  const warningId = `${uid}warning`;
  const subId = `${uid}sub`;
  const hintId = `${uid}hint`;
  const mode = unconstrained[type as string];
  const has_sub = typeof sub === "string" ? sub.trim() !== "" : !!sub;

  // the count of an uncontrolled field is kept here; a controlled one reads
  // its value
  const [typed, set_typed] = useState(
    () => String(props.defaultValue ?? "").length
  );
  const count = typeof props.value === "string" ? props.value.length : typed;
  const counted = limit !== undefined;
  const recounts = counted && typeof props.value !== "string";

  // the caller's ref, and the field's own for its form
  const own = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const control_ref = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      own.current = el;
      if (typeof ref === "function") return ref(el);
      if (ref) ref.current = el;
    },
    [ref]
  );
  // an uncontrolled count follows the form's reset, which puts the value back
  // after its event: the count is read in a task of its own, since a reset
  // button's press runs microtasks between the event and the reset
  useEffect(() => {
    const form = own.current?.form;
    if (!recounts || !form) return;
    let later = 0;
    const recount = () => {
      later = window.setTimeout(() => {
        if (own.current) set_typed(own.current.value.length);
      });
    };
    form.addEventListener("reset", recount);
    return () => {
      form.removeEventListener("reset", recount);
      window.clearTimeout(later);
    };
  }, [recounts]);
  const over = counted && count > limit ? count - limit : 0;
  const { zone, said } = useLimitStatus(count, limit, {
    ...LIMIT_MESSAGES,
    ...limit_messages,
  });
  // the caller's error wins; over the limit with none, the overage is the
  // message
  const message = error || (over ? over_message(over) : undefined);
  const shows_warning = !message && !!warning;

  // every piece of help text on screen for this render, in reading order: the
  // sub under the label, the message under the control, the hint under that.
  // the message joins the list rather than standing in for it — a reader that
  // hears only the error loses the guidance that would fix it.
  const described =
    [
      has_sub ? subId : undefined,
      message ? errorId : shows_warning ? warningId : undefined,
      tooltip ? hintId : undefined,
      describedby,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  const affixed = type !== textarea && (!!prefix || !!suffix);
  // with an affix the edge, fill, ring and states move to the container
  // (`.field-input-container`, which keys them off the input inside); the
  // input keeps the field's padding, 4px on an affixed side
  const input_class = affixed
    ? `block min-inline-0 flex-1 border-0 bg-transparent py-3.5 outline-none placeholder:text-gray-11 ${prefix ? "ps-1" : "ps-4"} ${suffix ? "pe-1" : "pe-4"}${mono ? " field-input-mono" : ""}`
    : `${style.input} field-input${mono ? " field-input-mono" : ""}`;

  const input = createElement(type === textarea ? textarea : "input", {
    ref: control_ref,
    ...props,
    ...(counted
      ? {
          onChange: (
            e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>
          ) => {
            set_typed(e.currentTarget.value.length);
            props.onChange?.(e);
          },
          ...(hard ? { maxLength: limit } : {}),
        }
      : {}),
    ...(type === textarea ? {} : { type: mode ? "text" : type }),
    // a caller's own inputMode wins. autoCapitalize is off by default on a
    // constrained type and on by default on `text`, so it is restated here
    ...(mode
      ? {
          inputMode: props.inputMode ?? mode,
          autoCapitalize: props.autoCapitalize ?? "none",
        }
      : {}),
    // a key typed on a phone must not gain a capital first letter
    ...(mono ? { autoCapitalize: props.autoCapitalize ?? "off" } : {}),
    id,
    "aria-invalid": !!message,
    "aria-disabled": props.disabled,
    // native `required` is withheld (see `unconstrained` above), so this
    // is the only thing that announces the asterisk the label draws
    "aria-required": required || undefined,
    // both, because neither alone is enough: `aria-errormessage` is the
    // right relationship but several screen readers still ignore it, and
    // `aria-describedby` is the one they all honour. it is absent when no
    // help text is present — a ReactNode `sub` is taken at its word (see
    // the prop).
    "aria-errormessage": errorId,
    "aria-describedby": described,
    className: input_class,
    autoComplete,
    spellCheck: false,
  });

  // the control and its messages as one column: with an `action` this is the
  // control column of the row, so the message and the hint stay under the
  // control
  const control = (
    <>
      {affixed ? (
        <div
          className={`${style.input} field-input-container flex min-block-(--field-size) items-center-safe`}
        >
          {prefix ? (
            <span
              aria-hidden="true"
              onMouseDown={press_to(own)}
              className={`${AFFIX} ps-4`}
            >
              {prefix}
            </span>
          ) : null}
          {input}
          {suffix ? (
            <span
              aria-hidden="true"
              onMouseDown={press_to(own)}
              className={`${AFFIX} pe-4`}
            >
              {suffix}
            </span>
          ) : null}
        </div>
      ) : (
        input
      )}

      {/* one slot, at most one message in it. the warning's paragraph stays
          rendered while empty (it takes no room then), so its live region is
          in the accessibility tree before its text arrives. */}
      {counted ? (
        <>
          {/* the message at the start, the counter at the end of one row */}
          <div className="mbs-1 flex items-start gap-x-3 gap-y-1">
            <p
              id={errorId}
              className={`${style.error} field-err min-inline-0 flex-1 empty:hidden`}
            >
              {message}
            </p>
            <span
              aria-hidden="true"
              data-state={zone === "quiet" ? undefined : zone}
              className="ms-auto shrink-0 whitespace-nowrap text-xs text-gray-11 tabular-nums data-[state=near]:text-warning-subtle-fg data-[state=over]:font-semibold data-[state=over]:text-destructive-subtle-fg"
            >
              {count_label(count, limit)}
            </span>
          </div>
          <span role="status" className="sr-only">
            {said}
          </span>
        </>
      ) : (
        <p
          id={errorId}
          className={`${style.error} field-err mbs-1 empty:hidden`}
        >
          {message}
        </p>
      )}
      <p id={warningId} aria-live="polite" className="field-warn">
        {shows_warning ? (
          <>
            <TriangleAlert aria-hidden="true" />
            <span>
              <span className="sr-only">Warning: </span>
              {warning}
            </span>
          </>
        ) : null}
      </p>
      {tooltip ? (
        <p id={hintId} className="field-help">
          {tooltip}
        </p>
      ) : null}
    </>
  );

  return (
    <div className={`${style.container} min-inline-0`}>
      <Label
        className={`${style.label} label ${has_sub ? "" : "mbe-1"}`}
        required={required}
        htmlFor={id}
      >
        {label}
      </Label>
      {has_sub ? (
        typeof sub === "string" ? (
          <p id={subId} className="text-gray-11 text-sm mbe-2 break-words">
            {sub}
          </p>
        ) : (
          // `sub` is a ReactNode and callers pass a paragraph, so the wrapper
          // has to hold block markup: inside a span that is invalid nesting, and
          // the browser is free to restructure it, carrying the content out
          // from under the id
          <div id={subId}>{sub}</div>
        )
      ) : null}

      {action ? (
        <div className="field-row">
          <div className="field-control">{control}</div>
          <div className="field-action">
            {action}
            {/* after the buttons: the two-button wrap counts `.btn` siblings */}
            {status === undefined ? null : (
              <span role="status" className="sr-only">
                {status}
              </span>
            )}
          </div>
        </div>
      ) : (
        control
      )}
    </div>
  );
}

/** a button's done look, held for `done_ms` and then dropped: `[done, mark]`.
 * call `mark()` once the work succeeded (a copy, a save); while `done` is
 * true the button shows its done label and `data-done="true"`. */
export function useDone({ done_ms = 2000 }: { done_ms?: number } = {}) {
  const [done, set_done] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // a mark inside the window starts it over: the latest success is the one
  // the done look reports
  const mark = useCallback(() => {
    clearTimeout(timer.current);
    set_done(true);
    timer.current = setTimeout(() => set_done(false), done_ms);
  }, [done_ms]);
  return [done, mark] as const;
}
