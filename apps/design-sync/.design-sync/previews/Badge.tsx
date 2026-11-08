import { Badge } from "@better-giving/ui";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="neutral">Templates</Badge>
    <Badge variant="primary">Whitepapers</Badge>
    <Badge variant="success">Guides</Badge>
    <Badge variant="warning">Pending review</Badge>
    <Badge variant="destructive">closed</Badge>
  </div>
);
