---
category: Content
---

# Accordion

A list of questions, each opening its answer below it: the FAQ list.

`items` are the rows: `trigger` is the question, `content` the answer. One row is open at a time, and clicking the open row closes it again. The look is closed: `variant="compact"` is a tight list with small type inside a card (the donate page's FAQ), `variant="divided"` is a padded list ruled between rows for a page section. The chevron and the open/close height animation come with it. `className` is for placement only; the heading above the list is the page's. Where no heading names the list (a single collapsible box standing as its own section), `heading_level` wraps each trigger in a heading of that level, so the row is in the page outline whether it is open or closed.

Not for switching panels of one screen (that is `Tabs`).
