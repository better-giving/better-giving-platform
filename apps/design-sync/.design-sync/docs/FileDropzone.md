---
category: Form
---

# FileDropzone

A drag-and-drop file input with a click-to-browse fallback.

`specs` declares what is allowed — `{mbLimit, mimeTypes}` — and the component enforces it and surfaces the failure through `error`.
The drag-over state is interaction-only and does not appear on a static card.

The uploaded state renders the file's **name** inside the drop area and a separate "View uploaded file" link *below* it — the link is deliberately not a child of the drop area, which is a `role="button"` and may not contain focusable descendants. The link renders only when the call site passes `view_href`: a stored value may be a private-store url that opens nothing on its own.
Uploading is `aria-busy`, not `disabled`: the control keeps its place in the tab order while the upload is in flight.
Every transition — rejected, uploading, uploaded, failed — is announced through a polite live region, so none of the four states is silent to a screen reader.
