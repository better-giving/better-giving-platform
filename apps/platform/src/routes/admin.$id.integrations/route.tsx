import { Connections } from "#/components/connector/connections";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { Route } from "./+types/route";
import { Display } from "./display";
import { Form } from "./form";

export { action, loader } from "./api";

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Integrations", matches);

export default function Page({
  loaderData: { apiKey, connections },
}: Route.ComponentProps) {
  return (
    <div className="grid content-start gap-6 px-6 py-4 md:px-10 md:py-8">
      <h1 className="text-3xl font-bold">Integrations</h1>
      <section className="card">
        <h2 className="text-xl font-semibold mb-2">Zapier</h2>
        <p className="text-sm mb-4">
          API key to use with Better Giving Zapier Integration
        </p>
        {apiKey ? <Display apiKey={apiKey} /> : <Form />}
      </section>
      <Connections connections={connections} />
    </div>
  );
}
