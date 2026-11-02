import { Mail } from "lucide-react";
import { Link } from "react-router";
import { login_url } from "#/helpers/login-url";

type Props = { email: string; to: string };

export function CheckEmail(props: Props) {
  return (
    <div className="solo-card justify-items-center">
      <div className="grid place-items-center size-16 sm:size-20 rounded-full bg-secondary">
        <Mail className="size-8 sm:size-10 text-primary" />
      </div>

      <h1 className="text-center text-xl sm:text-2xl font-bold mt-5">
        Check your email
      </h1>
      <p className="mt-3 max-sm:text-sm leading-relaxed text-center">
        We've sent a password reset link to{" "}
        <span className="font-medium">{props.email}</span>. Check your inbox and
        spam folder, then click the link to set your new password.
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
