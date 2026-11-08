/**
 * the app's single import path into the design system: the published
 * components (re-exported from `./design-system`), plus the surface the app
 * needs that the design agent must never be handed —
 * `Form`/`RmxForm`/`useRmxForm` bind to react-router,
 * `FloatingField`/`FloatingInput` are the second field language (a property of
 * a field GROUP, never a control variant), and the rest are helpers that only
 * look like components to an extractor reading names off a barrel.
 *
 * `Tooltip` and `HoverCard` are flattened here like every other component, but
 * their PARTS are not: `./tooltip` and `./hover-card` both export `Arrow` and
 * `Content`, and a flat barrel can only hold one of each — so a caller needing
 * the parts takes the subpath, which is nearly all of them. `./masks` is
 * subpath-only outright, a namespace pair (`dollar`, `ein`) for that same
 * collision.
 */
import type { ComponentProps } from "react";
import type { Badge } from "./components/badge";

// not in the published set: `AskHost` renders nothing of its own — it is where
// `ask` mounts whatever it was handed — and `ask`/`ask_prompt` are functions.
export {
  _reset_asks,
  type AskFn,
  AskHost,
  type AskOpts,
  type AskProps,
  ask,
  use_ask,
} from "./components/ask/ask";
export { ask_prompt, use_ask_prompt } from "./components/ask/ask-prompt";
export type { FileOutput, FileSpec } from "./components/file-dropzone/types";
export {
  FloatingField,
  FloatingInput,
} from "./components/form/floating-field";
export {
  Fieldset,
  Form,
  RmxForm,
  useRmxForm,
} from "./components/form/form";
export { ornament_end_cls } from "./components/form/ornament";
export type { Classes as FormClasses } from "./components/form/types";
// not in the published set: it renders an sr-only bait input with no visual
// state at all, so there is nothing for the design agent to see or vary.
export { Honeypot } from "./components/honeypot";
export type { PayoutStatusType } from "./components/payout-status";
export { popup_anim } from "./components/popup";
export type { IPrompt } from "./components/prompt/prompt";
export type { Props as ComboProps } from "./components/select/combo";
export type { Props as MultiComboProps } from "./components/select/multi-combo";
export type { Props as SelectProps } from "./components/select/select";
export type {
  AsyncSource,
  FieldProps,
  Opt,
  QuerySource,
  Source,
  StaticSource,
  SyncSource,
} from "./components/select/types";
export type { StatusProps } from "./components/status/types";
// not in the published set: parts of `Tabs`, not cards of their own.
export { Tab, TabList, TabPanel } from "./components/tabs";
/** the registry badge exports no type for its variants; derived so call sites can type a map of them */
export type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;
export type { ITarget, TTarget } from "./components/target";
export { smart_next, to_target } from "./components/target";
export { show_toast } from "./components/toaster";
export * from "./design-system";
export type {
  ApplicationMIMEType,
  ImageMIMEType,
  MIMEType,
} from "./types/mime";
