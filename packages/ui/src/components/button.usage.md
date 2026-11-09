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

- `variant` (required): `"primary" | "secondary" | "ghost" | "outline" | "destructive" | "success" | "warning"`.
- `size`: `"sm" | "md" | "lg" | "field"`, default `"md"`. `field` matches the height of a form field; `md` writes no size class (the bare `.btn` is the md tier).
- `is_loading`: shows `loading_text` (default `"Submitting..."`) with a spinner and makes the control inert.
- `disabled`: native `disabled` on a button; on the link forms it becomes `aria-disabled` and click, Enter and Space are blocked.
- `icon: true`: square icon-only button; requires `aria-label` (enforced by the type).
- `classes`: appended last. Do not pass padding or width; the size tier owns padding, the caller owns width.

Class strings are literal (`btn-primary`, never composed), so Tailwind sees them. Related utilities: `btn-sm`, `btn-md`, `btn-lg`, `btn-field`, `btn-icon`, `btn-sentence` (sentence-case label on the control corner; `btn-donate` is a deprecated alias, use `btn-sentence`), `btn-form-primary` (a fill from the form slots, see the `variables` note).

## Accessibility

- Disabled anchors announce `aria-disabled="true"` and are not activatable by pointer or keyboard.
- Focus shows a 2px `--ring` outline with an offset; the inverse button uses `--primary-ring`.
- Icon-only buttons are unconstructible without a name.

## Theming

Variants read the role variables (`--primary`, `--secondary`, `--destructive`, `--success`, `--warning` and their `-hover`/`-fg` pairs), which alias semantic scale steps. A theme change (`data-theme`, `.dark`) recolors every variant; nothing here names a hue.
