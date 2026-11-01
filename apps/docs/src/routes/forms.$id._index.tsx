import { redirect } from "react-router";
import type { Route } from "./+types/forms.$id._index";

// GET /forms/:id -> /forms/:id/custom-dimensions, passing through any query
// params. this is the index of the forms/:id layout, so bare /forms/:id lands
// here.
export function loader({ params, url }: Route.LoaderArgs) {
  return redirect(`/forms/${params.id}/custom-dimensions${url.search}`);
}
