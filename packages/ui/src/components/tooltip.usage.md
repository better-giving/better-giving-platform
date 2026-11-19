# tooltip

Registry item `tooltip` (files: `components/tooltip.tsx`, `components/popup.ts`, `helpers/theme-host.ts`). Needs the `tokens` item, `react` and `@ark-ui/react`.

## API

`import { Tooltip, Content, Arrow } from "./components/tooltip"`.

```tsx
<Tooltip tip={<Content>Refunds take 3 days</Content>}>
  <button type="button">Refunds</button>
</Tooltip>
```

- `tip` (required): a `Content` element holding the tip. `Content` takes the shared popup shell (floating fill, 12px corner, shadow, padding); extra `className` is appended for width or type size, never for a fill or an edge.
- `children`: one element. A button, link or input is the trigger itself; anything else (an icon, a span) is wrapped in a button named by its own text, or "More info" when it has none.
- `trigger`: `"child"` makes a component that renders its own button or link the trigger (it must spread the props it gets onto that element); `"wrap"` forces the wrapper. Default is `"child"` for native focusable elements, `"wrap"` otherwise.
- A child trigger's own `id` stays its id, and the tip anchors to it: a part that makes the child its trigger and gives it an id (a `Menu` trigger, a dialog's close) keeps the tip beside the button.
- `Arrow` is accepted inside `Content` and renders nothing; the arrow is drawn by `Tooltip`.
- `popup_anim` and `popup_shell` (from `./popup`) are the shared motion and shell strings for other anchored popups.

## In a portal

The tip renders in a portal, in the nearest element above the trigger that sets a theme (`data-theme`, `.dark` or `.light`) or is an open modal dialog (`aria-modal="true"`), else at the end of `<body>`, and positioned `fixed`, so a tip beside a trigger in a themed area keeps that area's look, and an `overflow: hidden` area does not clip it. `helpers/theme-host.ts` does the lookup, for the `menu`, `nav-list` and `select` items too. A box of your own around a trigger with a `transform`, `translate` or `scale` becomes the tip's containing block and can clip it.

## Accessibility

Opens on hover and keyboard focus, closes on Escape and blur. The wrapped trigger is described by a hidden copy of the tip text, so the description exists while the tip is closed. Do not put a wrapped child inside an `<a>` or `<button>`; the component warns in development.

## Theming

Fill is `--popover`, a 1px `--hairline` edge (the arrow tip draws it on its two outer sides, over the tip's base), shadow `--shadow-floating`, corner `--radius-card`, layer `z-floating`, set on the positioner as well, so a tip opened in a dialog, sheet or drawer paints over it. Every floating surface carries the edge, so none is told from the page by its shadow alone. These are roles over scale steps, so a theme or `.dark` recolors the tip.
