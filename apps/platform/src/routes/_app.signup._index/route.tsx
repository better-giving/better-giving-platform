import { ExtLink, Image, Input, RmxForm, Separator } from "@better-giving/ui";
import { Mail } from "lucide-react";
import { href, Link, type MetaDescriptor, useNavigation } from "react-router";
import { useRemixForm } from "remix-hook-form";
import googleIcon from "#/assets/icons/google.svg";
import { app_name } from "#/constants/env";
import { login_url } from "#/helpers/login-url";
import type { ISignUp } from "#/types/auth";
import type { Route } from "./+types/route";

export { ErrorBoundary } from "#/components/error";
export { loader } from "../_app.signup/loader";
export { action } from "./api";

interface Terms {
  to: string;
  title: string;
}

interface Context {
  title: string;
  description: string;
  terms: Terms[];
  meta?: MetaDescriptor[];
}

const context: { [id: string]: Context } = {
  registration: {
    title: `Become a ${app_name} member`,
    description:
      "Join the nonprofit-powered fundraising platform. Raise more and grow funds together.",
    terms: [
      { to: href("/terms-of-use-npo"), title: "Terms of Use (Nonprofits)" },
    ],
  },

  referrals: {
    title: "Empower more nonprofits",
    description: `Sign up to refer organizations to ${app_name} and help them grow their impact make a difference with every connection.`,
    terms: [
      {
        to: href("/terms-of-use-referrals"),
        title: "Terms of Use (Referrals)",
      },
    ],
    meta: [
      { title: "Sign Up Referral | Better Giving" },
      {
        name: "description",
        content:
          "Join Better Giving and start sharing the good! Sign up now to get your own referral code and link, earn rewards by inviting others to give better",
      },
      { name: "robots", content: "noindex" },
    ],
  },

  donation: {
    title: "Join Better Giving",
    description: "Sign up to manage your donations",
    terms: [{ to: href("/terms-of-use"), title: "Terms of Use (Donors)" }],
  },

  fallback: {
    title: "Philanthropy for everyone",
    description:
      "Sign up to support great causes or register and manage your nonprofit.",
    terms: [
      { to: href("/terms-of-use"), title: "Terms of Use (Donors)" },
      { to: href("/terms-of-use-npo"), title: "Terms of Use (Nonprofits)" },
    ],
  },
};

const get_context = (to: string): Context => {
  if (to.startsWith(href("/register"))) return context.registration;
  if (to.startsWith(href("/dashboard/referrals"))) return context.referrals;
  return context.fallback;
};

// leaf meta replaces the layout's whole array
export const meta: Route.MetaFunction = ({ loaderData: to }) => {
  const ctx = get_context(to as string);
  return (
    ctx?.meta || [
      { title: "Sign Up - Better Giving" },
      { name: "robots", content: "noindex" },
    ]
  );
};

export default function Page({ loaderData: to }: Route.ComponentProps) {
  const ctx = get_context(to);
  const terms_0 = ctx.terms[0];
  const terms_1 = ctx.terms[1];

  const nav = useNavigation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useRemixForm<ISignUp>({});

  const form_id = "sign-up-form";
  const is_submitting = nav.state !== "idle";

  return (
    <div className="grid justify-items-center gap-3.5">
      <div className="solo-card">
        <h1 className="text-center text-balance text-2xl font-bold">
          {ctx.title}
        </h1>
        <p className="text-center text-pretty max-sm:text-sm mt-2">
          {ctx.description}
        </p>

        <RmxForm
          disabled={is_submitting}
          busy={nav.state === "submitting"}
          method="POST"
          className="contents"
        >
          <button
            name="intent"
            value="oauth"
            className="btn btn-secondary gap-2 mt-6"
            type="submit"
          >
            <Image src={googleIcon} height={18} width={18} />
            <span className="font-semibold">Sign up with Google</span>
          </button>
        </RmxForm>

        <Separator classes="my-4 before:mr-3.5 after:ml-3.5 before:bg-gray-6 after:bg-gray-6 font-medium text-xs text-gray-11">
          OR
        </Separator>

        <RmxForm
          id={form_id}
          method="POST"
          onSubmit={handleSubmit}
          disabled={is_submitting}
          className="grid gap-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <Input
              {...register("first_name")}
              placeholder="First Name"
              error={errors.first_name?.message}
            />
            <Input
              {...register("last_name")}
              placeholder="Last Name"
              error={errors.last_name?.message}
            />
          </div>
          <Input
            {...register("email")}
            autoComplete="username"
            placeholder="Email address"
            icon={Mail}
            error={errors.email?.message}
            classes={{ container: "mt-4" }}
          />
          <Input
            {...register("email_confirmation")}
            autoComplete="username"
            placeholder="Confirm email"
            icon={Mail}
            error={errors.email_confirmation?.message}
          />
        </RmxForm>

        <p className="text-center max-sm:text-sm text-gray-11 mt-4">
          We'll email you a link to confirm your address and sign you in. No
          password to choose.
        </p>

        <button
          disabled={is_submitting}
          form={form_id}
          type="submit"
          className="btn btn-lg btn-primary w-full my-8"
        >
          {is_submitting ? "Submitting..." : "Sign Up"}
        </button>

        <span className="flex-center gap-1 max-sm:text-sm">
          Already have an account?
          <Link
            to={login_url(to)}
            className="link aria-disabled:text-gray-11 font-medium underline"
            aria-disabled={is_submitting}
          >
            Login
          </Link>
        </span>
      </div>

      <span className="text-xs sm:text-sm text-center w-80">
        By signing up, you agree to our{" "}
        <ExtLink href={href("/privacy-policy")} className="link">
          Privacy Policy
        </ExtLink>
        , {!terms_1 && " and  "}
        {terms_0 && (
          <ExtLink href={terms_0.to} className="link">
            {terms_0.title}
          </ExtLink>
        )}
        {terms_0 && terms_1 && ", and  "}
        {terms_1 && (
          <ExtLink href={terms_1.to} className="link">
            {terms_1.title}
          </ExtLink>
        )}
      </span>
    </div>
  );
}
