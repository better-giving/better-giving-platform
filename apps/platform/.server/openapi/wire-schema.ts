import { type JsonSchema, toJsonSchema } from "@valibot/to-json-schema";
import type { GenericSchema } from "valibot";

/** checks the route enforces that JSON Schema can't express; the wire schema
 * is looser by exactly these */
const UNEXPRESSED = ["trim", "custom", "excludes"];

/**
 * The JSON Schema of what a request may send for `schema`: its input side,
 * so a query string the route splits on commas reads as the string it is.
 * Draft 2020-12 is OpenAPI 3.1's dialect. Reused sub-schemas are inlined: an
 * emitted `#/$defs/…` would resolve against the OpenAPI document, not here.
 */
export function wire_schema(schema: GenericSchema): JsonSchema {
  const { $schema, $defs, ...root } = toJsonSchema(schema, {
    target: "draft-2020-12",
    typeMode: "input",
    errorMode: "throw",
    ignoreActions: UNEXPRESSED,
    overrideAction: ({ valibotAction: action, jsonSchema, errors }) => {
      // a second regex-backed check: both must match, so it joins as an allOf
      const regex = "requirement" in action ? action.requirement : null;
      if (errors && jsonSchema.pattern && regex instanceof RegExp) {
        return {
          ...jsonSchema,
          allOf: [...(jsonSchema.allOf ?? []), { pattern: regex.source }],
        };
      }
      return undefined;
    },
  });
  return inline(root, ($defs ?? {}) as Record<string, JsonSchema>);
}

function inline(node: unknown, defs: Record<string, JsonSchema>): JsonSchema {
  if (Array.isArray(node)) {
    return node.map((x) => inline(x, defs)) as unknown as JsonSchema;
  }
  if (!node || typeof node !== "object") return node as JsonSchema;
  const { $ref, ...rest } = node as { $ref?: string };
  if (typeof $ref === "string" && $ref.startsWith("#/$defs/")) {
    const def = defs[$ref.slice("#/$defs/".length)];
    return inline({ ...def, ...rest }, defs);
  }
  return Object.fromEntries(
    Object.entries(node).map(([k, v]) => [k, inline(v, defs)])
  ) as JsonSchema;
}
