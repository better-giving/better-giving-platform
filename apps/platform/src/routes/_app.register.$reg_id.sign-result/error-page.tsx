import { CircleAlert } from "lucide-react";
import { href, Link, useFetcher } from "react-router";
import type { ErrorQueryParams } from "./types";

export default function ErrorPage(props: ErrorQueryParams) {
  const fetcher = useFetcher();

  const isRedirecting = fetcher.state === "submitting";
  // the redirect's query carries these, and either can arrive empty or absent
  const detail = [props.error, props.message].filter(Boolean).join(": ");
  return (
    <fetcher.Form method="POST">
      <div className="bg-destructive rounded-full aspect-square grid place-items-center mb-4 size-16">
        <CircleAlert className="text-destructive-fg pictogram-sm" />
      </div>
      <h1 className="text-2xl text-center">Signing failed</h1>
      {detail && (
        <p className="bg-gray-3 p-4 text-sm text-gray-11 mt-4">{detail}</p>
      )}
      <button
        name="signer_eid"
        value={props.signerEid}
        type="submit"
        disabled={isRedirecting}
        className="w-full max-w-105 btn btn-primary mt-6"
      >
        Retry
      </button>
      <Link
        className="w-full max-w-105 btn-secondary btn mt-4"
        to={href("/register")}
        aria-disabled={isRedirecting}
      >
        Back
      </Link>
    </fetcher.Form>
  );
}
