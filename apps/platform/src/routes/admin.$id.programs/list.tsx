import { EmptyState } from "@better-giving/ui";
import { Layers } from "lucide-react";
import type { IProgramDb } from "@/npo";
import { Program } from "./program";

export function List({ programs }: { programs: IProgramDb[] }) {
  return (
    <div className="@container grid gap-3">
      {programs.length === 0 ? (
        <div className="card">
          <EmptyState
            heading="No programs yet"
            icon={<Layers className="icon-xl" />}
          >
            Programs you add will show up here.
          </EmptyState>
        </div>
      ) : (
        programs.map((p) => <Program {...p} key={p.id} />)
      )}
    </div>
  );
}
