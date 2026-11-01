import { api_error } from "@/helpers/api-error";

const not_found = () =>
  api_error("not_found", "No API endpoint matches this path.");

export const loader = not_found;
export const action = not_found;
