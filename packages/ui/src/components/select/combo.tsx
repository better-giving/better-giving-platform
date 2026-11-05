import { Combobox } from "@ark-ui/react/combobox";
import { useFilter } from "@ark-ui/react/locale";
import { X } from "lucide-react";
import {
  type ReactNode,
  type Ref,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ornament_end_cls,
  ornament_end_inboard_cls,
  ornament_start_cls,
} from "../form/ornament";
import { use_dialog_container } from "../use-dialog-container";
import { RESULT_LIMIT } from "./classes";
import { FieldFrame } from "./internal/field-frame";
import { use_opt } from "./internal/opt";
import { Options } from "./internal/options";
import { Popup } from "./internal/popup";
import { Status } from "./internal/status";
import { use_collection } from "./internal/use-collection";
import { SelectedInputSync } from "./internal/use-selected-input";
import { use_source } from "./internal/use-source";
import type { FieldProps, Opt, Source } from "./types";

/**
 * `FieldProps["classes"]`, plus the one slot only a combobox can offer: the
 * control's own box.
 */
type Classes = NonNullable<FieldProps["classes"]> & {
  /**
   * the control's input box, REPLACING the default `field-input` chrome — never
   * appended to it. present → the caller draws the border, height, padding and
   * whatever room the adornment needs, which is what lets this control sit
   * inside a box its HOST already drew: the donation form's currency combobox
   * shares one `field-input-container` with the amount input beside it, and a
   * `field-input` here would be a box inside a box. absent → the control draws
   * the full field box itself.
   *
   * the same rule `internal/field-frame` runs on `label` — a slot's presence
   * hands ownership to the caller, whole. the two sets are never merged: they
   * collide on every property they share, and which one wins is sheet order,
   * not the order they were written in.
   */
  input?: string;
};

export interface Props<T> extends Omit<FieldProps, "classes">, Opt<T> {
  classes?: Classes;
  value: T | undefined;
  /** `undefined` when the value is cleared — the caller decides what empty is */
  on_change: (v: T | undefined) => void;
  options: Source<T>;
  /** rows rendered from the filtered list; default `RESULT_LIMIT` */
  limit?: number;
  /**
   * matcher over `item_text(v)`; default `useFilter({ sensitivity: "base" }).contains`.
   *
   * an `AsyncSource` does its own matching, so nothing here runs for one.
   */
  filter?: (text: string, q: string) => boolean;
  /** the trigger at the trailing edge: the drawer chevron, a spinner */
  adornment?: (open: boolean, state: "idle" | "loading" | "error") => ReactNode;
  /**
   * decoration at the leading edge — the selected country's flag. not a
   * trigger and hidden from assistive tech (the input's text already names
   * the value): a click passes through to the input, which opens the list.
   */
  lead?: ReactNode;
  /** offer an X that empties the field */
  clearable?: boolean;
  /** the popup tracks the control's width unless the host says otherwise */
  popup_width?: string;
  /** drawn on the selected row only — ark hides it on the rest */
  indicator?: ReactNode;
  /**
   * the typed text is a value in its own right — ark's `allowCustomValue`.
   *
   * only coherent when the option type IS its own text: the row offered for a
   * query is the query, and nothing can widen a string into an arbitrary `T`.
   * so the prop is `never` for every other option type — reaching for it there
   * is a type error at the call site rather than a string smuggled into a
   * collection of objects. bracketed so a union option type has to be string
   * all the way through instead of distributing to `boolean`.
   */
  allow_custom?: [T] extends [string] ? boolean : never;
  /** help text under the label, named as the input's description */
  sub?: string;
  on_reset?: () => void;
  ref?: Ref<HTMLInputElement>;
}

/**
 * single-select over the combobox machine — text entry, filtering, one value.
 *
 * `inputValue` is deliberately NOT controlled: that is what lets zag keep the
 * displayed text in step with an externally-changed value (RHF `reset()`), and
 * `internal/use-selected-input` documents the whole contract.
 *
 * the chrome is the caller's the moment it says so — `classes.input` present
 * and this draws no field box, so the control can live inside one its host
 * already drew.
 */
export function Combo<T>({ ref, ...p }: Props<T>) {
  const ctrl_ref = useRef<HTMLDivElement>(null);
  const dialog = use_dialog_container(ctrl_ref);
  const { contains } = useFilter({ sensitivity: "base" });
  const opt = use_opt(p);
  const src = use_source(p.options);
  const [query, set_query] = useState("");
  // the open can fire in the same tick as the keystroke that caused it, before
  // `query` state has settled — the ref is what the open reads
  const query_ref = useRef("");
  const err_id = useId();
  const sub_id = useId();
  // the hint is read before the error: the error alone loses the guidance
  // that would fix it
  const described =
    [p.sub ? sub_id : undefined, p.error ? err_id : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  const limit = p.limit ?? RESULT_LIMIT;
  const match = p.filter ?? contains;
  // the prop's conditional type is the guard; past it this is just a flag
  const allow_custom = p.allow_custom as boolean | undefined;

  const filtered = useMemo(() => {
    const base =
      query && !src.searched
        ? src.items.filter((v) => match(opt.text(v), query))
        : src.items;
    const rows = base.slice(0, limit);
    // a custom value still has to be SELECTED to become the value —
    // `allowCustomValue` only stops zag reverting the text, it never emits.
    // so the query rides along as a row, unless the list already offers it.
    if (!allow_custom || !query) return rows;
    if (rows.some((v) => opt.key(v) === query)) return rows;
    // sound because `allow_custom` is reachable only where `T` IS string
    return [query as T, ...rows].slice(0, limit);
  }, [src.items, src.searched, query, match, opt, limit, allow_custom]);

  const selected = useMemo(() => (p.value == null ? [] : [p.value]), [p.value]);

  const { rows, collection } = use_collection({
    items: filtered,
    selected,
    key: opt.key,
    label: opt.text,
  });

  // a query source still loading, or one that failed, has nothing to offer;
  // leaving the control open would present an empty list as if it were the
  // answer. a searched source is the opposite case — its loading IS the
  // keystroke, and taking the input away is the one thing it must not do.
  const disabled =
    p.disabled || (!src.searched && (src.loading || !!src.error));
  const has_clear = !!p.clearable && p.value != null;

  // the clear X and the adornment are separate lanes, so both being present is
  // a layout, not a collision — and the input reserves room for the lanes it
  // actually has instead of one lane's worth either way.
  const end_lanes = (p.adornment ? 1 : 0) + (has_clear ? 1 : 0);

  const input_cls =
    p.classes?.input ??
    `field-input w-full h-full ${p.lead ? "pl-12" : ""} ${
      end_lanes === 2 ? "pr-24" : end_lanes === 1 ? "pr-12" : ""
    }`;

  return (
    <FieldFrame
      label={p.label}
      required={p.required}
      error={p.error}
      error_id={err_id}
      sub={p.sub}
      sub_id={sub_id}
      disabled={disabled}
      classes={{ container: p.classes?.container, label: p.classes?.label }}
    >
      <Combobox.Root<T>
        collection={collection}
        disabled={disabled}
        // absent, not `false`, when there is no error of its own: ark spreads
        // the caller's props over the field context and drops only undefined,
        // so a literal false shadows an enclosing Field.Root's invalid state.
        invalid={p.error ? true : undefined}
        value={p.value == null ? [] : [opt.key(p.value)]}
        onValueChange={(e) => p.on_change(e.items[0])}
        // only typing narrows the list. every other reason zag reports —
        // item-select, clear-trigger, the sync below — means the text now
        // describes the value, not a search, and a searched source must not
        // spend a request on one: that would be a fetch per selection.
        onInputValueChange={(e) => {
          const typed = e.reason === "input-change";
          query_ref.current = typed ? e.inputValue : "";
          set_query(query_ref.current);
          if (typed) src.on_query(e.inputValue);
        }}
        // a searched source has nothing until it is asked
        onOpenChange={(e) => {
          if (e.open) src.on_open(query_ref.current);
        }}
        positioning={{ placement: "bottom-start", gutter: 8 }}
        allowCustomValue={allow_custom}
        openOnClick
      >
        {/* zag guards its own revert with `not("allowCustomValue")`; the sync
            has to match it, or it deletes the text that IS the value. */}
        {!allow_custom && <SelectedInputSync />}
        <Combobox.Control
          ref={ctrl_ref}
          className={`relative ${p.classes?.control ?? ""}`}
        >
          <Combobox.Input
            ref={ref}
            placeholder={p.placeholder}
            aria-required={p.required || undefined}
            aria-describedby={described}
            spellCheck={false}
            className={input_cls}
          />
          {p.lead && (
            <span
              aria-hidden
              className={`${ornament_start_cls} pointer-events-none`}
            >
              {p.lead}
            </span>
          )}
          {p.adornment && (
            <Combobox.Trigger
              className={
                has_clear ? ornament_end_inboard_cls : ornament_end_cls
              }
            >
              <Combobox.Context>
                {(api) => p.adornment?.(api.open, src.state)}
              </Combobox.Context>
            </Combobox.Trigger>
          )}
          {has_clear && (
            <Combobox.Context>
              {(api) => (
                <Combobox.ClearTrigger
                  disabled={disabled}
                  onClick={() => {
                    p.on_reset?.();
                    // ClearTrigger clears + focuses the input; reopen so the
                    // field isn't left focused over a closed empty list
                    queueMicrotask(() => api.setOpen(true));
                  }}
                  className={`group ${ornament_end_cls} text-gray-11`}
                >
                  {/* the fill is the glyph's, not the lane's: a full-height
                      lane painted on hover would cover the field's edge. -m-1
                      keeps the lane 16px wide, so the inboard lane still abuts */}
                  <span className="flex -m-1 p-1 rounded group-hover:bg-gray-4 group-active:bg-gray-5">
                    <X className="icon-md" />
                  </span>
                </Combobox.ClearTrigger>
              )}
            </Combobox.Context>
          )}
        </Combobox.Control>

        <Popup
          parts={{
            Positioner: Combobox.Positioner,
            Content: Combobox.Content,
          }}
          container={dialog}
          vars={p.popup_vars}
          width={p.popup_width}
          classes={p.classes?.options}
        >
          <Options
            items={rows}
            item_key={opt.key}
            render={opt.render}
            indicator={p.indicator}
            classes={p.classes?.option}
          />
          <Status
            loading={src.loading}
            error={src.error}
            query={query}
            // what the query produced, apart from what the popup ends up
            // showing: a selection `use_collection` rehydrated is by definition
            // a row the query did NOT match, and counting it as one hides the
            // "not found" line behind it.
            count={filtered.length}
            shown={rows.length}
          />
        </Popup>
      </Combobox.Root>
    </FieldFrame>
  );
}
