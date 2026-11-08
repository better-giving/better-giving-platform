# badge

Registry item `badge` (file: `components/badge.tsx`). Needs the `tokens` item and `react`.

## API

`import { Badge } from "./components/badge"`.

```tsx
<Badge variant="success">Verified</Badge>
```

- `variant`: `"neutral" | "primary" | "success" | "warning" | "destructive"`, default `"neutral"`. Every variant is a tinted chip: a subtle fill with its subtle ink, at `text-xs`.
- `classes`: appended last.
- Other `span` attributes pass through.

A badge is a status label, not a control. For an action use `Button`.

## Accessibility

Plain text in a `span`; the meaning must be in the words, not only in the color. Ink and fill pairs are the palette's recorded text pairs (Lc 60 or more in the default theme, light; dark figures are recorded in the theme tests).

## Theming

Variants map to `--gray-3` with `gray-12` ink (neutral), `--secondary` with `accent-12` ink (primary), and the `-subtle` and `-subtle-fg` roles of the status scales. A theme or `.dark` recolors them.
