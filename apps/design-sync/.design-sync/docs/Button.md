---
category: Form
---

# Button

Every button and every button-shaped link in the system. It renders a `<button>`, a router `Link` (`to`), a `NavLink` (`to` + `nav`), or a plain `<a>` (`href`) — the same control in four elements, so a call site never has to hand-spell `.btn` again.

`variant` is required and closed: `primary`, `secondary`, `ghost`, `outline`, `destructive`, `success`, `warning`. `success` means approve/confirm and nothing else; `warning` means a real hazard. `outline` has no color of its own — it reads `currentColor`, so it belongs on a `surface-primary` band or another surface that declared its ink.

The one filled action on a brand fill is the `btn-inverse` class (`--primary-fg` fill, `--primary` label, a press but no hover, a `--primary-ring` focus ring), written on a link beside `btn`; it is not a `variant`.

`size` is `sm`, `md` (the default, which writes no class), `lg`, or `field` (matches the height of a form control beside it).

`is_loading` puts the control in its in-flight state — muted, unclickable, and showing `loading_text` when given. `icon` is for an icon-only button and **requires** `aria-label`: the two props are a union, so a nameless icon button does not typecheck.
