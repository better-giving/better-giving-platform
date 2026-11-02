import type { TStatus } from "@/reg";

export const statuses: { [status in TStatus | ""]: string } = {
  "": "All",
  "01": "Incomplete",
  "02": "Under review",
  "03": "Approved",
  "04": "Rejected",
};
