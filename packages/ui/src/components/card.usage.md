# card

Registry item `card` (file: `components/card.tsx`). Needs the `tokens` item and `react`.

## API

`import { Card, CardHeader, CardStatus, CardBody, CardFooter } from "./components/card"`.

```tsx
<Card aria-label="Plan">
  <CardHeader><h2>Acme Pro</h2></CardHeader>
  <CardBody>Everything in Basic, plus priority support.</CardBody>
  <CardFooter><Button variant="primary">Subscribe</Button></CardFooter>
</Card>
```

| Part | Renders | Notes |
| --- | --- | --- |
| `Card` | `section` | 12px corner (`--radius-card`), `--card` fill, hairline edge, no shadow |
| `CardHeader` | `header` | title and aside, hairline below; a row when it holds a `CardStatus` |
| `CardStatus` | `span` | the box for a status beside a title that can wrap (below) |
| `CardBody` | `div` | the content |
| `CardFooter` | `footer` | actions row on the `--panel` well fill, hairline above |

The header, body and footer are 24px in from the sides, and 16px under `sm` (640px); their top and bottom padding stays (16px for the header and footer, 20px for the body). All parts are optional and take `classes`, appended last; width belongs to the caller. Other native attributes pass through.

### A status beside text that can wrap

A status, badge, count or icon beside text that can wrap sits on the text's first line, not in the middle of the block. Wrap the mark in `CardStatus`:

```tsx
<CardHeader classes="text-lg">
  <h2>Food bank winter drive for families</h2>
  <CardStatus><Badge variant="warning">Ends soon</Badge></CardStatus>
</CardHeader>
```

- `CardStatus` renders `<span class="card-status">`, the card's name for `lead-1lh`: a flex box exactly one line tall (`block-size: 1lh`), the mark centred in it, kept at its own width, several marks 8px apart. `1lh` is the box's own line-height, which it inherits from its row.
- A `CardHeader` that holds a `CardStatus` as a direct child is the row: a flex row aligned to the start, the title first and the status at the end, 8px apart. A one-line title looks as a centred row would; a wrapped one keeps the mark on its first line. Don't add `items-center` to that header: it centres the box against the whole title again.
- Set the title's size on the header, not on the heading (`CardHeader classes="text-lg"`, `<h2>` with no size). The heading and the box then inherit the same size and line-height, so the box is one of the title's lines tall. A size on the heading alone gives it a taller line than the box, and the mark sits high.
- The pattern is not only for a header: any row of yours does the same with the `tokens` item's `lead-row` on the row and `lead-1lh` around the mark (`CardStatus` draws the same box), the text's size set on the row. The `tokens` note has both classes. The box stays one line tall, so it is for marks no taller than a line: a taller one, such as a button, spills out of it above and below.
- `classes` is appended last; other `span` attributes pass through.

### CardCreate

The card that starts making a new one, usually last in a grid of cards.

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
  {projects.map((p) => <Card key={p.id} aria-label={p.name}>…</Card>)}
  <CardCreate href="/projects/new">New project</CardCreate>
</div>

<CardCreate onClick={open_create_dialog}>New project</CardCreate>
<CardCreate href="/projects/new" disabled aria-describedby="limit">New project</CardCreate>
<p id="limit">You have reached the plan's project limit.</p>
```

- `href` renders an `<a>`; `onClick` renders a `<button type="button">`. Give one or the other.
- `children`: the label, the whole accessible name. A 20px Plus icon sits above it, `aria-hidden`.
- `disabled`: renders `aria-disabled="true"`, never the native attribute, so the card stays focusable and a reason beside it (`aria-describedby`) can be read. The component blocks the activation: the button's `onClick` is not called; the link's click and Enter are stopped, and the base layer takes the pointer off it.
- `classes`: appended last. Other `a` or `button` attributes pass through.
- The look is the `card-create` class (the `tokens` item's `components.css`): `--radius-card`, a 1px dashed `--input` edge, no fill, the label in the display face at 700 and 16px. In a grid it stretches to the row's height; alone, or in one column, it is at least 96px (`--spacing` × 24).
- States: hover fills `--gray-4` and turns the edge `--input-hover`, only where the pointer can hover; pressed fills `--gray-5`, with no nudge; keyboard focus draws a 2px `--ring` outline 2px out; disabled fills `--gray-3`, edges in `--hairline`, inks in `--gray-11`, with a not-allowed cursor.

## Accessibility

`section` is a named region only when it has an accessible name: pass `aria-label` or `aria-labelledby`. Put a heading in `CardHeader`. `CardStatus` adds no role; the mark inside it reads after the title, in source order.

`CardCreate` is a link or a button named by its own text; say what it creates ("New project", not "Add"). The label is `--gray-12` on the page at rest and `--gray-11` on `--gray-3` disabled.

## Theming

Fill, edge and well are roles (`--card`, `--hairline`, `--panel`) over gray scale steps, and `CardCreate`'s edge is the field's (`--input`, `--input-hover`), so a theme or `.dark` recolors the card. Nested inside a `data-theme` container it takes that theme.
