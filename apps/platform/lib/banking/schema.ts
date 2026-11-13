import * as v from "valibot";
import { $req, file_obj, int_gte1 } from "../schemas";

const statuses = ["default", "under-review", "approved", "rejected"] as const;

export const status_flags = {
  default: 0,
  "under-review": 1,
  approved: 2,
  rejected: 3,
} as const;

export const status = v.picklist(statuses);
export type TStatus = v.InferOutput<typeof status>;

export const update = v.pipe(
  v.object({
    type: v.picklist(["approved", "rejected"]),
    reason: v.optional(v.pipe(v.string(), v.trim())),
  }),
  v.forward(
    v.partialCheck(
      [["type"], ["reason"]],
      (input) => (input.type === "rejected" ? !!input.reason : true),
      "required"
    ),
    ["reason"]
  )
);

export const new_bank = v.object({
  wiseRecipientID: $req,
  endowmentID: int_gte1,
  bankSummary: v.pipe($req, v.minLength(7)), // currency (3) + account number(last 4 digits)
  bankStatementFile: file_obj,
});

export interface IUpdate extends v.InferOutput<typeof update> {}
