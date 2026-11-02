---
category: Content
---

# Badge

A small rounded label naming a category or a state: a resource type, a fundraiser's `closed`/`completed`/`expired` status, a marketing tag.

The look is closed: `tone` picks an authored fill + ink pair, `size` picks padding (`sm` inside a card or a dense row, `md` on a marketing section). `warning` is the warning band (`--warning-subtle` + its ink) for a state that needs attention, such as pending review. `on-primary` is only for a badge sitting inside a `surface-primary` block. `className` is for placement only.

Static text, never a control: a removable or selectable filter chip is a button, not a Badge.
