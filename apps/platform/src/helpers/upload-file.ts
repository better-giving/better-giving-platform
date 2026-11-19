/** `document` goes to private storage and is opened through `doc_href`;
 * `image` is a public image for a page. The server enforces what each takes. */
export type UploadKind = "document" | "image";

export async function uploadFile(file: File, kind: UploadKind) {
  const res = await fetch(
    `/api/file-upload?kind=${kind}&filename=${window.encodeURIComponent(file.name)}`,
    { method: "POST", body: file }
  );
  if (!res.ok) throw res;

  const { url } = await res.json();
  return url as string;
}

export const upload_document = (file: File) => uploadFile(file, "document");
