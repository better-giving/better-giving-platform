import { Button, Label } from "@better-giving/ui";
import type { ReactNode } from "react";
import { data } from "react-router";
import { upload_limits } from "@/constants/upload";
import { read_photo_page, save_photo } from "$/connector/photo-page";
import { db } from "$/pg/db";
import type { Route } from "./+types/photo-upload.$token";

// signed out by design: the token in the path is the whole credential
export async function loader({ params }: Route.LoaderArgs) {
  const { page, status } = await read_photo_page(db, params.token);
  return data(page, { status });
}

// every status explicit: the loader reruns after the action and reads the
// spent link as 404, and a 200 left implicit would let that status win
export async function action({ request, params }: Route.ActionArgs) {
  const { page, status } = await save_photo(db, request, params.token);
  return data(page, { status });
}

/** static, so a thrown error answered by this route's boundary carries them too */
export function headers() {
  return {
    "Cache-Control": "no-store",
    // the token is in the url; a referer would hand it to the next host
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex",
  };
}

export function meta() {
  return [
    { title: "Add a campaign photo - Better Giving" },
    { name: "robots", content: "noindex" },
  ];
}

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_MB = upload_limits.max_bytes / (1024 * 1024);

interface IUploadForm {
  error?: string;
}

function UploadForm({ error }: IUploadForm) {
  return (
    <form method="post" encType="multipart/form-data" className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="photo" required>
          Photo
        </Label>
        <input
          id="photo"
          type="file"
          name="photo"
          accept={ACCEPT}
          required
          aria-describedby={error ? "photo-error" : undefined}
          aria-invalid={error ? true : undefined}
        />
        {error && (
          <p
            id="photo-error"
            role="alert"
            className="text-destructive-subtle-fg text-sm"
          >
            {error}
          </p>
        )}
      </div>
      <Button variant="primary" type="submit" classes="justify-self-start">
        Upload photo
      </Button>
    </form>
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

export default function PhotoUpload({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const page = actionData ?? loaderData;
  switch (page.state) {
    case "gone":
      return (
        <Shell title="This link can't be used">
          <p className="text-gray-11">
            This upload link has expired or was already used. Ask for a new one.
          </p>
        </Shell>
      );
    case "limited":
      return (
        <Shell title="Too many uploads">
          <p className="text-gray-11">
            Wait a minute, then reload this page and try again.
          </p>
        </Shell>
      );
    case "saved":
      return (
        <Shell title="Photo added">
          <img src={page.photo} alt="" className="rounded w-full" />
          <p className="text-gray-11">
            It's now the banner of {page.campaign}. You can close this tab.
          </p>
        </Shell>
      );
    case "failed":
      return (
        <Shell title="The photo couldn't be saved">
          <p className="text-gray-11">
            Nothing changed on {page.campaign}. Try again.
          </p>
          <UploadForm />
        </Shell>
      );
    case "ready":
      return (
        <Shell title={`Add a photo to ${page.campaign}`}>
          <p className="text-gray-11">
            It becomes the campaign's banner. JPEG, PNG or WebP, up to {MAX_MB}{" "}
            MB.
          </p>
          <UploadForm error={page.error} />
        </Shell>
      );
  }
}

export function ErrorBoundary() {
  return (
    <Shell title="Something went wrong">
      <p className="text-gray-11">Reload the page to try again.</p>
    </Shell>
  );
}
