import { KeyRound, Mail } from "lucide-react";
import { Link } from "react-router";
import { login_url } from "#/helpers/login-url";

type Props = { email: string; to: string };

export function MigratedInfo(props: Props) {
  return (
    <div className="solo-card justify-items-center">
      <div className="grid place-items-center size-16 sm:size-20 rounded-full bg-secondary">
        <KeyRound className="size-8 sm:size-10 text-primary" />
      </div>

      <h1 className="text-center text-xl sm:text-2xl font-bold mt-5">
        Welcome back!
      </h1>
      <p className="mt-3 max-sm:text-sm leading-relaxed text-center">
        We've upgraded our platform and need you to set a new password to keep
        your account secure.
      </p>

      <div className="mt-5 w-full rounded bg-secondary px-4 py-3 flex items-start gap-3">
        <Mail className="icon-xl shrink-0 text-primary mt-0.5" />
        <p className="max-sm:text-sm leading-relaxed">
          A reset link was sent to{" "}
          <span className="font-medium">{props.email}</span>. Check your inbox
          and spam folder.
        </p>
      </div>

      <p className="mt-4 text-xs text-gray-11 text-center">
        This is a one-time step — once you set your password, you can log in
        normally.
      </p>

      <Link
        to={login_url(props.to)}
        className="btn btn-lg btn-primary mt-6 w-full"
      >
        Back to sign in
      </Link>
    </div>
  );
}
