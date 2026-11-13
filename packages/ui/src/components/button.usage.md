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

- `variant` (required): `"primary" | "secondary" | "ghost" | "outline" | "destructive" | "destructive-outline" | "success" | "warning"`. `destructive-outline` is for a destructive action that opens a confirm step, beside secondary buttons: a transparent fill, a 1px `--destructive` edge and `--destructive-subtle-fg` ink, `--destructive-subtle` on hover and `--destructive-subtle-active` pressed, with no press nudge. Keep the solid `destructive` for the confirm itself. Disabled and in flight it takes the shared gray fill and its edge goes to `--gray-7`. Its class, `btn-destructive-outline`, ships in `tokens` 2.1.0: update `tokens` with `button`.
- `size`: `"sm" | "md" | "lg" | "field"`, default `"md"`. `field` matches the height of a form field; `md` writes no size class (the bare `.btn` is the md tier).
- `is_loading`: shows `loading_text` (default `"Submitting..."`) with a spinner and makes the control inert.
- `disabled`: native `disabled` on a button; on the link forms it becomes `aria-disabled` and click, Enter and Space are blocked.
- `icon: true`: square icon-only button; requires `aria-label` (enforced by the type).
- `classes`: appended last. Do not pass padding or width; the size tier owns padding, the caller owns width.

Class strings are literal (`btn-primary`, never composed), so Tailwind sees them. Related utilities: `btn-sm`, `btn-md`, `btn-lg`, `btn-field`, `btn-icon`, `btn-sentence` (sentence-case label on the control corner; `btn-donate` is a deprecated alias, use `btn-sentence`), `btn-form-primary` (a fill from the form slots, see the `variables` note), `btn-inverse` (on a `--primary` fill) and `btn-inverse-deep` (on the `--primary-deep` ground, inked with `--primary-deep-fg`; focus ring `--primary-deep-fg`).

## Accessibility

- Disabled anchors announce `aria-disabled="true"` and are not activatable by pointer or keyboard.
- Focus shows a 2px `--ring` outline with an offset; the inverse button uses `--primary-ring`, the deep inverse `--primary-deep-fg`.

## Theming

Variants read the role variables (`--primary`, `--secondary`, `--destructive`, `--success`, `--warning` and their `-hover`/`-fg` pairs; `destructive-outline` reads `--destructive-subtle`, `-subtle-fg` and `-subtle-active`), which alias semantic scale steps. A theme change (`data-theme`, `.dark`) recolors every variant; nothing here names a hue.
