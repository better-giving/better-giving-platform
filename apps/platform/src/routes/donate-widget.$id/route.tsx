import { ErrorStatus } from "@better-giving/ui";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";
import { Content } from "./content";
import { parse_config } from "./parse-config";

export { loader } from "#/api/donate-loader";
export { ErrorBoundary } from "#/components/error";

export const meta: Route.MetaFunction = ({ loaderData: d, location: l }) => {
  if (!d) return [];
  const { endow } = d;
  return metas({
    title: `Donate to ${endow.name}`,
    description: endow.tagline?.slice(0, 140),
    name: endow.name,
    image: endow.image || endow.logo,
    url: `${base_url}${l.pathname}`,
  });
};

export default function Page({ loaderData }: Route.ComponentProps) {
  const { endow, program, user, base_url } = loaderData;
  const [search] = useSearchParams();

  /** Hide the Intercom chatbot */
  useEffect(() => {
    const w = window as any;
    if ("Intercom" in w) {
      w.Intercom("update", { hide_default_launcher: true });
      w.Intercom("hide");
    }
  }, []);

  const config = parse_config(search);

  //validation error
  if ("error" in config) {
    return <ErrorStatus classes="h-full">{config.error}</ErrorStatus>;
  }

  const { accentPrimary, accentSecondary } = config;

  const styles: Record<string, string | undefined> = {
    "--form-primary": accentPrimary,
    "--form-secondary": accentSecondary,
  };

  return (
    <div
      style={styles}
      // no blot ground on a nonprofit's page (src/index.css)
      data-surfaces="embed"
      className="grid grid-rows-[1fr_auto] justify-items-center gap-10"
    >
      <Content
        base_url={base_url}
        npo={endow}
        user={user}
        program={
          program
            ? {
                id: program.id.toString(),
                name: program.title,
              }
            : undefined
        }
        config={config}
      />
    </div>
  );
}
