---
category: Selector
---

# Combo

A single-select combobox with type-ahead filtering.

`options` takes either a plain array or a caller-owned query (`{ items, loading, error }`) — a query that is loading or has failed shuts the control, so a half-filled list is never presented as the answer.

`adornment` draws the trigger at the trailing edge — the drawer chevron or a spinner; `lead` is a decoration at the leading edge, the selected country's flag, and passes clicks through to the input. `render` draws an option row. `item_key` / `item_text` tell the module how to read a non-string option type; string options need neither.

`sub` is help text between the label and the control, read out as the input's description ahead of any error.

`clearable` adds the X that empties the field. It emits `on_change(undefined)`, so the caller decides what empty means.
