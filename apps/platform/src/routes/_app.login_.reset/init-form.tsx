import { Input } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Mail } from "lucide-react";
import { Link, useFetcher } from "react-router";
import { useRemixForm } from "remix-hook-form";
import { login_url } from "#/helpers/login-url";
import { email_schema, type IEmailSchema } from "./schema";

type Props = { to: string };

export function InitForm(props: Props) {
  const fetcher = useFetcher();
  const {
    handleSubmit,
    register,
    formState: { errors },
  } = useRemixForm<IEmailSchema>({
    fetcher,
    resolver: valibotResolver(email_schema),
  });

  return (
    <fetcher.Form method="POST" onSubmit={handleSubmit} className="solo-card">
      <h1 className="text-center text-xl sm:text-2xl font-bold">
        Reset your password
      </h1>
      <p className="mt-2 text-center max-sm:text-sm">
        Enter your registered email to reset password
      </p>

      <Input
        {...register("email")}
        placeholder="Email address"
        classes={{ container: "mt-6" }}
        icon={Mail}
        error={errors.email?.message}
      />

      <button
        disabled={fetcher.state !== "idle"}
        type="submit"
        className="mt-6 w-full btn btn-lg btn-primary"
      >
        {fetcher.state !== "idle" ? "Sending..." : "Send Code"}
      </button>

      <Link
        to={login_url(props.to)}
        className="mt-5 link aria-disabled:text-gray-11 max-sm:text-sm font-medium underline text-center"
        aria-disabled={fetcher.state !== "idle"}
      >
        Back to sign in
      </Link>
    </fetcher.Form>
  );
}
