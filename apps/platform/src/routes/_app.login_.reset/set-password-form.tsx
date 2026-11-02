import { PasswordInput } from "@better-giving/ui";
import { useFetcher } from "react-router";
import { useRemixForm } from "remix-hook-form";
import type { IPasswordSchema } from "./schema";

type Props = {
  email: string;
  token: string;
};

export function SetPasswordForm(props: Props) {
  const fetcher = useFetcher();
  const {
    register,
    formState: { errors },
  } = useRemixForm<IPasswordSchema>({ fetcher });

  return (
    <fetcher.Form method="POST" className="solo-card">
      <input type="hidden" name="email" value={props.email} />
      <input type="hidden" name="token" value={props.token} />
      {/* password managers skip type="hidden", so without this the new
       * password is saved with no account. unnamed: not part of the payload */}
      <input
        type="text"
        autoComplete="username"
        value={props.email}
        readOnly
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      />
      <h1 className="text-center text-xl sm:text-2xl font-bold">
        Set new password
      </h1>
      <p className="text-center max-sm:text-sm mt-2">
        Enter a new password for{" "}
        <span className="font-medium">{props.email}</span>
      </p>

      <div className="mt-6 grid gap-3">
        <PasswordInput
          {...register("password")}
          error={errors.password?.message}
          label="New Password"
          placeholder="New Password"
          autoComplete="new-password"
        />
        <PasswordInput
          {...register("password_confirmation")}
          error={errors.password_confirmation?.message}
          label="Confirm New Password"
          placeholder="Confirm New Password"
          autoComplete="new-password"
        />
      </div>

      <div className="mt-6 text-xs leading-5">
        In order to protect your account, make sure your password:
        <ul className="list-disc list-inside">
          <li className="ml-2">Has at least 8 characters</li>
          <li className="ml-2">Contains at least 1 number</li>
          <li className="ml-2">Contains at least 1 special character</li>
          <li className="ml-2">Contains at least 1 uppercase letter</li>
          <li className="ml-2">Contains at least 1 lowercase letter</li>
        </ul>
      </div>

      <button
        name="intent"
        value="confirm"
        disabled={fetcher.state !== "idle"}
        type="submit"
        className="mt-6 w-full btn btn-lg btn-primary"
      >
        Confirm
      </button>
    </fetcher.Form>
  );
}
