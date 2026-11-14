import { FileDropzone, type FileSpec, Label } from "@better-giving/ui";

const id_spec: FileSpec = {
  mbLimit: 6,
  mimeTypes: ["image/jpeg", "image/png", "application/pdf"],
};

const statement_spec: FileSpec = {
  mbLimit: 6,
  mimeTypes: ["application/pdf"],
};

// injected app reaches: the dropzone knows no endpoint and no error sink, so
// every call site hands it both. these stand in for the app's upload route and
// its reporter. `dropzone_name` is the drop area's accessible name — zag's
// generic "dropzone" only reads unambiguously when a form holds one.
const upload = async (f: File) => `https://cdn.better.giving/uploads/${f.name}`;
const report_error = (err: unknown) => console.error(err);
const view_href = (ref: string) => `/api/docs?ref=${encodeURIComponent(ref)}`;

export const Empty = () => (
  <FileDropzone
    label={
      <Label required className="mb-2">
        Please provide passport, driver's license, or ID card.
      </Label>
    }
    dropzone_name="Proof of identity"
    value=""
    onChange={() => {}}
    specs={id_spec}
    upload={upload}
    report_error={report_error}
  />
);

export const Uploaded = () => (
  <FileDropzone
    label={
      <Label required className="mb-2">
        Proof of registration as a 501(c)(3) nonprofit or equivalent
      </Label>
    }
    dropzone_name="Proof of registration"
    value="https://cdn.better.giving/registrations/rainforest-trust-501c3.pdf"
    onChange={() => {}}
    specs={id_spec}
    upload={upload}
    view_href={view_href}
    report_error={report_error}
  />
);

export const Loading = () => (
  <FileDropzone
    label={
      <Label className="mb-2">Bank statement for the payout account</Label>
    }
    dropzone_name="Bank statement"
    value="loading"
    onChange={() => {}}
    specs={statement_spec}
    upload={upload}
    report_error={report_error}
  />
);

export const WithError = () => (
  <FileDropzone
    label={
      <Label required className="mb-2">
        Please provide passport, driver's license, or ID card.
      </Label>
    }
    dropzone_name="Proof of identity"
    value=""
    onChange={() => {}}
    specs={id_spec}
    upload={upload}
    report_error={report_error}
    error="Exceeds size limit"
  />
);

export const Disabled = () => (
  <FileDropzone
    label={
      <Label className="mb-2">Bank statement for the payout account</Label>
    }
    dropzone_name="Bank statement"
    value=""
    onChange={() => {}}
    specs={statement_spec}
    upload={upload}
    report_error={report_error}
    disabled
  />
);
