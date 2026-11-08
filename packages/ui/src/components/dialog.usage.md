# dialog

Registry item `dialog` (files: `components/modal.tsx`, `stripe-challenge.ts`, `helpers/dialog-name.ts`, `ejected-focus.ts`, `modal-box.ts`). Needs the `tokens` item, `react` and `@ark-ui/react`.

## API

`import { Modal } from "./components/modal"`. A controlled modal dialog on Ark UI.

- `open` (required), `onClose` (required, called when the dialog asks to close).
- `size`: one of the `modal_box` tiers, default `"sm"`:
  - `panel` 448px, `sm` 512px, `md` 672px, `lg` 768px: centered boxes with a 90vw cap on small screens.
  - `sheet` 480px dialog that becomes a full-viewport sheet below the `sm` breakpoint.
  - `donate`: deprecated alias of `sheet` with the same box; use `sheet`.
  - `"none"`: no geometry, only the stacking context; bring your own position and size through `classes`.
- `title`: the accessible name, read to screen readers only. Without it the dialog is named by its first heading.
- `busy`: holds the dialog open against Escape and outside clicks, for example while submitting.
- `onExitComplete`: fired after the close animation, once the content is unmounted.
- `returnFocusFallback`, `initialFocusEl`: focus control (where focus returns when the opener is gone; what focuses on open).
- `adoptStripeChallenge`: off by default; keeps a body-level third-party challenge frame usable above the dialog.
- `classes`: appended to the content box.

Content is the children; put a `Dialog.CloseTrigger` or your own controls inside.

## Accessibility

Focus is trapped while open and returns to the opener on close (or to the fallback). Escape and outside click close it unless `busy`. Motion collapses under `prefers-reduced-motion` through the speed ladder.

## Theming

The box has geometry, elevation (`--shadow-floating`) and stacking only: it paints no background. Give the content its own surface, for example `bg-popover rounded-card p-6` (on the sheet size, add `flex-1` so the surface fills the full-viewport sheet on small screens). The backdrop is `--overlay` (the page ink at 30% in light, black at 60% in dark). Corners are `--radius-card`.
