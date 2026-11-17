# button

Registry item `button` (files: `components/button.tsx`, `components/load-text.tsx`). Needs the `tokens` item, `react`, `react-router` and `lucide-react`.

## API

`import { Button } from "./components/button"`. One component, three element forms chosen by which prop you pass:

| Form | Props | Renders |
| --- | --- | --- |
| button | none of `to`/`href`; any native button prop; `type` defaults to `"button"` | `<button>` |
| router link | `to`, optional `nav` (`NavLink` instead of `Link`) | `<a href>` via `react-router` (needs a router above it) |
| anchor | `href` | `<a href>` |

Shared props:

- `variant` (required): `"primary" | "secondary" | "ghost" | "soft" | "outline" | "destructive" | "destructive-outline" | "success" | "warning"`. `destructive-outline` is for a destructive action that opens a confirm step, beside secondary buttons: a transparent fill, a 1px `--destructive` edge and `--destructive-subtle-fg` ink, `--destructive-subtle` on hover and `--destructive-subtle-active` pressed, with no press nudge. Keep the solid `destructive` for the confirm itself. Disabled and in flight it takes the shared gray fill and its edge goes to `--gray-7`. Its class, `btn-destructive-outline`, ships in `tokens` 2.1.0: update `tokens` with `button`. `soft` is the neutral rank between `ghost` and `secondary`, for toolbars and row actions: `--gray-3` at rest, `--gray-4` hovered, `--gray-5` pressed, `--gray-12` ink, no visible edge and no press nudge; disabled keeps the fill and drops the ink to `--gray-11`. Its class, `btn-soft`, ships in `tokens` with this release: update `tokens` with `button`.
- `size`: `"sm" | "md" | "lg" | "field"`, default `"md"`. `field` matches the height of a form field; `md` writes no size class (the bare `.btn` is the md tier).
- `is_loading`: shows `loading_text` (default `"Submitting..."`) with a spinner and the disabled look, and no activation lands. The button form writes `aria-disabled="true"` and `aria-busy="true"` rather than `disabled`, so a focused button keeps focus while the work runs and is still focused when `is_done` lands; the component stops the click, and with it a submit, Enter and Space. The link forms take `aria-disabled` and are blocked as `disabled` blocks them. The in-flight look keys off `aria-busy="true"` as well as the `pending` class from `tokens` in this release, the attribute `button-css` keys it off: update `tokens` with `button`. The spinner and text come from `LoadText` (`components/load-text.tsx`); inside a `.btn` the button's gap spaces them, and in any other host it keeps 4px between them.
- `disabled`: native `disabled` on a button (only this prop sets it); on the link forms it becomes `aria-disabled` and click, Enter and Space are blocked.
- `aria-disabled` (button form): the disabled look (`--gray-3` fill, `--gray-11` ink, `destructive-outline`'s edge to `--gray-7`, a not-allowed cursor) on a button that stays focusable and keeps its pointer events, so a tooltip or a described-by line can say why it is off. The component stops the click, and with it a submit. Use it over `disabled` when the reason has to stay reachable.
- `is_done`: the work succeeded. Writes `data-done` (`"true"` or `"false"`) and puts a check before the label: `--success-subtle` fill, `--success-subtle-fg` ink, no edge. It is not the disabled look and not the in-flight gray. The button stays focusable, but while done no activation lands: it takes no pointer events, and the button form stops the click Enter or Space would make. Pass the done label as `children` ("Saved", "Copied"), without the rest label's own icon. Hold it for 2000ms, then return to rest; `useDone` from the `input` item (`./components/form/field`) does this; a second success inside the window starts it over. Announce the outcome in a `role="status"` region beside the button, reserve the longest label's width with `classes` (`min-w-32`) so the row does not shift, and never show done for a failed save. Set `is_done`, not `data-done` by hand, so the check is drawn once. A copy button in a field's `action` (the `input` item's `Field`) takes `is_done` the same way, and the field's `status` is its region.
- `icon: true`: square icon-only button; requires `aria-label` (enforced by the type).
- `full_width`: the button fills its container's inline size (`inline-full`), with the label, its icon or the in-flight spinner centred, on every variant and size; the label stays on one line where it fits and the tier's height holds. For a card or sheet footer's one action, or a phone's stacked actions. Not with `icon` (the type refuses it): a square is its tier's width, and if both reach it at runtime (a cast, plain JavaScript) `icon` wins and the button stays its tier's square. On the link forms too.
- `classes`: appended last. Do not pass padding or width; the size tier owns padding, and width is the caller's: `full_width`, or the container.

Element states the button styles from its attributes, passed as native props:

- Held open: `aria-expanded={true}` on a button that opens a menu or popover. While open it holds its own pressed rung with no press nudge: `--gray-5` on `secondary`, `ghost` and `soft`, `--primary-hover` on `primary`, the 15% mix on `outline`, `--destructive-subtle-active` on `destructive-outline`. Give a trailing `ChevronDown` the class `btn-chevron` and it turns 180° over `--duration-fast` (at once under reduced motion). This item draws no menu.
- Toggle: `aria-pressed` on `secondary`, `soft` or `ghost`. On, it takes `--secondary-active` (accent 5) with `--accent-12` ink; `secondary` also gets an `--accent-7` edge, `--accent-8` under the pointer. A disabled or `aria-disabled` toggle shows the disabled look. An icon-only toggle (a toolbar) is `soft` with `icon` and an `aria-label`.

Icon beside a label: put the icon before the label, or a chevron after it, with `aria-hidden="true"`. The gap is `--spacing × 2` (8px) at md, lg and field and `--spacing × 1.5` (6px) at sm; the icon is 16px at md, 14px at sm and 20px at lg, whatever size the icon component sets. A size class on the icon wins. Padding does not change. The in-flight spinner sits at the same gap.

Touch area: `btn-sm` is drawn at 24px. Where the pointer is coarse its hit area grows to `--ds-hit-target` (44px there; the `variables` note) tall, and at least that wide, without changing the drawn size or the layout. Keep at least 20px between neighbouring icon-only `sm` buttons so their areas do not overlap, or use `md`; where areas do meet, the later button takes the tap. `btn-sm` is `position: relative` for this; a caller's `absolute` still wins.

Class strings are literal (`btn-primary`, never composed), so Tailwind sees them. Related utilities: `btn-sm`, `btn-md`, `btn-lg`, `btn-field`, `btn-icon`, `btn-sentence` (sentence-case label on the control corner; `btn-donate` is a deprecated alias, use `btn-sentence`), `btn-form-primary` (a fill from the form slots, see the `variables` note), `btn-inverse` (on a `--primary` fill) and `btn-inverse-deep` (on the `--primary-deep` ground, inked with `--primary-deep-fg`; focus ring `--primary-deep-fg`).

## Accessibility

- Disabled anchors announce `aria-disabled="true"` and are not activatable by pointer or keyboard. An `aria-disabled` button is announced as unavailable, stays in the tab order and is not activatable.
- A toggle announces its state through `aria-pressed`; keep its label the same when it changes. A menu button announces `aria-haspopup` and `aria-expanded`.
- An icon next to a label is `aria-hidden`; the label is the name.
- Focus shows a 2px `--ring` outline with an offset; the inverse button uses `--primary-ring`, the deep inverse `--primary-deep-fg`.

## Theming

Variants read the role variables (`--primary`, `--secondary`, `--destructive`, `--success`, `--warning` and their `-hover`/`-fg` pairs; `destructive-outline` reads `--destructive-subtle`, `-subtle-fg` and `-subtle-active`), which alias semantic scale steps. A theme change (`data-theme`, `.dark`) recolors every variant; nothing here names a hue.
