# tokens

Registry item `tokens` (files: `styles/index.css`, `base.css`, `components.css`, `utilities.css`, `theme.css`; depends on `variables`). Needs `tailwindcss` 4.

## What it is

The Tailwind 4 layer over the `variables` item: the theme mapping, base styles, component classes and utilities. In your CSS entry, after `@import "tailwindcss"`:

```css
@import "./ui/styles/index.css";
```

`index.css` imports no font stylesheet. Add one font item and import its stylesheet beside it: `fonts` (`fonts.css`) or `fonts-core` (`fonts-core.css`), or `fonts-red-hat` (`fonts-red-hat.css`) together with `data-font="red-hat"`, as the `variables` note describes.

## What you get

- Color utilities for every scale step and role: `bg-gray-3`, `text-accent-11`, `border-destructive-7`, `bg-accent-a3`, `bg-secondary`, `text-primary`, `border-hairline`, and the form slots (`bg-form-primary`, `bg-form-subtle`, `border-form-border`, `text-form-subtle-fg`). Tailwind's own hue palette (the 50 to 950 names) is closed and compiles to nothing.
- Closed ladders: type sizes, font weights, leading, tracking, radius (`rounded` is the control corner, `rounded-card` the container corner), shadows (`shadow-floating`, the recessed pair), z-index (`z-modal`, `z-floating`, ...), speeds (`duration-fast|base|slow`).
- `animate-spinner`: a busy spinner's turn, `spin 0.8s linear infinite`. Under `prefers-reduced-motion` it is `none`, as `animate-spin` and `animate-pulse` are, so the spinner stands still.
- `animate-sheet-in` and `animate-sheet-out`: a sheet sliding in from the inline end and back, over `--duration-base` (easing out both ways). It travels its own width, or `--sheet-from` when set (`-100%` under `rtl`, as the `sheet` item sets it). Under `prefers-reduced-motion` the speed collapses, so the sheet appears and leaves at once.
- Component classes in the components layer: `btn` and its variants, `field-input`, `label`, and others; the `button` and `input` items use them.
- `table`, `table-scroll` and `num`: the data table; the `table` item documents them.
- `lead-row` and `lead-1lh`: a status, badge, count or icon beside text that can wrap, on the text's first line. `lead-row` is a flex row aligned to the start, 12px apart, its first child the text taking the room; `lead-1lh` is the box around the mark, one line tall (`block-size: 1lh`), the mark centred in it, several marks 8px apart. Set the text's size on the row, so the box is one of its lines tall; a utility on the first child (`flex-initial`) keeps a mark beside a short title. The `card` note's `CardStatus` is the same box; `lead-css` is the plain-CSS twin.
- Utilities: `btn-sm|md|lg|field|icon`, `btn-sentence` (`btn-donate` is a deprecated alias), `btn-form-primary`, `btn-inverse-deep`, `surface-primary`.
- The deep ground is `bg-primary-deep` (accent step 12 in light and dark). Text and icons on it take `text-primary-deep-fg` (step 1 of the same scale), never white: in light that is light ink on a dark ground, in dark dark ink on a light ground. `btn-inverse-deep` is the inverse button there: a `--primary-deep-fg` fill with `--primary-deep` ink; `btn-inverse` stays for a `--primary` fill.
- The `dark:` variant follows the `.dark` class, not the system setting, and is off inside a `light` area of a dark page (`.dark .light` and everything under it). A `dark` area nested inside that `light` area does not switch it back on; the themes do (`.light .dark [data-theme]`), the variant does not.

## Rules

- Name a scale step or a role at the call site, never a hue or a hex.
- Theme and appearance work as described in the `variables` note: `data-theme` and the `dark` class.
- The set is closed on purpose: a name that is not here fails to compile instead of drifting in.

## Corrected in 2.2.0

2.2.0 moved the ring to step 8, the hairline to step 6, links to steps 11 and 12 and the warning ink to step 11, in both appearances. The `variables` note has the detail.

## Migrating from hue names

Version 2.0.0 removed the hue-named scales. Utilities and variables that named a hue now name the semantic scale for the same job. Rename them in your own code; nothing aliases the old names, and a leftover compiles to nothing (a utility) or resolves to nothing (a variable).

| Before | After |
| --- | --- |
| `--blue-N`, `bg-blue-N`, `text-blue-N`, `border-blue-N` | `--accent-N`, `bg-accent-N`, `text-accent-N`, `border-accent-N` |
| `--red-N` and the `red-N` utilities | `--destructive-N` and the `destructive-N` utilities |
| `--green-N` and the `green-N` utilities | `--success-N` and the `success-N` utilities |
| `--amber-N` and the `amber-N` utilities | `--warning-N` and the `warning-N` utilities |
| `--gray-N` and the `gray-N` utilities | unchanged |
| a literal color for the brand | `--primary` (step 9), or an `accent-N` step |

Other changes that can touch a copied app:

- The scales and the default theme moved to the `variables` item (`styles/colors.css`, `styles/themes/default.css`); `tokens` depends on it, so `update` brings it along.
- On tokens 1.x, run `bg-design update tokens` before you add a new item (`card`, `tabs`, `badge`, `variables`): `styles/colors.css` moved from `tokens` into `variables`, so until then `add` refuses and names the update to run.
- The form slots are now the accent scale named for a form. `btn-form-primary` reads `--form-primary`, `--form-primary-fg` and `--form-ring`, which follow `--accent-9`, `--accent-contrast` and `--ring`. Its hover and press are mixed from `--form-primary` unless the app sets `--form-primary-hover` or `--form-primary-active`, so a host that sets only `--form-primary` gets a matching hover and press. Those two are no longer declared anywhere: your own CSS that reads either with no fallback gets an invalid value (a transparent background), so give it the fallback from the `variables` note or declare the two yourself. Give the form's container `data-theme` with its own accent scale to re-theme the tint, edge and ring too.
- Roles are aliases onto scale steps and re-resolve under `data-theme`; the `dark` class (not the system setting) selects dark, also for Tailwind's `dark:` variant.
- `--hairline`, `--ring`, `--link` and `--link-hover` are declared in the theme file, per appearance, and `--border` aliases `--hairline`. A hand-written theme must define all four in each block (the same steps in light and dark: gray 6, accent 8, accent 11 and accent 12), or a nested theme inherits the root's resolved values.
- Shadows and the scrim use `--shadow-ink`, so they darken with black in dark.
- `.btn` and its variants change their hover and press colors over `--duration-fast` (ease-out), which the reduced-motion guard on the speed ladder collapses. A test of your own that reads a button's hover or press color right after the pointer moves reads it mid-change: wait for `element.getAnimations()` to finish first.
- The `donate` dialog size and `btn-donate` utility keep working as deprecated aliases of `sheet` and `btn-sentence`.
