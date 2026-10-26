import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { data } from "react-router";
import { PhotoUploadPage, type PhotoView } from "#/components/photo-upload";
import {
  photo_too_large,
  photo_types,
  photo_wrong_type,
  upload_limits,
} from "@/constants/upload";
import { read_photo_page, save_photo } from "$/connector/photo-page";
import { db } from "$/pg/db";
import type { Route } from "./+types/photo-upload.$token";

// signed out by design: the token in the path is the whole credential
export async function loader({ params }: Route.LoaderArgs) {
  const { page, status } = await read_photo_page(db, params.token);
  return data(page, { status });
}

// every status explicit: the loader reruns after the action and reads a
// spent link that saved nothing as 404, and a 200 left implicit would let
// that status win
export async function action({ request, params }: Route.ActionArgs) {
  const { page, status } = await save_photo(db, request, params.token);
  return data(page, { status });
}

const PRIVATE = {
  "Cache-Control": "no-store",
  // the token is in the url; a referer would hand it to the next host
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

/** the page's own upload script asks for the page as json, so it can show
 * progress; same function and statuses as the form's native post, which still
 * renders through the action */
const upload_as_json: Route.MiddlewareFunction = async (
  { request, params },
  next
) => {
  const wants_json = request.headers
    .get("accept")
    ?.startsWith("application/json");
  if (request.method !== "POST" || !wants_json) return next();
  const { page, status } = await save_photo(db, request, params.token);
  // built here, so the `headers` export never reaches it
  return Response.json(page, { status, headers: PRIVATE });
};

export const middleware = [upload_as_json];

/** static, so a thrown error answered by this route's boundary carries them too */
export function headers() {
  return PRIVATE;
}

export function meta() {
  return [
    { title: "Add a campaign photo - Better Giving" },
    { name: "robots", content: "noindex" },
  ];
}

type PhotoInput = Pick<HTMLInputElement, "setCustomValidity"> & {
  files: ArrayLike<Pick<File, "size" | "type" | "name">> | null;
};

const PHOTO_TYPES: readonly string[] = photo_types;
const PHOTO_EXTENSIONS = photo_types.flatMap((t) => upload_limits.types[t]!);

/** a browser that can't name a file's type reports it as "" */
const is_photo_type = ({ type, name }: Pick<File, "type" | "name">) =>
  type
    ? PHOTO_TYPES.includes(type)
    : PHOTO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

/** holds a pick or drop the server would refuse, before it is sent: Vercel
 * answers a body over its 4.5 MB limit with its own error page before the
 * action runs. Sets the input's validity and leaves showing it to the page.
 * true when it held the pick */
export function hold_unfit(input: PhotoInput): boolean {
  const file = input.files?.[0];
  const refusal = !file
    ? ""
    : !is_photo_type(file)
      ? photo_wrong_type
      : file.size > upload_limits.max_bytes
        ? photo_too_large
        : "";
  input.setCustomValidity(refusal);
  return refusal !== "";
}

type Settled = Exclude<PhotoView, { state: "uploading" }>;
const SETTLED = new Set<string>([
  "gone",
  "limited",
  "ready",
  "failed",
  "unknown",
  "saved",
] satisfies Settled["state"][]);

function page_of(body: string): Settled | null {
  try {
    const page = JSON.parse(body);
    return SETTLED.has(page?.state) ? page : null;
  } catch {
    return null;
  }
}

/** the form's own post, sent so the upload's progress can be read. A
 * connection lost before the body finished sending reaches no action, so it
 * reads as failed; lost after, or answered with anything but the page, the
 * save may have landed, so it reads as unknown */
export function send_photo(
  url: string,
  body: FormData,
  campaign: string,
  on_progress: (loaded: number, total: number) => void
): Promise<Settled> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let body_sent = false;
    const unknown: Settled = { state: "unknown", campaign };
    const lost = () =>
      resolve(body_sent ? unknown : { state: "failed", campaign });
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      if (e.loaded >= e.total) body_sent = true;
      on_progress(e.loaded, e.total);
    };
    xhr.upload.onload = () => {
      body_sent = true;
    };
    xhr.onload = () => resolve(page_of(xhr.responseText) ?? unknown);
    xhr.onerror = lost;
    xhr.onabort = lost;
    xhr.ontimeout = lost;
    xhr.open("POST", url);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.send(body);
  });
}

export default function PhotoUpload({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const [view, set_view] = useState<PhotoView>(actionData ?? loaderData);

  const preview = view.state === "uploading" ? view.preview_url : null;
  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (view.state !== "ready" && view.state !== "failed") return;
    const form = e.currentTarget;
    const input = form.elements.namedItem("photo") as HTMLInputElement;
    // `required` keeps an empty pick from submitting at all
    const file = input.files?.[0];
    if (!file || hold_unfit(input)) return;
    const body = new FormData(form);
    const { campaign } = view;
    set_view({
      state: "uploading",
      campaign,
      file_name: file.name,
      preview_url: URL.createObjectURL(file),
      loaded: 0,
      // the body's own length replaces it with the first progress event
      total: file.size,
    });
    send_photo(form.action, body, campaign, (loaded, total) =>
      set_view((v) => (v.state === "uploading" ? { ...v, loaded, total } : v))
    ).then(set_view);
  };

  return (
    <PhotoUploadPage view={view} on_submit={submit} on_pick={hold_unfit} />
  );
}

interface IShell {
  title: string;
  children?: ReactNode;
}

function Shell({ title, children }: IShell) {
  return (
    <main className="page py-16">
      <div className="card grid gap-4 max-w-xl">
        <h1 className="text-2xl font-semibold text-gray-12">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <Shell title="Something went wrong">
      <p className="text-gray-11">Reload the page to try again.</p>
    </Shell>
  );
}
