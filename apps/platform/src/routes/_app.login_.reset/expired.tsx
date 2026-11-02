import { CircleAlert } from "lucide-react";
import { Link, useFetcher } from "react-router";
import { login_url } from "#/helpers/login-url";

type Props = { email: string; to: string };

export function Expired(props: Props) {
  const fetcher = useFetcher();

  return (
    <div className="solo-card justify-items-center">
      <div className="grid place-items-center size-16 sm:size-20 rounded-full bg-secondary">
        <CircleAlert className="size-8 sm:size-10 text-destructive" />
      </div>

      <h1 className="text-center text-xl sm:text-2xl font-bold mt-5">
        Link expired
      </h1>
      <p className="mt-3 max-sm:text-sm leading-relaxed text-center">
        This password reset link has expired or is no longer valid. Request a
        new one and it will be sent to{" "}
        <span className="font-medium">{props.email}</span>.
      </p>

      <fetcher.Form method="POST" className="w-full mt-6">
        <input type="hidden" name="email" value={props.email} />
        <button
          disabled={fetcher.state !== "idle"}
          type="submit"
          className="w-full btn btn-lg btn-primary"
        >
          {fetcher.state !== "idle" ? "Sending..." : "Resend reset email"}
        </button>
      </fetcher.Form>

      <Link
        to={login_url(props.to)}
        className="mt-5 link max-sm:text-sm font-medium underline text-center"
      >
        Back to sign in
      </Link>
    </div>
  );
}
