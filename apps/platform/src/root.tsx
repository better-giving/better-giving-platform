import { show_toast } from "@better-giving/ui";
import { useEffect } from "react";
import { type LinksFunction, type MetaFunction, Outlet } from "react-router";
import { metas } from "#/helpers/seo";
import { use_route_focus } from "#/hooks/use-route-focus";
import type { Route } from "./+types/root";
import laira from "./assets/images/flying-character.webp";
import tailwind from "./index.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: tailwind },
  {
    rel: "service-desc",
    href: "/openapi.json",
    type: "application/openapi+json",
  },
];

export const meta: MetaFunction = () => metas({});

export { action } from "./root-action";
export { Layout } from "./root-layout";
export { loader } from "./root-loader";

export function HydrateFallback() {
  return (
    <img
      className="place-self-center animate-pulse"
      src={laira}
      width={300}
      height={300}
      alt=""
    />
  );
}

export { ErrorBoundary } from "#/components/error";
export default function Root({ loaderData: data }: Route.ComponentProps) {
  use_route_focus();
  useEffect(() => {
    if (!data?.toast) return;
    const { type, message } = data.toast;
    show_toast({
      type:
        type === "success" ? "success" : type === "error" ? "error" : "info",
      message,
    });
  }, [data?.toast]);
  return <Outlet />;
}
