# badge

Registry item `badge` (file: `components/badge.tsx`). Needs the `tokens` item and `react`.

## API

`import { Badge } from "./components/badge"`.

```tsx
<Badge variant="success">Verified</Badge>

<h3>Quarterly report</h3>
<Badge variant="success">Live</Badge>
<Badge variant="quiet">Finance</Badge>

<h3>Annual review</h3>
<Badge variant="outline">Archived</Badge>
```

- `variant`: `"neutral" | "primary" | "success" | "warning" | "destructive" | "quiet" | "outline"`, default `"neutral"`. The first five are statuses, each a tinted chip: a subtle fill with its subtle ink, at `text-xs`, weight 600. Quiet and outline carry no status:
- `variant="quiet"`: secondary metadata beside a title, such as a category or a type. The neutral fill (`--gray-3`) with the softer `--gray-11` ink, at weight 500. Put it after the status badge, never in its place.
- `variant="outline"`: a record that has ended or been archived. No fill, `--gray-11` ink, and a 1px `--hairline` edge drawn as an inset shadow, so the chip is the same 20px tall as the filled ones. It is not a status colour: never use it for a live, pending or failing state. An ended record carries the outline chip instead of a status badge.
- `on_photo`: the look for a status badge laid over an image, default `false`. Quiet and outline have no photo look, and the types refuse `on_photo` with them. A solid fill with its `-fg` ink, a 1px ring in `--background`, and an 8px mark in the ink before the label whose shape follows the variant: success a filled circle, warning a hollow ring, neutral a filled square, primary a filled diamond, destructive a filled cross.
- `classes`: appended last.
- Other `span` attributes pass through.

A badge is a label, not a control: none of the variants takes focus or a click. For an action use `Button`.

The Tailwind classes behind the two non-status chips are `badge-quiet` and `badge-outline` (in the `tokens` item's `components.css`); each is the whole chip on its own, so `<span class="badge-quiet">` works without the component.

### Over a photo

The badge carries no position: the cover box places it. Put it at `top-3 left-3` inside a `relative overflow-hidden` box, and pick the variant from the status, labelled with the status word:

```tsx
const status_variant = { live: "success", draft: "warning", ended: "neutral" } as const;

<div className="relative overflow-hidden rounded-card">
  <img src={cover} alt="" className="aspect-[16/10] w-full object-cover" />
  <Badge variant={status_variant[status]} on_photo classes="absolute top-3 left-3">
    {status === "live" ? "Live" : status === "draft" ? "Draft" : "Ended"}
  </Badge>
</div>
```

## Accessibility

Plain text in a `span`; the meaning must be in the words, not only in the color. Quiet and outline both write `--gray-11` ink: quiet on `--gray-3`, outline on whatever surface holds it (the page or a card), with its edge in `--hairline`. Ink and fill pairs are the palette's recorded text pairs (Lc 60 or more in the default theme, light; dark figures are recorded in the theme tests).

With `on_photo`, each ink sits on its variant's solid fill; the brand contrast test records every pair in APCA, per theme and appearance, and clears Lc 60 but for warning in light, the warning button's accepted miss. The mark is a `::before` pseudo-element with empty content, so the label alone is the accessible name; the mark repeats the status by shape for readers who can't tell the fills apart.

## Theming

Variants map to `--gray-3` with `gray-12` ink (neutral), `--gray-3` with `--gray-11` ink at 500 (quiet), no fill with `--gray-11` ink and a `--hairline` inset edge (outline), `--secondary` with `accent-12` ink (primary), and the `-subtle` and `-subtle-fg` roles of the status scales. A theme or `.dark` recolors them.

With `on_photo` they map to solid fills: `--gray-12` with `--gray-1` ink (neutral), `--primary` with `--primary-fg`, `--success` with `--success-fg`, `--warning` with `--warning-fg`, and `--destructive` with `--destructive-fg`. The ring is `--background`.
