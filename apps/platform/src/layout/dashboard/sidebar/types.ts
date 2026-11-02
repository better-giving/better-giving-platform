import type { Church } from "lucide-react";

export type Link = {
  title: string;
  to: string;
  /** drawn at `icon-md` by the sidebar, so every row keeps one pitch */
  icon: {
    fn: typeof Church;
  };
  end?: boolean;
  disabled?: boolean;
  /** paths, relative like `to`, whose pages belong to this link but don't sit
   *  under it — `program-editor` under `programs`. the mobile opener names the
   *  link on those pages instead of falling back to "Open menu" */
  nests?: string[];
};

export type LinkGroup = {
  title?: string;
  links: Link[];
};
