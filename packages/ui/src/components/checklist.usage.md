# checklist

Registry item `checklist` (file: `components/checklist.tsx`). Needs the `tokens` item, the `badge` item, the `button` item, the `card` item, `react` and `lucide-react` (the Info, TriangleAlert, CircleCheck, Printer and RotateCcw glyphs).

A list of questions a reader ticks through, with a score that says how far they are and whether the items that matter most are covered. The ticks stay in the reader's browser; nothing is sent anywhere.

## API

`import { Checklist, ChecklistView, DEFAULT_WORDS, verdict_for, bar_width, restored } from "./components/checklist"`.

```tsx
const sections: ChecklistSection[] = [
  {
    id: "arrival",
    title: "Getting there",
    sub: "How guests reach the door.",
    items: [
      { id: "arrival-step-free", text: "There is a step-free route from the street to the main entrance.", flag: true },
      { id: "arrival-parking", text: "Accessible parking is within 50 metres of the entrance.", note: "Ask how many bays, not only whether there are some." },
    ],
  },
];

<h1>Venue accessibility checklist</h1>
<p>Questions to put to a venue before you book it.</p>
<Checklist sections={sections} storage_key="venue-checklist-v1" />
```

`Checklist`:

- `sections`: `ChecklistSection[]`, each `{ id, title, sub?, items }`; an item is `{ id, text, flag?, note? }`. The total and the flagged total come from the list.
- `storage_key`: the `localStorage` key the ticks are kept under, as a JSON array of item ids. When the list changes shape, change the key (`-v2`) rather than renaming ids: a renamed id drops its tick.
- `words`: optional, any of the strings below; `verdict` merges per tier, so one tier can be reworded alone.
- `link_ids`: when set, each item row's `id` is the item's own `id` and each section's `id` is the section's own, so a link like `#arrival-step-free` lands on that row (and `#arrival` on the section). Unset, the ids carry a per-instance prefix and two checklists can share a page. The app keeps the ids unique on the page when it sets `link_ids`: two linked lists on a page, or an item id equal to a section id, jump to the first match. A linked row or section scrolls to just below the pinned header and status card: its `scroll-margin-block-start` is the header's height (`--ds-header-h`, else `--ds-bar-h`), the card's height and 16px. The root measures the card itself (a `ResizeObserver` writes `--ds-checklist-status-h` on the root), so an app does not set it, and long `words`, a wrapped tally badge or text zoom are counted; until the first measure the margin reads an estimate of the card's tallest state, 14rem under 640px and 12rem from there. The header's height is already in the margin, so an app that also sets `scroll-padding-top` for its header counts it twice: drop the `scroll-padding-top` (dropping `--ds-header-h` would pin the card behind the header).
- `classes`: appended last, on the root.

The page's title and introduction are the app's (`page-header` or its own `h1`); the item starts at the legend. Its root sets no margin and no width: put it in the page's column.

`ChecklistView` draws the same thing from props, with no storage: `checked` (a `ReadonlySet` of ids), `confirming`, and the callbacks `on_toggle(id)`, `on_print`, `on_ask_reset`, `on_reset`, `on_keep`, plus `sections`, `words` and `classes`. Use it to hold the ticks somewhere else (a server, a form) or to draw a fixed state.

`verdict_for(done, flags_done, total, flag_total)` returns `{ tier, tone, missing }`; `bar_width(done, total)` the bar's width (`"32.1%"`); `restored(raw, ids)` the stored ticks still in the list, or `null`.

## Parts, top to bottom

- **Legend** (only when an item is flagged): the flag badge (`badge` `warning`), 8px before `words.legend` in gray-11, `text-sm`, inline, so on a phone the sentence runs on after the badge.
- **Status card**, a `Card` named `words.score` ("Your score"): the count, "9 of 28 checked" (the figure `font-display` `text-3xl` bold, tabular; the rest gray-11), the tally badge at the end of the row, an 8px bar under it, and the verdict band. On screen it is `position: sticky` under the site nav's header or the app shell's top bar (`inset-block-start: var(--ds-header-h, var(--ds-bar-h, 0px))`, `z-subbar`), so the score stays in view while the list scrolls. `site-nav` sets `--ds-header-h` and the app shell sets `--ds-bar-h`; an app with its own header sets `--ds-header-h` to that header's height on a wrapper around the list (`style={{ "--ds-header-h": "72px" }}`). With neither set, the card pins at 0, behind the header.
- **Controls**: Print or save as PDF (`secondary`, Printer) and Reset all (`ghost`, RotateCcw). Under 640px they stack, each the full width, 8px apart.
- **Sections**: a `Card` each, labelled by its `h2` (the title, `text-lg`; the page's `h1` sits above the item) with `sub` under it in gray-11, then the items: a native checkbox and its `<label>`, 12px apart, rows 10px top and bottom with a hairline between. A flagged item's badge comes first in the label, 8px before the text; `note` sits under the text in `text-xs` gray-11. The badge, the text and the note are separated by real spaces, so the label's text and the checkbox's name read "Priority There is a step-free route… Ask how many bays…", and the legend reads "Priority Items that matter most…".

## States

| Tier | When | Tone | Tally | Default headline |
| --- | --- | --- | --- | --- |
| `empty` | nothing ticked | neutral (Info) | "10 priority items to check" (neutral badge) | Start ticking boxes |
| `gaps` | a flagged item unticked | warning (TriangleAlert) | "7 priority items unchecked" (warning badge), singular at 1 | Gaps to raise |
| `flags_clear` | every flagged item ticked, items left | success (CircleCheck) | "All priority items clear" (success badge) | No red flags, with a few items left |
| `done` | everything ticked | success (CircleCheck) | "All priority items clear" | Every item checked |

The verdict band takes a neutral (gray), warning or success tone, with the notice card's fill, edge and ink: neutral `--gray-3` fill, `--gray-6` edge, `--gray-11` glyph; warning `--warning-subtle`, `--warning-6`, `--warning-11`; success `--success-subtle`, `--success-6`, `--success-11`. The headline is `font-display` bold, the line under it `text-sm`, both gray-12. The bar is `--primary` and turns `--success` only when every item is ticked (`data-state="met"`; `"empty"` at 0). The fill's width animates only when motion is allowed (`motion-safe:`); under `prefers-reduced-motion: reduce` it jumps to the new width. A list with no flagged item draws no legend and no tally.

**Reset**: while nothing is ticked, Reset all is `aria-disabled="true"` (focusable, the disabled look, the press does nothing). Otherwise it swaps the controls row for a confirm line, `role="group"` named `words.confirm_label` ("Confirm reset"): "Clear all 9 ticks? This can't be undone." (semibold, `text-sm`), Clear all ticks (`destructive-outline`) and Keep my ticks (`secondary`). Focus moves to Keep my ticks. Clearing unticks everything and writes `[]`; either answer puts the controls back and focus on Reset all, and the count announces "0 of 28 checked" after a clear.

## Persistence

The first render is empty, on the server and in the browser alike, so hydration matches; the restore runs in an effect after it. It reads `storage_key`, ignores malformed JSON and anything but an array, keeps the string ids still in the list and drops the rest. A new `storage_key` is another list: the ticks and an open confirm line are cleared, then that key's ticks restored. Every tick writes the ids back. A storage that throws (private mode, a full quota, blocked storage) is swallowed on read and on write: the list keeps working for the session and is not kept.

## Print

Print or save as PDF calls `window.print()`. Printed, the controls row and the confirm line are hidden, the status card is in flow rather than pinned, the badges, ticks and bar keep their fills (`print-color-adjust: exact` on the root) and no item breaks across a page (`break-inside: avoid`).

## Accessibility

- Each item is a native `<input type="checkbox">` with a `<label for>`: the whole text, badge and note included, is its name and its target. Space toggles it.
- The flag badge is first in the label, so it heads the first line when the text wraps and is heard before the question; a space follows the badge, and another follows the text before the note, so the name does not run the words together. The space after the badge has no width (`font-size: 0`), so the badge's 8px margin is the whole visible gap in any font.
- Two polite live regions (`role="status"`, `aria-live="polite"`): the count, whose figure and words are separated by a real space so it reads "9 of 28 checked", and the verdict, whose text changes only at a tier change, so a tick inside a tier is not read twice. The bar is `aria-hidden`: the count says it.
- Glyphs are `aria-hidden`.

## Words

`DEFAULT_WORDS` holds the item's neutral strings: `flag` ("Priority"), `legend`, `score`, `count(total)` ("of 28 checked", the words after the ticked figure), `verdict` (a headline and a line per tier), `to_check(n)`, `unchecked(n)`, `clear`, `print`, `reset`, `confirm(n)`, `confirm_label` ("Confirm reset", the confirm line's name), `clear_all`, `keep`. Pass the app's own through `words`; `count`, `to_check`, `unchecked` and `confirm` take the number so the app pluralises in its own language.

## Swapping in an app's own checklist

An app with its own checklist component and badge component deletes both and renders this item. Its data file keeps the sections; the one change is the flag's key, `flag: true` on a flagged item (rename it if the data calls it something else). The page passes the same key it stored under before, so readers keep their ticks, for example `storage_key="bg-ethics-checklist-v1"`, and its own wording through `words`:

```tsx
<Checklist
  sections={sections}
  storage_key="bg-ethics-checklist-v1"
  words={{
    flag: "Flashpoint",
    legend: "Practices named in the relevant enforcement actions. If you can't check it, ask the platform why.",
    to_check: (n) => `${n} flashpoints to check`,
    unchecked: (n) => `${n} flashpoint${n === 1 ? "" : "s"} unchecked`,
    clear: "All flashpoints clear",
  }}
/>
```

## Theming

Reads roles and steps only (`--gray-3`, `--gray-6`, `--gray-11`, `--gray-12`, `--warning-subtle`, `--warning-6`, `--warning-11`, `--success-subtle`, `--success-6`, `--success-11`, `--primary`, `--success`, `--panel`, `--hairline`, through the card, badge, button and checkbox classes), so `data-theme`, `.dark` and `.light` recolor it. The plain-CSS twin is `checklist-css`.
