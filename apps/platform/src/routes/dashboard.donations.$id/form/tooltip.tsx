import { mask_string } from "#/helpers/mask-string";

interface ITooltip {
  txId: string;
  classes?: string;
}
export function Tooltip({ txId, classes = "" }: ITooltip) {
  return (
    <p className={classes}>
      <span className="text-sm font-semibold mb-1">Transaction ID:</span>
      <span className="text-sm ml-2">{mask_string(txId)}</span>
    </p>
  );
}
