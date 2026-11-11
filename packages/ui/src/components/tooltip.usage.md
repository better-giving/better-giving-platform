# tooltip

Registry item `tooltip` (files: `components/tooltip.tsx`, `components/popup.ts`). Needs the `tokens` item, `react` and `@ark-ui/react`.

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
- `Arrow` is accepted inside `Content` and renders nothing; the arrow is drawn by `Tooltip`.
- `popup_anim` and `popup_shell` (from `./popup`) are the shared motion and shell strings for other anchored popups.

## Accessibility

Opens on hover and keyboard focus, closes on Escape and blur. The wrapped trigger is described by a hidden copy of the tip text, so the description exists while the tip is closed. Do not put a wrapped child inside an `<a>` or `<button>`; the component warns in development.

## Theming

Fill is `--popover`, shadow `--shadow-floating`, corner `--radius-card`, layer `z-floating`. These are roles over scale steps, so a theme or `.dark` recolors the tip.
