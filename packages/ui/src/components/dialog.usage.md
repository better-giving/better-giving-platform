# dialog

Registry item `dialog` (files: `components/modal.tsx`, `stripe-challenge.ts`, `helpers/dialog-name.ts`, `ejected-focus.ts`, `modal-box.ts`). Needs the `tokens` item, `react` and `@ark-ui/react`.

## API

`import { Modal } from "./components/modal"`. A controlled modal dialog on Ark UI.

- `open` (required), `onClose` (required, called when the dialog asks to close).
- `size`: one of the `modal_box` tiers, default `"sm"`:
  - `panel` 448px, `sm` 512px, `md` 672px, `lg` 768px: centered boxes with a 90% (of the viewport's width) cap on small screens. They are centered by `inset-0 inset-be-[calc(100dvh*var(--ds-view-lift,0.2))] m-auto block-fit` (the bottom edge is `--ds-view-lift`, 0.2, of the viewport's height up, so the box's middle sits at 40% of it, and its height is capped at that space, 90dvh at most, so its top never leaves the viewport), never a transform, so a menu opened inside one floats over its edge instead of being clipped by its scroll.
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

The box has geometry, elevation (`--shadow-floating` and a 1px `--hairline` edge; the `sheet` size draws the edge only from `sm`, where it stops filling the viewport) and stacking only: it paints no background. Give the content its own surface, for example `bg-popover rounded-card p-6`. On the sheet size use `min-h-0 flex-1 overflow-y-auto scrollbars rounded-card max-sm:rounded-none bg-popover p-6`: the surface fills the sheet and scrolls its own height with the thin scrollbar, and goes square below `sm`, where the sheet is the whole viewport and a corner would show the backdrop. The backdrop is `--overlay` (the page ink at 30% in light, black at 60% in dark). Corners are `--radius-card`.
