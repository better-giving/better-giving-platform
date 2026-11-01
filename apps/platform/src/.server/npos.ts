import { report_error } from "#/errors/report";
import type { INpoItem, INposPage } from "@/npo/interfaces";
import type { INposSearchObj } from "@/npo/schema";
import { npo_search } from "$/pg/queries/npo";

/** a page of the search, each item cut to `fields` when given; a failed
 * query throws */
export async function search_npos(params: INposSearchObj): Promise<INposPage> {
  const { fields, ...rest } = params;
  const result = await npo_search(rest);

  if (fields?.length) {
    return { ...result, items: project(result.items, fields) as INpoItem[] };
  }
  return result;
}

/** `search_npos`, with a failed query reported and read as an empty page */
export async function get_npos(params: INposSearchObj): Promise<INposPage> {
  try {
    return await search_npos(params);
  } catch (err) {
    report_error(err);
    return { items: [], page: 1, pages: 1 };
  }
}

function project(
  items: INpoItem[],
  fields: (keyof INpoItem)[]
): Partial<INpoItem>[] {
  const keys = new Set<keyof INpoItem>([...fields, "id"]);
  return items.map((item) => {
    const out: Partial<INpoItem> = {};
    for (const k of keys) {
      (out as any)[k] = item[k];
    }
    return out;
  });
}
