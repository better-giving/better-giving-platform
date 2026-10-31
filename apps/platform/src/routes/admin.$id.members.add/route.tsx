import { Field, Modal, RmxForm } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import type { MetaFunction } from "react-router";
import { useNavigate, useNavigation, useRouteLoaderData } from "react-router";
import { useRemixForm } from "remix-hook-form";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { type ISchema, schema } from "./schema";

export { ErrorModal as ErrorBoundary } from "#/components/error";
export { add_action as action } from "./api";

export const meta: MetaFunction = ({ matches }) =>
  admin_page_meta("Invite User", matches);

export default function Page() {
  const navigate = useNavigate();
  return (
    <Modal
      open={true}
      onClose={() =>
        navigate("..", { preventScrollReset: true, replace: true })
      }
      classes="p-6 bg-card"
    >
      <Content />
    </Modal>
  );
}

function Content() {
  const ldta = useRouteLoaderData<{ admins: Array<{ email: string }> }>(
    "routes/admin.$id.members"
  );
  const { admins = [] } = ldta ?? {};
  const nav = useNavigation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useRemixForm<ISchema>({
    resolver: valibotResolver(schema(admins.map((a) => a.email))),
  });

  return (
    <RmxForm
      onSubmit={handleSubmit}
      disabled={nav.state !== "idle"}
      busy={nav.state === "submitting"}
      method="POST"
      className="w-full grid gap-4"
    >
      <h4 className="text-center text-xl font-bold mb-4">Invite User</h4>
      <Field
        {...register("email")}
        label="Email"
        required
        error={errors.email?.message}
      />
      <Field
        {...register("first_name")}
        label="First name"
        required
        error={errors.first_name?.message}
      />
      <Field
        {...register("last_name")}
        label="Last name"
        error={errors.last_name?.message}
        required
      />
      <button
        type="submit"
        disabled={nav.state !== "idle"}
        className="btn btn-primary mt-6"
      >
        Add member
      </button>
    </RmxForm>
  );
}
