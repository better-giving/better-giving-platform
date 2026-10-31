import { Copier } from "@better-giving/ui";

// click-to-copy: `text` is what lands on the clipboard, `children` render
// inside the trigger beside the icon. `classes` is a string (→ container) or
// `{ container, icon }`. the check-mark state only appears for 700ms after a
// real click, so every cell captures the resting copy icon.

// the filing-details / deposit-panel row: value, then a bare icon trigger.
export const IconBesideValue = () => (
  <dl className="w-96 grid gap-3">
    {[
      ["EIN", "87-3758939"],
      ["Legal name", "Better Giving"],
      ["Routing number", "121000248"],
    ].map(([label, value]) => (
      <div key={label} className="flex items-center gap-2">
        <dt className="text-xs font-semibold uppercase text-gray-11 w-36 shrink-0">
          {label}
        </dt>
        <dd className="flex items-center gap-2 text-sm flex-1">
          <span className="font-semibold">{value}</span>
          <Copier
            text={value}
            classes={{
              container: "text-gray-11 hover:text-gray-12 shrink-0",
              icon: "size-4",
            }}
            size={16}
          />
        </dd>
      </div>
    ))}
  </dl>
);

// the crypto checkout: a long wallet address that must be copied verbatim.
export const WalletAddress = () => (
  <div className="w-96 bg-card rounded-card p-4 grid gap-2">
    <p className="text-xs font-semibold uppercase tracking-badge text-gray-11">
      Send ETH to this address
    </p>
    <div className="flex items-center gap-2">
      <code className="font-mono text-sm break-all flex-1">
        0x7a25CbA1f3D9e04B8c6E2Af51D0b937Ee4c8A912
      </code>
      <Copier
        text="0x7a25CbA1f3D9e04B8c6E2Af51D0b937Ee4c8A912"
        classes={{
          container: "text-gray-11 hover:text-gray-12 shrink-0",
          icon: "size-5",
        }}
        size={20}
      />
    </div>
  </div>
);

// the referrals dashboard block: id and share link, each with its own copier.
export const ReferralBlock = () => (
  <div className="w-96 bg-gray-3 p-6 rounded border">
    <div className="mb-4">
      <div className="text-sm font-medium text-gray-11 mb-1">Referral ID</div>
      <div className="flex items-center">
        <div className="text-xl font-semibold mr-2">rainforest-trust</div>
        <Copier
          text="rainforest-trust"
          classes={{
            container: "text-gray-11 hover:text-gray-12",
            icon: "size-5",
          }}
          size={20}
        />
      </div>
    </div>
    <div>
      <div className="text-sm font-medium text-gray-11 mb-1">Referral link</div>
      <div className="flex items-center">
        <p className="text-primary truncate max-w-xs font-mono text-sm">
          https://app.better.giving/register?referrer=rainforest-trust
        </p>
        <Copier
          text="https://app.better.giving/register?referrer=rainforest-trust"
          classes={{
            container: "text-gray-11 hover:text-gray-12 ml-2",
            icon: "size-5",
          }}
          size={20}
        />
      </div>
    </div>
  </div>
);

// with a label inside the trigger — the wire-transfer memo panel.
export const LabeledTrigger = () => (
  <div className="w-96 bg-card rounded-card p-4">
    <p className="text-sm text-gray-11 mb-3">
      Include this code with your transfer of $1,200.00 so we can match the
      deposit.
    </p>
    <div className="flex items-center justify-between gap-4">
      <code className="text-lg font-bold font-mono tracking-wide break-all">
        BG-4821-OCEAN
      </code>
      <Copier
        text="BG-4821-OCEAN"
        classes={{
          container:
            "shrink-0 px-4 py-2 text-sm font-semibold text-primary-fg bg-primary rounded flex items-center gap-2",
        }}
      >
        Copy
      </Copier>
    </div>
  </div>
);
