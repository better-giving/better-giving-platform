import {
  type ActionFunction,
  type LoaderFunction,
  redirect,
} from "react-router";
import { resume_application } from "#/pages/registration/resume-application";

/** `/register` carries the resume strip. skew protection has no `.data`
 * pinning, so old documents still linking here get a redirect, and old ones
 * still POSTing a reference here are still honored. */
export const loader: LoaderFunction = () => redirect("/register");

export const action: ActionFunction = async ({ request, url }) => {
  const fd = await request.formData();
  return resume_application(request, url, fd);
};
