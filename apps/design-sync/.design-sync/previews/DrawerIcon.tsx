import { DrawerIcon } from "@better-giving/ui";

// a chevron that rotates 180deg when is_open — the disclosure affordance on
// every select trigger, combobox and expandable panel in the app.

export const Closed = () => (
  <div className="flex items-center justify-between w-72 rounded-card px-3 py-2 bg-card">
    <span className="text-sm">How does employer matching work?</span>
    <DrawerIcon is_open={false} size={24} className="text-gray-11" />
  </div>
);

export const Open = () => (
  <div className="w-72 rounded-card bg-card overflow-clip">
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-sm">How does employer matching work?</span>
      <DrawerIcon is_open={true} size={24} className="text-gray-11" />
    </div>
    <p className="text-sm text-gray-11 border-t px-3 py-2">
      Your employer matches your gift dollar for dollar, up to $1,200.00 a year.
    </p>
  </div>
);

// as it appears on a select trigger — size 20, beside the chosen value.
export const OnSelectTrigger = () => (
  <div className="flex flex-col gap-3">
    <button
      type="button"
      className="flex items-center justify-between w-72 rounded-card px-3 py-2 bg-card text-sm"
    >
      <span>Rainforest Trust</span>
      <DrawerIcon is_open={false} size={20} className="text-gray-11" />
    </button>
    <button
      type="button"
      className="flex items-center justify-between w-72 rounded-card px-3 py-2 bg-card text-sm"
    >
      <span>Ocean Conservancy</span>
      <DrawerIcon is_open={true} size={20} className="text-gray-11" />
    </button>
  </div>
);

// the three sizes in use across the app: 18 (referral explainer), 20
// (selectors), 24 (dashboard panels).
export const Sizes = () => (
  <div className="flex items-end gap-6 text-gray-11">
    <span className="flex flex-col items-center gap-1">
      <DrawerIcon is_open={false} size={18} />
      <span className="text-2xs">18</span>
    </span>
    <span className="flex flex-col items-center gap-1">
      <DrawerIcon is_open={false} size={20} />
      <span className="text-2xs">20</span>
    </span>
    <span className="flex flex-col items-center gap-1">
      <DrawerIcon is_open={false} size={24} />
      <span className="text-2xs">24</span>
    </span>
  </div>
);
