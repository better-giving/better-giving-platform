import { CircleCheck } from "lucide-react";
import { Link } from "react-router";
import { login_url } from "#/helpers/login-url";

export function Success(props: { to: string }) {
  return (
    <div className="solo-card justify-items-center">
      <CircleCheck className="text-primary size-16 sm:size-20" />

      <h1 className="text-center text-xl sm:text-2xl font-bold mt-6">
        Password reset successful
      </h1>
      <p className="text-center max-sm:text-sm mt-2">
        Your account’s password has been successfully updated.
      </p>

      <Link
        to={login_url(props.to)}
        className="btn btn-lg btn-primary mt-9 w-full"
      >
        Back to sign in
      </Link>
    </div>
  );
}
