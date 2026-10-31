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
};

export type LinkGroup = {
  title?: string;
  links: Link[];
};
