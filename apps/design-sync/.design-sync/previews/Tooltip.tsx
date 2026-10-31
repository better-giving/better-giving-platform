import { Tooltip } from "@better-giving/ui";
import { useEffect, useRef } from "react";

// Tooltip owns its `open` state internally (no `open` prop), so a static
// preview has to trigger it: the Ark trigger opens on click, and the harness
// screenshots after mount. `Content` is not on the design-system export
// surface, so the tip is a plain popover-styled div — Ark's Positioner places
// it and Tooltip renders its own arrow either way.
function useAutoOpen() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = box.current?.querySelector<HTMLElement>(
      '[data-scope="tooltip"][data-part="trigger"]'
    );
    t?.click();
  }, []);
  return box;
}

const tip_cls =
  "bg-card text-gray-12 px-4 py-2 rounded-card text-sm shadow-floating";

export const Open = () => {
  const box = useAutoOpen();
  return (
    <div ref={box} className="pt-2 pb-24">
      <Tooltip tip={<div className={tip_cls}>Verified nonprofit</div>}>
        <button type="button" className="btn btn-secondary">
          Rainforest Trust
        </button>
      </Tooltip>
    </div>
  );
};

export const LongTip = () => {
  const box = useAutoOpen();
  return (
    <div ref={box} className="pt-2 pb-32">
      <Tooltip
        tip={
          <div className={`${tip_cls} max-w-xs`}>
            Funds held in Fidelity Government Money Market (SPAXX) consisting of
            cash, US Government Securities and Repurchase Agreements
          </div>
        }
      >
        <button type="button" className="btn btn-secondary">
          Savings balance
        </button>
      </Tooltip>
    </div>
  );
};

export const OnFigure = () => {
  const box = useAutoOpen();
  return (
    <div ref={box} className="pt-2 pb-28">
      <div className="rounded-card bg-card p-4 w-72">
        <h4 className="font-medium">Payouts</h4>
        <p className="text-lg font-medium mt-2">$1,200.00</p>
        <div className="mt-3 flex items-center">
          <Tooltip
            tip={
              <div className={`${tip_cls} max-w-xs`}>
                Settled transfers to your bank account, net of processing fees.
              </div>
            }
          >
            <button type="button" className="text-gray-11 text-sm underline">
              How is this calculated?
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
