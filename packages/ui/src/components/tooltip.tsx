import { Portal } from "@ark-ui/react/portal";
import { Tooltip as ArkTooltip } from "@ark-ui/react/tooltip";
import {
  type ComponentProps,
  Fragment,
  isValidElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { popup_anim, popup_shell } from "./popup";

// no-op: the arrow is rendered by `Tooltip` itself
// as a sibling of `Content` inside `Positioner` (the only structure ark-ui
// will position via popper). callers may render `<Arrow />`; it
// renders nothing.
export function Arrow() {
  return null;
}

export function Content({
  className = "",
  ...props
}: ComponentProps<typeof ArkTooltip.Content>) {
  return (
    <ArkTooltip.Content
      className={`${popup_anim} ${popup_shell} ${className}`}
      {...props}
    />
  );
}

// a child of one of these tags is focusable and named on its own, so it becomes
// the trigger itself; anything else (an svg, a span) is wrapped in a button.
const FOCUSABLE = new Set(["button", "a", "input", "select", "textarea"]);
const INTERACTIVE = "button, a[href], input, select, textarea, [tabindex]";

// the ring goes on the glyph, not the button: a glyph positioned `absolute`
// leaves its wrapping button with no box to outline.
// the `::after` overlays a 24px hit area (WCAG 2.5.8) centred on the button
// without growing the line it sits in. it needs the button positioned, which
// would re-anchor an `absolute` glyph — so that glyph keeps its own box.
const wrap_trigger = [
  "outline-0 focus-visible:*:outline-2 focus-visible:*:outline-ring focus-visible:*:outline-offset-2",
  "not-has-[>.absolute]:relative not-has-[>.absolute]:after:absolute",
  "after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2",
  "after:size-6 after:min-w-full after:min-h-full",
].join(" ");

const BLOCK = new Set(["p", "div", "li", "br", "ul", "ol"]);

// text a node renders, read off the element tree: a component's output is
// unknowable before it renders, so it contributes nothing (icons included).
function text_of(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return `${node}`;
  if (Array.isArray(node)) return node.map(text_of).join("");
  if (!isValidElement<{ children?: ReactNode }>(node)) return "";
  if (node.type === Fragment) return text_of(node.props.children);
  if (typeof node.type !== "string") return "";
  const inner = text_of(node.props.children);
  return BLOCK.has(node.type) ? ` ${inner} ` : inner;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

interface Props {
  /** must be wrapped by Content */
  tip: ReactNode;
  /** a button, link or input element is the trigger itself; anything else is
   * wrapped in a button named by its own text, or "More info" when it has none,
   * and described by the tip's text. never put a wrapped child inside an
   * `<a>`/`<button>` (e.g. `VerifiedIcon` in a linked name). */
  children: React.JSX.Element;
  /** "child" makes a component that renders its own button or link the trigger
   * (it must spread the props it is given onto that element); defaults to
   * "child" for a native focusable element and "wrap" for anything else */
  trigger?: "wrap" | "child";
}
export function Tooltip(props: Props) {
  const [open, set_open] = useState(false);
  const name_id = useId();
  const desc_id = useId();
  const wrap_ref = useRef<HTMLButtonElement>(null);
  const as_child =
    props.trigger === "child" ||
    (props.trigger === undefined &&
      typeof props.children.type === "string" &&
      FOCUSABLE.has(props.children.type));

  useEffect(() => {
    const el = wrap_ref.current;
    // cast: not every consumer's tsconfig (design-sync) carries vite's ImportMeta types
    const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
    if (!dev || !el) return;
    if (el.querySelector(INTERACTIVE)) {
      console.warn(
        'Tooltip wrapped a child that renders its own interactive element in a second button; pass trigger="child".',
        el
      );
    }
    if (el.parentElement?.closest("a[href], button")) {
      console.warn(
        "Tooltip's button sits inside a link or button; move the Tooltip outside it.",
        el
      );
    }
  }, []);

  const own_text = as_child ? "" : squash(text_of(props.children));
  const tip_text = squash(
    text_of(
      isValidElement<{ children?: ReactNode }>(props.tip)
        ? props.tip.props.children
        : props.tip
    )
  );

  return (
    <ArkTooltip.Root
      open={open}
      onOpenChange={(e) => set_open(e.open)}
      openDelay={50}
      closeOnClick={false}
      // unmount positioner (and arrow) once content's exit animation ends,
      // otherwise the arrow lingers after content hides.
      lazyMount
      unmountOnExit
      positioning={{ gutter: 4 }}
    >
      {as_child ? (
        <ArkTooltip.Trigger onClick={() => set_open(true)} asChild>
          {props.children}
        </ArkTooltip.Trigger>
      ) : (
        <ArkTooltip.Trigger
          ref={wrap_ref}
          type="button"
          onClick={() => set_open(true)}
          className={wrap_trigger}
          // a hidden label, not aria-label: an ancestor named through its own
          // aria-labelledby (a radio's label) skips a nested labelledby, so the
          // fallback stays out of its name.
          aria-labelledby={own_text ? undefined : name_id}
          // zag describes the trigger by the content only while it is open,
          // and the content is unmounted when closed — so the description is a
          // hidden copy of the tip's text. a tip whose text sits in components
          // has no copy and keeps zag's open-only description.
          aria-describedby={tip_text ? desc_id : undefined}
        >
          {props.children}
        </ArkTooltip.Trigger>
      )}
      {!as_child && !own_text && (
        <span id={name_id} hidden>
          More info
        </span>
      )}
      {!as_child && tip_text && (
        <span id={desc_id} hidden>
          {tip_text}
        </span>
      )}
      <Portal>
        <ArkTooltip.Positioner className="[--arrow-size:10px] [--arrow-background:var(--card)]">
          <ArkTooltip.Arrow>
            <ArkTooltip.ArrowTip />
          </ArkTooltip.Arrow>
          {props.tip}
        </ArkTooltip.Positioner>
      </Portal>
    </ArkTooltip.Root>
  );
}
