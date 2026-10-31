import { HoverCard } from "@better-giving/ui";
import { useEffect, useRef } from "react";

// HoverCard has no `open` prop — it opens on pointer-enter (zag POINTER_ENTER)
// or trigger focus. a static preview dispatches a mouse `pointerover` on the
// trigger at mount, so the card is painted in the shot.
// `Content` is not on the design-system export surface, so the tip is a plain
// popover-styled div; Ark's Positioner places it and renders the arrow.
function useAutoOpen() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = box.current?.querySelector<HTMLElement>(
      '[data-scope="hover-card"][data-part="trigger"]'
    );
    if (!t) return;
    t.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })
    );
  }, []);
  return box;
}

const card_cls =
  "bg-card text-gray-12 text-sm w-80 p-4 rounded-card shadow-floating";

export const Open = () => {
  const box = useAutoOpen();
  return (
    <div ref={box} className="pt-2 pb-64">
      <HoverCard
        tip={
          <div className={card_cls}>
            <span className="block mb-2 font-medium">
              Portfolio composition
            </span>
            <ul className="grid gap-1">
              <li className="flex justify-between">
                <span>Equities</span>
                <span className="font-medium">62%</span>
              </li>
              <li className="flex justify-between">
                <span>Fixed income</span>
                <span className="font-medium">28%</span>
              </li>
              <li className="flex justify-between">
                <span>Cash</span>
                <span className="font-medium">10%</span>
              </li>
            </ul>
          </div>
        }
      >
        <button type="button" className="btn btn-secondary">
          Investments
        </button>
      </HoverCard>
    </div>
  );
};

export const OnFigure = () => {
  const box = useAutoOpen();
  return (
    <div ref={box} className="pt-2 pb-64">
      <div className="rounded-card bg-card p-4 w-72">
        <h4 className="font-medium">Total raised</h4>
        <p className="text-lg font-medium mt-2">$12,800.00</p>
        <div className="mt-3 flex items-center">
          <HoverCard
            tip={
              <div className={card_cls}>
                <span className="block mb-2 font-medium">
                  Where this came from
                </span>
                <ul className="grid gap-1">
                  <li className="flex justify-between">
                    <span>Rainforest Trust</span>
                    <span className="font-medium">$8,420.00</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Ocean Conservancy</span>
                    <span className="font-medium">$3,150.00</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Books for Kids</span>
                    <span className="font-medium">$1,230.00</span>
                  </li>
                </ul>
                <p className="text-gray-11 mt-3">
                  Settled donations through Nov 14, 2025.
                </p>
              </div>
            }
          >
            <button type="button" className="text-gray-11 text-sm underline">
              See breakdown
            </button>
          </HoverCard>
        </div>
      </div>
    </div>
  );
};
