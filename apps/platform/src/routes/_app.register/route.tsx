import { Outlet } from "react-router";

export { loader } from "./api";

import type { Route } from "./+types/route";

export const meta: Route.MetaFunction = () => [
  { title: "Registration Portal" },
  { name: "robots", content: "noindex" },
];

export default function Layout({ loaderData: user }: Route.ComponentProps) {
  return (
    <div className="grid content-start justify-items-center py-8">
      <Outlet context={user} />
    </div>
  );
}
