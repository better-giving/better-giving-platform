import { ContentLoader } from "@better-giving/ui";

// ContentLoader is a bare pulsing block — it has no intrinsic size, so every
// usage supplies its own height/width classes.

export const Lines = () => (
  <div className="flex w-96 flex-col gap-3">
    <ContentLoader className="h-4 w-48" />
    <ContentLoader className="h-4 w-full" />
    <ContentLoader className="h-4 w-full" />
    <ContentLoader className="h-4 w-64" />
  </div>
);

// mirrors routes/_app.marketplace_.$id/skeleton.tsx — the nonprofit profile
// while its loader resolves.
export const ProfileSkeleton = () => (
  <div className="w-full max-w-2xl rounded-card bg-card p-6">
    <div className="flex items-center gap-4">
      <ContentLoader className="size-16 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <ContentLoader className="h-5 w-56" />
        <ContentLoader className="h-4 w-32" />
      </div>
    </div>
    <ContentLoader className="mt-6 h-40 w-full" />
    <div className="mt-6 flex flex-col gap-2">
      <ContentLoader className="h-4 w-full" />
      <ContentLoader className="h-4 w-full" />
      <ContentLoader className="h-4 w-72" />
    </div>
  </div>
);

// a donations table waiting on its page of rows: the header is real, the
// cells are loaders.
export const TableRows = () => (
  <div className="w-full max-w-2xl overflow-hidden rounded-card bg-card">
    <div className="flex items-center gap-4 border-b bg-gray-3 px-4 py-3 text-xs font-medium text-gray-11">
      <span className="flex-1">Donor</span>
      <span className="w-32">Date</span>
      <span className="w-24 text-right">Amount</span>
    </div>
    <div className="divide-y">
      {["a", "b", "c", "d"].map((row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-4">
          <div className="flex-1">
            <ContentLoader className="h-4 w-48" />
          </div>
          <div className="w-32">
            <ContentLoader className="h-4 w-24" />
          </div>
          <div className="flex w-24 justify-end">
            <ContentLoader className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

// mirrors routes/_app.fundraisers.$fund_id/skeleton.tsx — four fundraiser
// cards holding the grid's shape.
export const CardGrid = () => (
  <div className="grid w-full max-w-2xl grid-cols-2 gap-6">
    <ContentLoader className="h-40 rounded shadow-lift-media" />
    <ContentLoader className="h-40 rounded shadow-lift-media" />
    <ContentLoader className="h-40 rounded shadow-lift-media" />
    <ContentLoader className="h-40 rounded shadow-lift-media" />
  </div>
);

// a summary tile whose figure is still loading — the label is real copy so the
// page keeps its meaning while the number arrives.
export const StatTile = () => (
  <div className="flex gap-6">
    <div className="w-56 rounded-card bg-card p-5">
      <p className="text-sm text-gray-11">Raised this month</p>
      <ContentLoader className="mt-3 h-8 w-32" />
    </div>
    <div className="w-56 rounded-card bg-card p-5">
      <p className="text-sm text-gray-11">Next payout</p>
      <ContentLoader className="mt-3 h-8 w-40" />
    </div>
  </div>
);
