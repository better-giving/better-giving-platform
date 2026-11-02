import { CircleCheck } from "lucide-react";
import { Link } from "react-router";
import { login_url } from "#/helpers/login-url";
import type { Route } from "./+types/route";

export { loader } from "../_app.signup/loader";
export default function Page({ loaderData: to }: Route.ComponentProps) {
  return (
    <div className="solo-card justify-items-center">
      <CircleCheck className="text-primary size-16 sm:size-20" />

      <h1 className="text-center text-xl sm:text-2xl font-bold mt-6">
        Account created successfully
      </h1>
      <p className="text-center max-sm:text-sm mt-2">
        You can now proceed to sign in to your account
      </p>

      <Link to={login_url(to)} className="btn btn-lg btn-primary mt-9 w-full">
        Continue to sign in
      </Link>
    </div>
  );
}
