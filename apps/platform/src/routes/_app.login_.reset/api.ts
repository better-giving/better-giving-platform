import { valibotResolver } from "@hookform/resolvers/valibot";
import { type ActionFunction, redirect } from "react-router";
import { getValidatedFormData } from "remix-hook-form";
import { safeParse } from "valibot";
import { auth, request_password_reset } from "#/.server/auth";
import { report_error } from "#/errors/report";
import type { IFormInvalid } from "#/types/action";
import { resp, search } from "@/helpers/https";
import type { Route } from "./+types/route";
import {
  email_schema,
  type IEmailSchema,
  type IPasswordSchema,
  password_schema,
} from "./schema";
import { type LoaderData, step } from "./types";

export const loader = ({ url }: Route.LoaderArgs) => {
  const { redirect: redir = "/", error, ..._step } = search(url);

  // better-auth appends ?error=INVALID_TOKEN when reset link expires
  if (error && _step.type === "set-password" && _step.email) {
    const to = new URL(url);
    to.searchParams.set("type", "expired");
    to.searchParams.set("email", _step.email);
    to.searchParams.delete("token");
    to.searchParams.delete("error");
    throw redirect(to.pathname + to.search);
  }

  const p = safeParse(step, _step);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  return {
    redirect: redir,
    step: p.output,
  } satisfies LoaderData;
};

export const action: ActionFunction = async ({ request, url }) => {
  const fv = await request.formData();

  if (fv.get("intent") === "confirm") {
    const payload = await getValidatedFormData<IPasswordSchema>(
      fv,
      valibotResolver(password_schema),
      true
    );

    if (payload.errors) return payload;

    const token = fv.get("token")?.toString() || "";
    try {
      await auth.api.resetPassword({
        body: { newPassword: payload.data.password, token },
      });
    } catch {
      const to = new URL(url);
      const email = fv.get("email")?.toString() || "";
      to.searchParams.set("type", "expired");
      to.searchParams.set("email", email);
      to.searchParams.delete("token");
      return redirect(to.toString());
    }

    const to = new URL(url);
    to.searchParams.set("type", "success");
    return redirect(to.toString());
  }

  // default: init step — send reset email
  const payload = await getValidatedFormData(fv, valibotResolver(email_schema));
  if (payload.errors) return payload;

  const email = payload.data.email;

  try {
    await request_password_reset(email, request);
  } catch (err) {
    report_error(err);
    return {
      errors: {
        email: { message: "Failed to send reset email", type: "value" },
      },
      receivedValues: payload.receivedValues,
    } satisfies IFormInvalid<IEmailSchema>;
  }

  const to = new URL(url);
  to.searchParams.set("type", "set-password");
  to.searchParams.set("email", email);
  // token will arrive via email link
  return redirect(to.toString());
};
