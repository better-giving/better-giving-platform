import { Combobox } from "@ark-ui/react/combobox";
import { useFilter } from "@ark-ui/react/locale";
import { Check, Search, X } from "lucide-react";
import {
  type PropsWithChildren,
  type ReactNode,
  type Ref,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ornament_row_cls } from "../form/ornament";
import { DrawerIcon } from "../icon";
import { use_dialog_container } from "../use-dialog-container";
import { FieldFrame } from "./internal/field-frame";
import { use_opt } from "./internal/opt";
import { Options } from "./internal/options";
import { Popup } from "./internal/popup";
import { Status } from "./internal/status";
import { use_collection } from "./internal/use-collection";
import type { FieldProps, Opt, StaticSource } from "./types";

export interface Props<T> extends FieldProps, Opt<T> {
  values: readonly T[];
  on_change: (v: T[]) => void;
  options: StaticSource<T>;
  /** renders the Reset action beside select-all/deselect-all */
  on_reset?: () => void;
  ref?: Ref<HTMLInputElement>;
}

/**
 * multi-select over the combobox machine. shares `internal/` with `Combo` but
 * not its interface: the value is a list, the control renders removable tags,
 * and zag forces `selectionBehavior: "clear"` under `multiple`, so the search
 * box empties after every pick rather than showing the selection.
 */
export function MultiCombo<T>({ ref, ...p }: Props<T>) {
  const ctrl_ref = useRef<HTMLDivElement>(null);
  const dialog = use_dialog_container(ctrl_ref);
  const { contains } = useFilter({ sensitivity: "base" });
  const opt = use_opt(p);
  const [query, set_query] = useState("");
  const err_id = useId();

  const filtered = useMemo(
    () =>
      query ? p.options.filter((o) => contains(opt.text(o), query)) : p.options,
    [p.options, query, contains, opt]
  );

  const { rows, collection } = use_collection({
    items: filtered,
    selected: p.values,
    key: opt.key,
    label: opt.text,
  });

  // resolve against the FULL list, not the collection: a pick made while a
  // query is narrowing the rows must not drop the values it filtered out.
  const by_key = useMemo(
    () => new Map(p.options.map((o) => [opt.key(o), o])),
    [p.options, opt]
  );

  const selected_keys = p.values.map(opt.key);
  const all_selected = p.values.length === p.options.length;

  return (
    <FieldFrame
      label={p.label}
      required={p.required}
      error={p.error}
      error_id={err_id}
      disabled={p.disabled}
      classes={{ container: p.classes?.container, label: p.classes?.label }}
    >
      <Combobox.Root
        multiple
        collection={collection}
        disabled={p.disabled}
        value={selected_keys}
        onValueChange={(e) =>
          p.on_change(
            e.value.map((k) => by_key.get(k)).filter((v) => v != null)
          )
        }
        onInputValueChange={(e) => set_query(e.inputValue)}
        positioning={{ placement: "bottom", gutter: 8 }}
        openOnClick
      >
        <Combobox.Control
          ref={ctrl_ref}
          aria-invalid={!!p.error}
          aria-disabled={p.disabled}
          className={`${p.classes?.control ?? ""} selector-btn field-input min-h-12 relative flex-wrap gap-2 focus-within:outline-2 outline-ring aria-invalid:border-destructive p-1 pr-10`}
        >
          <div className="flex flex-wrap gap-2 h-full">
            {p.values.map((v) => (
              <Tag
                key={opt.key(v)}
                label={opt.render(v)}
                name={opt.text(v)}
                on_remove={() =>
                  p.on_change(p.values.filter((x) => opt.key(x) !== opt.key(v)))
                }
              />
            ))}
            <div className="bg-surface inline-flex items-center gap-2 text-gray-11 pl-3 rounded">
              <Search className="icon-xl" />
              {/* the one focusable input in this control: it is both the search
                  box and what an external `ref` (RHF error focus) lands on. */}
              <Combobox.Input
                ref={ref}
                placeholder={p.placeholder}
                aria-required={p.required || undefined}
                aria-describedby={p.error ? err_id : undefined}
                className="appearance-none bg-transparent first:pl-3 focus:outline-hidden h-10"
              />
            </div>
          </div>
          {/* pinned to the first tag row, not centered: this control grows with
              the selected tags, so `top-1/2` would float the chevron mid-block.
              that rules out the full-height lane every other field ornament
              gets, so `ornament_row_cls` sizes a 24px-clearing box around the
              glyph and leaves it pinned. */}
          <Combobox.Trigger className={ornament_row_cls}>
            <Combobox.Context>
              {(api) => <DrawerIcon is_open={api.open} className="icon-xl" />}
            </Combobox.Context>
          </Combobox.Trigger>
        </Combobox.Control>

        <Popup
          parts={{
            Positioner: Combobox.Positioner,
            Content: Combobox.Content,
          }}
          container={dialog}
          vars={p.popup_vars}
          classes={p.classes?.options}
        >
          {rows.length > 0 && (
            <div className="flex justify-between p-4">
              {all_selected ? (
                <Action on_click={() => p.on_change([])}>Deselect all</Action>
              ) : (
                <Action on_click={() => p.on_change([...p.options])}>
                  Select all
                </Action>
              )}
              {p.on_reset && <Action on_click={p.on_reset}>Reset</Action>}
            </div>
          )}
          <Options
            items={rows}
            item_key={opt.key}
            render={opt.render}
            indicator={<Check className="text-primary icon-md" />}
            classes={p.classes?.option}
          />
          <Status query={query} count={rows.length} />
        </Popup>
      </Combobox.Root>
    </FieldFrame>
  );
}

/** `label` is what the tag shows, `name` what its remove button announces —
 *  a rendered label may be a logo or a badge with no text in it. */
function Tag(p: { label: ReactNode; name: string; on_remove: () => void }) {
  return (
    <div className="flex items-center px-3 gap-2 h-10 bg-secondary border rounded font-semibold text-gray-12 capitalize">
      {/* `space-x-2`, not `flex gap-2`: a `render` that returns several nodes
          (a flag beside a name) needs them spaced, but this span is the one
          that truncates, and text-overflow needs its children to stay inline. */}
      <span className="max-w-[200px] truncate space-x-2">{p.label}</span>
      {/* the glyph reads quieter than the label it removes, but the box holds
          24px: the glyph is the affordance, the box is the target. */}
      <button
        type="button"
        aria-label={`Remove ${p.name}`}
        className="grid place-items-center shrink-0 size-6 rounded text-gray-11 hover:text-gray-12 focus-visible:outline-2 outline-ring"
        onClick={(e) => {
          e.preventDefault();
          p.on_remove();
        }}
      >
        <X className="icon-md" />
      </button>
    </div>
  );
}

function Action(p: PropsWithChildren<{ on_click: () => void }>) {
  return (
    <button
      type="button"
      className="text-primary hover:text-primary hover:underline"
      onClick={p.on_click}
    >
      {p.children}
    </button>
  );
}
