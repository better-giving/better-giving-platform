import { Badge } from "@better-giving/ui";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="neutral">Templates</Badge>
    <Badge variant="primary">Whitepapers</Badge>
    <Badge variant="success">Guides</Badge>
    <Badge variant="warning">Pending review</Badge>
    <Badge variant="destructive">Closed</Badge>
  </div>
);

export const Quiet = () => (
  <div className="flex flex-wrap items-center gap-2 max-w-md">
    <Badge variant="quiet">Card</Badge>
    <Badge variant="quiet">Bank / ACH</Badge>
    <Badge variant="quiet">Apple / Google Pay</Badge>
  </div>
);

export const Outline = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="outline">Ended</Badge>
  </div>
);
