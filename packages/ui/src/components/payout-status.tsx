/** the payout status vocabulary, declared here rather than imported: a design
 * system owns no domain module. it mirrors `PayoutStatus["type"]` in the app's
 * `lib/payouts`, and a type the app adds there that this union lacks stops the
 * call site type-checking, which is the point. */
export type PayoutStatusType =
  | "error"
  | "settled"
  | "pending"
  | "processing"
  | "refunded"
  | "refunded_loss"
  | "cancelled"
  | "returned"
  | "void";

interface IConfig {
  text: string;
  dot: string;
  label: string;
}

const configs: Record<PayoutStatusType, IConfig> = {
  pending: {
    text: "text-warning-subtle-fg",
    dot: "bg-warning",
    label: "Pending",
  },
  // in flight like pending; the ledger has no separate in-progress pair
  processing: {
    text: "text-warning-subtle-fg",
    dot: "bg-warning",
    label: "Processing",
  },
  settled: {
    text: "text-success-subtle-fg",
    dot: "bg-success",
    label: "Settled",
  },
  error: {
    text: "text-destructive-subtle-fg",
    dot: "bg-destructive",
    label: "Error",
  },
  refunded: {
    text: "text-destructive-subtle-fg",
    dot: "bg-destructive",
    label: "Refunded",
  },
  refunded_loss: {
    text: "text-success-subtle-fg",
    dot: "bg-success",
    label: "Settled",
  },
  cancelled: {
    text: "text-gray-11",
    dot: "bg-gray-11",
    label: "Cancelled",
  },
  // the bank sent it back and the money is in the balance again: owed, like
  // pending, so the same warning step-12 ink
  returned: {
    text: "text-warning-subtle-fg",
    dot: "bg-warning",
    label: "Returned",
  },
  // never a payout: the hollow dot keeps it apart from cancelled's filled one
  void: {
    text: "text-gray-11",
    dot: "ring-1 ring-inset ring-gray-11",
    label: "Void",
  },
};

const fallback: IConfig = {
  text: "text-gray-11",
  dot: "bg-gray-11",
  label: "",
};

interface IPayoutStatus {
  type: PayoutStatusType;
  classes?: string;
}

export function PayoutStatus({ type, classes = "" }: IPayoutStatus) {
  const cfg = configs[type] ?? { ...fallback, label: type };
  return (
    <span
      className={`${classes} inline-flex items-center gap-2 text-xs font-medium ${cfg.text}`}
    >
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
