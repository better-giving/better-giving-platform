import { DrawerIcon } from "@better-giving/ui";
import { Info } from "lucide-react";
import { useId, useState } from "react";

export function Docs({ classes = "" }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const details_id = useId();

  return (
    <div className={`card shadow-lift-card ${classes}`}>
      <button
        type="button"
        className="flex items-center gap-x-4 w-full"
        aria-expanded={isExpanded}
        aria-controls={details_id}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Info className="text-gray-11 icon-xl" />
        <span className="text-lg sm:text-xl font-bold">
          Calculation Details
        </span>
        <DrawerIcon is_open={isExpanded} className="icon-xl ml-auto" />
      </button>

      <div id={details_id} hidden={!isExpanded} className="mt-8 space-y-8">
        <section>
          <h4 className="font-semibold mb-4">Better Giving Platform</h4>
          <ul className="space-y-4 list-disc pl-6">
            <li>
              Illustrative processing assumption: third-party services at about
              2%. There is no platform fee while the optional donor contribution
              stays on. Turning that ask off is a 1.5% fee.
            </li>
            <li>
              80% of donors opt to cover processing fees (based on platform
              data)
            </li>
            <li>
              Better Giving accepts all donation types (credit cards, ACH,
              digital wallets, crypto, stocks, DAF)
            </li>
          </ul>
        </section>

        <section>
          <h4 className="font-semibold mb-4">Donation Type Calculation</h4>
          <p className="mb-4">
            These are approximate percentages for U.S.-based nonprofits,
            annualized and projected for 2025 based on trends. Our calculations
            assume 50% of donors will not proceed to make a donation if their
            preferred donation method is unavailable.
          </p>
          <ul className="space-y-4 list-disc pl-6">
            <li>Credit card donations: 63% of total volume</li>
            <li>ACH/Bank Transfer donations: 10% of total volume</li>
            <li>Digital Wallet donations: 7% of total volume</li>
            <li>Cryptocurrency donations: 2% of total volume</li>
            <li>Stock donations: 6% of total volume</li>
            <li>DAF donations: 12% of total volume</li>
          </ul>
        </section>

        <section>
          <h4 className="font-semibold mb-4">Investment Returns</h4>
          <ul className="space-y-4 list-disc pl-6">
            <li>Savings: 3.4% variable interest (illustrative example)</li>
            <li>
              Sustainability Fund: 11% average annual return (illustrative
              example)
            </li>
            <li>Calculated with daily compounding</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
