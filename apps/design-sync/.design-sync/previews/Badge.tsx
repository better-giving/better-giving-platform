import { Badge } from "@better-giving/ui";

export const Tones = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge tone="neutral">Templates</Badge>
    <Badge tone="primary">Whitepapers</Badge>
    <Badge tone="success">Guides</Badge>
    <Badge tone="warning">Pending review</Badge>
    <Badge tone="destructive">closed</Badge>
    <Badge tone="secondary">ends in 3 days</Badge>
  </div>
);

export const Medium = () => (
  <div className="flex flex-wrap items-center gap-2 max-w-md">
    <Badge size="md" tone="secondary">
      Built by and for nonprofits
    </Badge>
    <Badge size="md" tone="secondary">
      Open source
    </Badge>
    <Badge size="md" tone="secondary">
      Apple / Google Pay
    </Badge>
  </div>
);

export const OnPrimary = () => (
  <div className="surface-primary grid gap-3 p-8 rounded justify-items-start">
    <Badge size="md" tone="on-primary">
      Long-term growth
    </Badge>
    <span className="text-2xl font-bold">Sustainability Fund</span>
  </div>
);
