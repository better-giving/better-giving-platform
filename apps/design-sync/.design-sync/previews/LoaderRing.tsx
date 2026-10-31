import { LoaderRing } from "@better-giving/ui";

// LoaderRing draws an SVG ring with no intrinsic size — it fills its parent, so
// every usage pins a size, either on the svg itself (`classes="w-6"`, the real
// app's convention) or on a wrapper.

export const Sizes = () => (
  <div className="flex items-end gap-8">
    <div className="flex flex-col items-center gap-3">
      <LoaderRing thickness={12} classes="w-4" />
      <span className="text-xs text-gray-11">16px — inline</span>
    </div>
    <div className="flex flex-col items-center gap-3">
      <LoaderRing thickness={12} classes="w-6" />
      <span className="text-xs text-gray-11">24px — button</span>
    </div>
    <div className="flex flex-col items-center gap-3">
      <LoaderRing thickness={12} classes="w-14" />
      <span className="text-xs text-gray-11">56px — panel</span>
    </div>
    <div className="flex flex-col items-center gap-3">
      <LoaderRing thickness={12} classes="w-24" />
      <span className="text-xs text-gray-11">96px — full page</span>
    </div>
  </div>
);

export const Thickness = () => (
  <div className="flex items-end gap-8">
    <div className="flex flex-col items-center gap-3">
      <LoaderRing thickness={6} classes="w-20" />
      <span className="text-xs text-gray-11">thickness 6</span>
    </div>
    <div className="flex flex-col items-center gap-3">
      <LoaderRing thickness={10} classes="w-20" />
      <span className="text-xs text-gray-11">thickness 10</span>
    </div>
    <div className="flex flex-col items-center gap-3">
      <LoaderRing thickness={12} classes="w-20" />
      <span className="text-xs text-gray-11">thickness 12</span>
    </div>
    <div className="flex flex-col items-center gap-3">
      <LoaderRing thickness={20} classes="w-20" />
      <span className="text-xs text-gray-11">thickness 20</span>
    </div>
  </div>
);

export const RingToColor = () => (
  <div className="flex items-start gap-6">
    <div className="flex flex-col items-center gap-3 rounded-card bg-card p-6">
      <LoaderRing
        thickness={12}
        classes={{ container: "w-20", ringToColor: "to-primary" }}
      />
      <span className="text-xs text-gray-11">to-primary — on card</span>
    </div>
    <div className="flex flex-col items-center gap-3 rounded bg-primary p-6">
      <LoaderRing
        thickness={12}
        classes={{ container: "w-20", ringToColor: "to-primary-fg" }}
      />
      <span className="text-xs text-primary-fg">
        to-primary-fg — on primary
      </span>
    </div>
  </div>
);

// mirrors routes/admin.$id.programs/program.tsx — the ring sits at the end of a
// row while that program saves.
export const InRow = () => (
  <div className="w-96 rounded-card bg-card">
    <div className="flex items-center gap-3 border-b p-4">
      <span className="text-sm text-gray-12">Clean water wells, Malawi</span>
      <LoaderRing thickness={10} classes="ml-auto w-6" />
    </div>
    <div className="flex items-center gap-3 p-4">
      <span className="text-sm text-gray-12">School meals, Nairobi</span>
      <span className="ml-auto text-sm text-gray-11">Published</span>
    </div>
  </div>
);

// mirrors prompt/prompt-icon.tsx's loading branch — the largest usage in the
// app, sized by height rather than width.
export const PageLoading = () => (
  <div className="grid justify-items-center gap-4 rounded-card bg-card px-10 py-10">
    <LoaderRing thickness={12} classes="h-24" />
    <p className="text-sm text-gray-11">Submitting your payout request...</p>
  </div>
);
