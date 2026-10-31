import { Badge, type BadgeTone } from "@better-giving/ui";
import { Download, ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import { type Resource, type ResourceType, TYPE_LABELS } from "./data";

const badge_tones: Record<ResourceType, BadgeTone> = {
  templates: "neutral",
  guides: "success",
  whitepapers: "primary",
};

export function ResourceCard({ resource }: { resource: Resource }) {
  const [pending, set_pending] = useState(false);
  return (
    <div className="card grid grid-rows-[auto_auto_1fr_auto_auto] gap-3">
      <div className="flex items-center gap-3">
        <FileText className="text-primary shrink-0 icon-xl" />
        <Badge tone={badge_tones[resource.type]}>
          {TYPE_LABELS[resource.type]}
        </Badge>
      </div>

      <h3 className="font-semibold leading-snug">{resource.name}</h3>

      <p className="text-sm text-gray-11 leading-relaxed">
        {resource.description}
      </p>

      <div className="flex gap-2 mt-1">
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            set_pending(true);
            try {
              const res = await fetch(resource.url);
              const blob = await res.blob();
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = resource.url.split("/").pop() || "download.pdf";
              a.click();
              URL.revokeObjectURL(a.href);
            } finally {
              set_pending(false);
            }
          }}
          className="btn btn-sm btn-primary gap-1.5"
        >
          <Download className="icon-sm" />
          {pending ? "Downloading..." : "Download"}
        </button>
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm btn-secondary gap-1.5"
        >
          <ExternalLink className="icon-sm" />
          View
        </a>
      </div>

      {resource.size && <p className="text-xs text-gray-11">{resource.size}</p>}
    </div>
  );
}
