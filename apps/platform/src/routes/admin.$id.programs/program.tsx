import { Image, LoaderRing } from "@better-giving/ui";
import { Link, useFetcher } from "react-router";
import { routes } from "#/pages/admin/routes";
import type { IProgramDb } from "@/npo";

export function Program(props: IProgramDb) {
  const fetcher = useFetcher();

  const isDeleting = fetcher.state !== "idle";

  return (
    <div
      className={`${isDeleting ? "bg-gray-3 rounded-card p-6" : "card"} grid @lg:flex items-center gap-x-4 gap-y-4`}
    >
      <div className="flex items-center gap-x-4 @lg:contents">
        <Image
          src={props.banner}
          alt="program banner"
          className="w-10 aspect-square object-cover"
        />
        <p className="font-bold">{props.title}</p>
      </div>

      {isDeleting ? (
        <LoaderRing thickness={10} classes="@lg:ml-auto w-6" />
      ) : (
        <fetcher.Form
          method="DELETE"
          className="flex items-center gap-x-4 @lg:contents"
        >
          <button
            type="submit"
            name="programId"
            value={props.id}
            className="btn-secondary btn w-24 @lg:ml-auto"
          >
            delete
          </button>
          <Link
            to={`../${routes.program_editor}/${props.id}`}
            className="btn-secondary btn w-24"
          >
            edit
          </Link>
        </fetcher.Form>
      )}
    </div>
  );
}
