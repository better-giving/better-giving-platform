import { Plus } from "lucide-react";
import type {
  ComponentProps,
  KeyboardEvent,
  MouseEvent,
  MouseEventHandler,
  ReactNode,
} from "react";

/** the content card: the in-flow container on the 12px corner, a step-2 fill
 *  and a hairline edge, no shadow. header, body and footer are slots; use the
 *  ones you need. `overflow-clip` keeps a slot's rule inside the corner.
 *  each slot is 24px in from the sides, 16px under `sm` (640px). */
const card_class =
  "overflow-clip rounded-card border border-hairline bg-card text-gray-12";

type Slot<T extends "div" | "section" | "footer" | "header" | "span"> = Omit<
  ComponentProps<T>,
  "className"
> & {
  /** appended last. */
  classes?: string;
};

export function Card({ classes = "", ...props }: Slot<"section">) {
  return <section className={`${card_class} ${classes}`} {...props} />;
}

/** a title and its aside. a heading inside it takes the display face. with a
 *  `CardStatus` child it is a row, the status at the end on the title's first
 *  line (`card-header` in components.css). set the title's size on the header,
 *  not the heading, so the status's line is the title's. */
export function CardHeader({ classes = "", ...props }: Slot<"header">) {
  return (
    <header
      className={`card-header border-be border-hairline px-4 py-4 sm:px-6 ${classes}`}
      {...props}
    />
  );
}

/** the box for a status, badge, count or icon beside text that can wrap: one
 *  line tall at the inherited line-height, the mark centred in it, so in a row
 *  aligned to the start it sits on the text's first line. */
export function CardStatus({ classes = "", ...props }: Slot<"span">) {
  return <span className={`card-status ${classes}`} {...props} />;
}

export function CardBody({ classes = "", ...props }: Slot<"div">) {
  return <div className={`px-4 py-5 sm:px-6 ${classes}`} {...props} />;
}

/** the actions row. it sits on the well fill, one rung in from the card. */
export function CardFooter({ classes = "", ...props }: Slot<"footer">) {
  return (
    <footer
      className={`flex items-center-safe gap-3 border-bs border-hairline bg-panel px-4 py-4 sm:px-6 ${classes}`}
      {...props}
    />
  );
}

type CreateCommon = {
  /** the label, and the whole accessible name: the icon is hidden. */
  children: ReactNode;
  /** renders `aria-disabled="true"`: the card stays focusable, so a reason
   *  beside it can be reached, and the activation is blocked. */
  disabled?: boolean;
  /** appended last. */
  classes?: string;
};

type CreateLink = CreateCommon &
  Omit<ComponentProps<"a">, "className" | "children" | "onClick"> & {
    href: string;
    onClick?: never;
  };

type CreateButton = CreateCommon &
  Omit<
    ComponentProps<"button">,
    "className" | "children" | "type" | "disabled" | "onClick"
  > & {
    onClick: MouseEventHandler<HTMLButtonElement>;
    href?: never;
  };

const stop = (e: MouseEvent | KeyboardEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/** the card that starts creating a new one: `href` renders a link, `onClick`
 *  a button. a Plus above the label; in a grid it takes the row's height. */
export function CardCreate(props: CreateLink | CreateButton) {
  const { children, disabled = false, classes = "" } = props;
  const body = (
    <>
      <Plus aria-hidden="true" />
      {children}
    </>
  );
  const off = disabled ? { "aria-disabled": true as const } : {};
  if (props.href !== undefined) {
    const {
      children: _c,
      disabled: _d,
      classes: _cl,
      onClick: _o,
      ...rest
    } = props;
    // an anchor has no disabled state: Enter is stopped as well as the click,
    // since a handler further up can act on the key before the click fires
    return (
      <a
        {...rest}
        {...off}
        {...(disabled && {
          onClick: stop,
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Enter") stop(e);
          },
        })}
        className={`card-create ${classes}`}
      >
        {body}
      </a>
    );
  }
  const {
    children: _c,
    disabled: _d,
    classes: _cl,
    href: _h,
    onClick,
    ...rest
  } = props;
  return (
    <button
      {...rest}
      {...off}
      type="button"
      onClick={disabled ? stop : onClick}
      className={`card-create ${classes}`}
    >
      {body}
    </button>
  );
}
