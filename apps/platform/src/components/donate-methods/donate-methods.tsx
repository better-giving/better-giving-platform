import { unpack } from "@better-giving/ui/helpers";
import { GripVertical } from "lucide-react";
import { Reorder, useDragControls, useMotionValue } from "motion/react";
import { type ReactNode, type Ref, useId, useState } from "react";
import type { TDonateMethod } from "#/types/components";

type Updator = (methods: TDonateMethod[]) => void;
type Classes = {
  container?: string;
  label?: string;
  tooltip?: string;
};

type Props = {
  values: TDonateMethod[];
  on_change: Updator;
  error?: ReactNode;
  classes?: Classes | string;
};

export function DonateMethods({
  values,
  on_change,
  error,
  classes,
  ref,
}: Props & { ref?: Ref<HTMLInputElement> }) {
  const style = unpack(classes);
  const hint_id = useId();
  const [moved, set_moved] = useState("");

  /** the array is owned here — a row asks for a move, it never reorders itself */
  const move = (from: number, to: number) => {
    if (to < 0 || to >= values.length) return;
    const next = values.slice();
    const [method] = next.splice(from, 1);
    next.splice(to, 0, method);
    on_change(next);
    set_moved(`${method.name} moved to position ${to + 1} of ${next.length}`);
  };

  return (
    <div className={style.container}>
      <p className={`${style.label} mb-1 label`}>Donation methods</p>
      <p className={`text-gray-11 ${style.tooltip} mb-2 text-sm`}>
        Here you can turn on/off payment options and change the order of their
        appearance
      </p>
      <p className="text-destructive-subtle-fg text-xs mb-2 empty:hidden">
        {error}
      </p>
      {/** focus this element on error */}
      <input className="sr-only" ref={ref} />
      <Reorder.Group
        axis="y"
        onReorder={(values) => on_change(values.map((v) => JSON.parse(v)))}
        values={values.map((v) => JSON.stringify(v))}
        className="border border-hairline rounded overflow-hidden divide-y divide-hairline"
      >
        {values.map((v, i) => (
          <Method
            value={v}
            key={v.id}
            index={i}
            total={values.length}
            hint_id={hint_id}
            move={(to) => move(i, to)}
            updator={(updated) => {
              const _methods = values.map((v) => {
                if (v.id === updated.id) return updated;
                return v;
              });
              on_change(_methods);
            }}
          />
        ))}
      </Reorder.Group>
      <p id={hint_id} className="sr-only">
        Press the up and down arrow keys to move this method in the list.
      </p>
      {/* the row sliding past its neighbour is a picture, and a picture reports
          nothing to a screen reader. one region for the whole group, always
          mounted with only its text changing — an element inserted at the same
          moment as its text is announced unreliably. */}
      <p role="status" className="sr-only">
        {moved}
      </p>
    </div>
  );
}

interface IMethod {
  value: TDonateMethod;
  index: number;
  total: number;
  hint_id: string;
  move: (to: number) => void;
  updator: (old: TDonateMethod) => void;
}

function Method({ value, index, total, hint_id, move, updator }: IMethod) {
  const y = useMotionValue(0);
  const controls = useDragControls();
  const checkbox_id = useId();
  return (
    <Reorder.Item
      data-unchecked={value.disabled ? "" : undefined}
      value={JSON.stringify(value)}
      dragListener={false}
      dragControls={controls}
      id={value.id}
      style={{ y }}
      className="flex items-center gap-2 px-3 min-h-12 bg-surface hover:bg-gray-4 transition-colors text-gray-12 data-unchecked:text-gray-11 select-none"
    >
      <input
        id={checkbox_id}
        type="checkbox"
        className="checkbox"
        checked={!value.disabled}
        onChange={(e) => {
          updator({ ...value, disabled: !e.target.checked });
        }}
      />
      {/* checkbox, label, grip — the label is the checkbox's target and has to
          touch it, so the grip sits at the trailing edge rather than between
          the two. it stretches to the row's height, so the row toggles nearly
          edge to edge and its step-4 hover is honest. */}
      <label
        htmlFor={checkbox_id}
        className="text-sm grow self-stretch flex items-center py-3 cursor-pointer"
      >
        {value.name}
      </label>
      <button
        type="button"
        aria-label={`Reorder ${value.name}, position ${index + 1} of ${total}`}
        aria-describedby={hint_id}
        className="glyph-btn text-xl focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none cursor-grab disabled:cursor-default"
        onPointerDown={(e) => controls.start(e)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          move(index + (e.key === "ArrowDown" ? 1 : -1));
        }}
        disabled={value.disabled}
      >
        <GripVertical className="icon-xl" />
      </button>
    </Reorder.Item>
  );
}
