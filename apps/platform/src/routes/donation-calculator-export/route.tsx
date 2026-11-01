import { safeParse } from "valibot";
import { bgView } from "#/routes/_app.donation-calculator/bg-view";
import { ogInput, ogInputDefault } from "#/types/donation-calculator";
import { search } from "@/helpers/https";
import type { Route } from "./+types/route";
import { build_pdf } from "./pdf/build-pdf";

export async function loader({ url }: Route.LoaderArgs) {
  const res = safeParse(ogInput, search(url.searchParams));
  const view = bgView(res.issues ? ogInputDefault : res.output);

  const pdf_bytes = await build_pdf(view);

  return new Response(Buffer.from(pdf_bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=better-giving-report.pdf",
      "Cache-Control": "no-store",
    },
  });
}
