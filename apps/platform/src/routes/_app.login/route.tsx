import {
  ExtLink,
  Image,
  Input,
  PasswordInput,
  RmxForm,
  Separator,
} from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { eq } from "drizzle-orm";
import { Mail } from "lucide-react";
import {
  href,
  Link,
  redirect,
  useNavigation,
  useSearchParams,
} from "react-router";
import { getValidatedFormData, useRemixForm } from "remix-hook-form";
import { auth, get_session, request_password_reset } from "#/.server/auth";
import { check_email_url, request_login_link } from "#/.server/auth/login-link";
import { is_sign_in_throttled } from "#/.server/auth/sign-in";
import { dataWithError } from "#/.server/toast";
import googleIcon from "#/assets/icons/google.svg";
import { report_error } from "#/errors/report";
import { login_url, signup_url } from "#/helpers/login-url";
import type { IFormInvalid } from "#/types/action";
import { type ISignIn, sign_in } from "#/types/auth";
import { search } from "@/helpers/https";
import { safe_redirect } from "@/helpers/safe-redirect";
import { db } from "$/pg/db";
import { user_npos } from "$/pg/queries/user";
import { account, user as userTable } from "$/pg/schema/auth";
import type { Route } from "./+types/route";
import { retry_form_action } from "./oauth-error";

export const action = async ({ request }: Route.ActionArgs) => {
  try {
    const from = new URL(request.url);
    const asked_to = safe_redirect(from.searchParams.get("redirect"), null);
    const redirect_to = asked_to || href("/marketplace");
    const { user } = await get_session(request);
    if (user) return redirect(redirect_to);

    const fv = await request.formData();

    if (fv.get("intent") === "oauth") {
      const res = await auth.api.signInSocial({
        body: {
          provider: "google",
          callbackURL: asked_to ?? href("/login"),
          // better-auth appends `error`, which the login page explains.
          // login_url() always writes ?redirect=, and that pin would win over
          // the single-org home once they try again.
          errorCallbackURL: asked_to ? login_url(asked_to) : href("/login"),
        },
        headers: request.headers,
        asResponse: true,
      });
      // must forward set-cookie so browser receives state/pkce cookie
      // https://www.better-auth.com/docs/reference/errors/state_mismatch
      const location = res.headers.get("location");
      if (location) {
        const headers = new Headers();
        const cookie = res.headers.get("set-cookie");
        if (cookie) headers.set("set-cookie", cookie);
        return redirect(location, { headers });
      }
      return redirect(redirect_to);
    }

    const payload = await getValidatedFormData<ISignIn>(
      fv,
      valibotResolver(sign_in)
    );
    if (payload.errors) return payload;
    const email = payload.data.email.toLowerCase();

    let res: Response;
    try {
      res = await auth.api.signInEmail({
        body: { email, password: payload.data.password },
        headers: request.headers,
        asResponse: true,
      });
    } catch (err) {
      if (!is_sign_in_throttled(err)) throw err;
      return {
        errors: { password: { type: "value", message: err.message } },
        receivedValues: payload.receivedValues,
      } satisfies IFormInvalid<ISignIn>;
    }

    if (!res.ok) {
      const err = await res.json();

      // better-auth cannot tell these two apart — both are a user row with no
      // credential to check a password against, so both come back as
      // INVALID_EMAIL_OR_PASSWORD. only `emailVerified` separates them.
      const accountless =
        err.code === "INVALID_EMAIL_OR_PASSWORD"
          ? await accountless_user(email)
          : null;

      // the address is unproven, whether or not a password sits on it. the link
      // both proves it and signs them in — and prompting for a password here
      // would be worse than useless: better-auth deletes credentials set before
      // verification the moment the next link is used.
      if (err.code === "EMAIL_NOT_VERIFIED" || accountless === "unverified") {
        const link_to = asked_to ?? href("/login");
        await request_login_link({
          email,
          redirect_to: link_to,
          headers: request.headers,
        });
        return redirect(check_email_url({ email, redirect_to: link_to }));
      }

      // MIGRATED ONLY — a proven address that predates the migration and so
      // carries no credential. delete this arm and `accountless_user`'s
      // "verified" case together once that population is gone.
      if (accountless === "verified") {
        const origin = from.origin;
        try {
          await request_password_reset(email, request);
        } catch {
          // the reset screen still offers a resend, so a failed mail is not a
          // dead end — better than the generic "invalid credentials" they'd
          // otherwise get for a password that does not exist.
        }

        const reset_url = new URL(`${origin}/login/reset`);
        reset_url.searchParams.set("type", "migrated");
        reset_url.searchParams.set("email", email);
        if (asked_to) reset_url.searchParams.set("redirect", asked_to);
        return redirect(reset_url.toString());
      }

      return {
        errors: {
          password: {
            type: "value",
            message: err.message || "Invalid credentials",
          },
        },
        receivedValues: payload.receivedValues,
      } satisfies IFormInvalid<ISignIn>;
    }

    const headers = new Headers();
    const cookie = res.headers.get("set-cookie");
    if (cookie) headers.set("set-cookie", cookie);
    // asked_to is already a safe path. the lookup below only picks a home
    // when none was asked — a throw there is a 500 that drops this cookie.
    if (asked_to != null) return redirect(asked_to, { headers });
    const [signed_in] = await db
      .select({ id: userTable.id, role: userTable.role })
      .from(userTable)
      .where(eq(userTable.email, email));
    const home = signed_in
      ? await post_auth_destination(signed_in)
      : href("/marketplace");
    return redirect(asked_to ?? home, { headers });
  } catch (err) {
    report_error(err);
    return dataWithError(null, "Unknown error occurred", { status: 500 });
  }
};

/** `null` unless the address names a user row with no account row at all — no
 * password, no social. two populations look like that and need opposite
 * remedies, so the proof state comes back with it: an unverified row is a lead
 * one of the marketing forms created, a verified one predates the migration.
 * A social-only account keeps its row and is deliberately not matched here. */
async function accountless_user(
  email: string
): Promise<"verified" | "unverified" | null> {
  const [row] = await db
    .select({ id: userTable.id, verified: userTable.emailVerified })
    .from(userTable)
    .where(eq(userTable.email, email));
  if (!row) return null;

  const [acct] = await db
    .select({ id: account.id })
    .from(account)
    .where(eq(account.userId, row.id));
  if (acct) return null;

  return row.verified ? "verified" : "unverified";
}

// role "admin" is the platform role, not an org membership.
async function post_auth_destination(user: {
  id: string;
  role?: string | null;
}): Promise<string> {
  if (user.role === "admin") return href("/marketplace");
  const memberships = await user_npos(user.id);
  if (memberships.length === 1) {
    return href("/admin/:id/dashboard", { id: String(memberships[0].id) });
  }
  return href("/marketplace");
}

export const loader = async ({ request }: Route.LoaderArgs) => {
  const { user } = await get_session(request);
  const to = safe_redirect(search(request).redirect, null);
  if (user) return redirect(to ?? (await post_auth_destination(user)));
  return to || href("/marketplace");
};

export const meta: Route.MetaFunction = () => [
  { title: "Login - Better Giving" },
  { name: "robots", content: "noindex" },
];

interface IOAuthError {
  /** better-auth's `error` code on a failed google sign-in */
  code: string;
  to: string;
}

function OAuthError({ code, to }: IOAuthError) {
  if (code !== "account_not_linked") {
    return <>Google sign-in didn't finish. Please try again.</>;
  }
  // signup with an address that already has an unconfirmed row mails a link
  return (
    <>
      An account with this email hasn't been confirmed yet.{" "}
      <Link to={signup_url(to)} className="font-medium underline">
        Get a fresh sign-in link
      </Link>{" "}
      by signing up with the same email.
    </>
  );
}

export { ErrorBoundary } from "#/components/error";
export default function Page({ loaderData: to }: Route.ComponentProps) {
  const nav = useNavigation();
  const [params] = useSearchParams();
  const oauth_error = params.get("error");
  const form_action = retry_form_action(params);

  const {
    handleSubmit,
    register,
    formState: { errors },
  } = useRemixForm<ISignIn>({
    resolver: valibotResolver(sign_in),
  });

  const form_id = "signin-form";
  const is_submitting = nav.state !== "idle";

  return (
    <div className="grid justify-items-center gap-3.5 px-4 py-14 text-gray-11">
      <div className="solo-card">
        <h1 className="text-center text-3xl font-bold text-gray-12">
          Philanthropy for Everyone
        </h1>
        <p className="text-center max-sm:text-sm mt-2">
          Log in to support great causes or register and manage your nonprofit.
        </p>
        {oauth_error && (
          <p
            role="alert"
            className="mt-4 rounded bg-destructive-subtle text-destructive-subtle-fg px-4 py-3 max-sm:text-sm"
          >
            <OAuthError code={oauth_error} to={to} />
          </p>
        )}
        <RmxForm
          disabled={is_submitting}
          busy={nav.state === "submitting"}
          method="POST"
          action={form_action}
          className="contents"
        >
          <button
            name="intent"
            value="oauth"
            type="submit"
            className="btn btn-secondary btn-field gap-2 mt-6"
          >
            <Image src={googleIcon} height={18} width={18} />
            <span className="font-semibold">Continue with Google</span>
          </button>
        </RmxForm>
        <Separator classes="my-4 before:mr-3.5 after:ml-3.5 before:bg-gray-6 after:bg-gray-6 font-medium text-xs text-gray-11">
          OR
        </Separator>
        <RmxForm
          id={form_id}
          onSubmit={handleSubmit}
          method="POST"
          action={form_action}
          disabled={is_submitting}
          className="grid gap-3"
        >
          <div>
            <label htmlFor="login-email" className="label mb-1">
              Email
            </label>
            <Input
              {...register("email")}
              id="login-email"
              placeholder="Email address"
              autoComplete="username"
              icon={Mail}
              error={errors.email?.message}
            />
          </div>
          <PasswordInput
            {...register("password")}
            label="Password"
            error={errors.password?.message}
            placeholder="Password"
          />
          <Link
            to={`${href("/login/reset")}?redirect=${encodeURIComponent(to)}`}
            className="font-medium link text-xs sm:text-sm justify-self-end"
          >
            Forgot password?
          </Link>
        </RmxForm>
        <button
          disabled={is_submitting}
          form={form_id}
          type="submit"
          className="btn btn-field btn-primary w-full mt-4"
        >
          Log In
        </button>
        <span className="flex-center gap-1 max-sm:text-sm mt-8">
          Don't have an account?
          <Link
            to={signup_url(to)}
            className="link aria-disabled:text-gray-11 font-medium underline"
            aria-disabled={is_submitting}
          >
            Sign up
          </Link>
        </span>
      </div>
      <span className="text-xs sm:text-sm text-center w-80">
        By signing in, you agree to our{" "}
        <ExtLink href={href("/privacy-policy")} className="link">
          Privacy Policy
        </ExtLink>
        ,{" "}
        <ExtLink href={href("/terms-of-use")} className="link">
          Terms of Use (Donors)
        </ExtLink>
        , and{" "}
        <ExtLink href={href("/terms-of-use-npo")} className="link">
          Terms of Use (Nonprofits)
        </ExtLink>
      </span>
    </div>
  );
}
