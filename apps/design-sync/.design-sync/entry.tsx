// curated design-system entry for /design-sync.
//
// packages/ui does have a real barrel now, but this file stays: two of its
// files (tooltip.tsx, hover-card.tsx) both export `Arrow`/`Content`, so the
// converter's `export *` synth entry would collide, and DsProvider below has
// nowhere else to live. one named export per published component, plus the
// provider previews mount in.
//
// imports point at each component's implementation FILE, not the package
// barrel: the barrels re-export siblings that drag in assets the converter
// has no loader for (image/index.ts → dapp-logo.tsx → .webp). paths mirror
// cfg.componentSrcMap — regenerate both together, noting the two bases differ
// (these are relative to this file; the config's are relative to PKG_DIR,
// which is apps/design-sync).

import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

// components that call useNavigate/NavLink (Prompt, Breadcrumbs) throw outside
// a router. previews mount through this via cfg.provider.
export function DsProvider({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

// content
export { Accordion } from "../../../packages/ui/src/components/accordion";
export { Amount } from "../../../packages/ui/src/components/amount";
export { Badge } from "../../../packages/ui/src/components/badge";
export { Breadcrumbs } from "../../../packages/ui/src/components/breadcrumbs";
// the button, and every button-shaped link. first in the file because it is
// the one name a design reaches for before any other.
export { Button } from "../../../packages/ui/src/components/button";
export { ContentLoader } from "../../../packages/ui/src/components/content-loader";
export { Copier } from "../../../packages/ui/src/components/copier/copier";
export { DateField } from "../../../packages/ui/src/components/date-field";
export { DateRangeField } from "../../../packages/ui/src/components/date-range-field";
// what a screen shows where the content it was built around is not there.
// `EmptyRow` is the same block inside the `<tr>` a `<tbody>` will accept.
export {
  EmptyRow,
  EmptyState,
} from "../../../packages/ui/src/components/empty-state";
export { ExtLink } from "../../../packages/ui/src/components/ext-link";
export { FileDropzone } from "../../../packages/ui/src/components/file-dropzone/file-dropzone";
// where a form or a dialog ends: the submit and whatever sits beside it.
// cancel first, and the row stacks full-width on a phone.
export { Actions } from "../../../packages/ui/src/components/form/actions";
export { CheckField } from "../../../packages/ui/src/components/form/check-field";
// forms
export { Field } from "../../../packages/ui/src/components/form/field";
export { Input } from "../../../packages/ui/src/components/form/input";
export { Label } from "../../../packages/ui/src/components/form/label";
export { MaskedInput } from "../../../packages/ui/src/components/form/masked-input";
// mask presets for <MaskedInput mask={...} /> — each is a { format, unmask }
// pair. lowercase, so the converter never mistakes them for components; they
// ride on window.BetterGiving purely so a design can use the REAL ein/dollar
// masks instead of reimplementing them.
export * as masks from "../../../packages/ui/src/components/form/masks";
export { PasswordInput } from "../../../packages/ui/src/components/form/password-input";
export { UrlInput } from "../../../packages/ui/src/components/form/url-input";
export { GoalBar } from "../../../packages/ui/src/components/goal-bar";
export { Group } from "../../../packages/ui/src/components/group";
// the sortable column head: label, then the caret that says which key the
// table is ordered by and in which direction.
export { HeaderButton } from "../../../packages/ui/src/components/header-button";
export {
  Content as HoverCardContent,
  HoverCard,
} from "../../../packages/ui/src/components/hover-card";
export { DrawerIcon } from "../../../packages/ui/src/components/icon/drawer-icon";
export { Image } from "../../../packages/ui/src/components/image/image";
export { ImagePlaceholder } from "../../../packages/ui/src/components/image/image-placeholder";
export { Increments } from "../../../packages/ui/src/components/increments";
// the "View More" foot of a paginated table. `LoadMoreRow` brings its own
// <tfoot>; `LoadMoreTr` is the bare <tr> for a table that already has one.
export {
  LoadMoreRow,
  LoadMoreTr,
} from "../../../packages/ui/src/components/load-more-row";
export { LoadText } from "../../../packages/ui/src/components/load-text";
export { LoaderRing } from "../../../packages/ui/src/components/loader-ring";

// overlays
export { Modal } from "../../../packages/ui/src/components/modal";
export { PayoutStatus } from "../../../packages/ui/src/components/payout-status";
export { Prompt } from "../../../packages/ui/src/components/prompt/prompt";
export { RadioGroup } from "../../../packages/ui/src/components/radio-group";
// selection
export { Combo } from "../../../packages/ui/src/components/select/combo";
export { MultiCombo } from "../../../packages/ui/src/components/select/multi-combo";
export { Select } from "../../../packages/ui/src/components/select/select";
export { Separator } from "../../../packages/ui/src/components/separator";
export { Slider } from "../../../packages/ui/src/components/slider";
export { Confirmed } from "../../../packages/ui/src/components/status/confirmed";
export { ErrorStatus } from "../../../packages/ui/src/components/status/error-status";
export { Info } from "../../../packages/ui/src/components/status/info";
export { LoadingStatus } from "../../../packages/ui/src/components/status/loading-status";
// feedback
export { Status } from "../../../packages/ui/src/components/status/status";
// `TabPanel` is a part of `Tabs`, not a card of its own — see the tooltip parts
// below.
export {
  TabPanel,
  Tabs,
} from "../../../packages/ui/src/components/tabs";
export { Target } from "../../../packages/ui/src/components/target";
// `show_toast` rides along with `Toaster` because it is the component's only
// way to show anything: toasts are pushed imperatively into a module-scope
// manager, never rendered. `Toaster` alone is a mount point that can never
// display a toast, and conventions.md documents the call — same reasoning as
// `masks` above. lowercase, so the converter keeps it out of the component set.
// it is public API: `packages/ui/src/index.ts` exports it too.
export {
  show_toast,
  Toaster,
} from "../../../packages/ui/src/components/toaster";
export { Toggle } from "../../../packages/ui/src/components/toggle";
// both source files export a `Content` that the `tip` prop must be wrapped in.
// renamed here because the two collide in one barrel; lowercase-free names keep
// them out of the converter's component set, which is right — they are parts of
// Tooltip/HoverCard, not cards of their own.
export {
  Content as TooltipContent,
  Tooltip,
} from "../../../packages/ui/src/components/tooltip";
export { VerifiedIcon } from "../../../packages/ui/src/components/verified-icon";
