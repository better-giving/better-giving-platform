import { Actions, Field, Form, Label } from "@better-giving/ui";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { ImgEditor } from "#/components/img-editor";
import { use_session } from "#/hooks/use-session";
import type { Route } from "./+types/route";
import { avatar_spec, use_rhf } from "./use-rhf";

export { action, loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export { ErrorBoundary } from "#/components/error";

export default CacheRoute(Page);
function Page({ loaderData: data }: Route.ComponentProps) {
  const { revalidate } = use_session();
  const fetcher = useFetcher();
  useEffect(() => {
    if (fetcher.data !== undefined) revalidate();
  }, [fetcher.data, revalidate]);
  const rhf = use_rhf(data);

  return (
    <div className="w-full max-w-4xl px-6 py-4 md:px-10 md:py-8">
      <h2 className="text-3xl mb-6">User Profile</h2>
      <Form
        disabled={fetcher.state === "submitting"}
        onReset={(e) => {
          e.preventDefault();
          rhf.reset();
        }}
        onSubmit={rhf.handleSubmit(async (fv) => {
          const { df } = rhf;
          const update = Object.fromEntries(
            Object.keys(df).map((k) => [k, fv[k as keyof typeof fv]])
          );

          fetcher.submit(update, {
            encType: "application/json",
            action: ".",
            method: "PATCH",
          });
        })}
        className="card"
      >
        <Label htmlFor="user-avatar" className="mb-2">
          Avatar
        </Label>
        <ImgEditor
          id="user-avatar"
          ref={rhf.avatar_url.ref}
          spec={avatar_spec}
          value={rhf.avatar_url.value}
          on_change={(v) => {
            rhf.avatar_url.onChange(v);
            rhf.trigger("avatar_url");
          }}
          on_undo={(e) => {
            e.stopPropagation();
            rhf.resetField("avatar_url");
          }}
          classes={{
            container: "mb-4",
            dropzone: "w-60 aspect-square rounded-full",
          }}
          error={rhf.errors.avatar_url?.message}
        />

        <Field
          {...rhf.register("first_name")}
          label="First name"
          placeholder="First name"
          classes={{ container: "mt-16" }}
          required
          error={rhf.errors.first_name?.message}
        />

        <Field
          {...rhf.register("last_name")}
          label="Last name"
          placeholder="Last name"
          required
          classes={{ container: "mt-4" }}
          error={rhf.errors.last_name?.message}
        />

        <Actions classes="mt-8">
          <button
            type="reset"
            className="btn-secondary btn"
            disabled={!rhf.isDirty}
          >
            Reset changes
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!rhf.isDirty || rhf.avatar_url.value === "loading"}
          >
            Submit changes
          </button>
        </Actions>
      </Form>
    </div>
  );
}
