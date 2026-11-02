import { QrCode } from "@ark-ui/react/qr-code";
import { type IToken, is_custom } from "@better-giving/crypto";
import { Copier } from "@better-giving/ui";
import { logo_url } from "@/constants/common";

interface Props {
  classes?: string;
  token: IToken;
  recipient: string;
  extraId: string | null;
}

/** what the coin calls the extra id the deposit address needs */
const extra_id_label = (token: IToken) =>
  token.network === "xrp" ? "Destination tag" : "Memo";

export function PayQr({ classes = "", ...props }: Props) {
  const label = extra_id_label(props.token);
  return (
    <div className={`${classes} grid justify-items-center`}>
      <QrCode.Root
        value={props.recipient}
        pixelSize={192}
        className="mb-3.5 relative bg-white w-fit"
        style={{ color: "#000" }}
      >
        <QrCode.Frame className="w-48 h-48 fill-current">
          <QrCode.Pattern />
        </QrCode.Frame>
        <QrCode.Overlay className="bg-white p-0.5">
          <img
            src={logo_url(props.token.logo, is_custom(props.token.id))}
            alt=""
            width={20}
            height={20}
          />
        </QrCode.Overlay>
      </QrCode.Root>
      {props.extraId && (
        <p className="text-sm text-warning-subtle-fg bg-warning-subtle rounded p-2 mb-3.5 max-w-xs text-center">
          Include this {label.toLowerCase()} with your transfer. Without it we
          can't credit your donation.
        </p>
      )}
      <p className="text-sm mb-4">{props.recipient}</p>
      <Copier
        text={props.recipient}
        classes={{
          container: "flex items-center gap-2 px-2 py-1.5 rounded border",
          icon: "size-5",
        }}
      >
        <span className="text-sm">Copy address</span>
      </Copier>
      {props.extraId && (
        <Memo classes="mt-4" val={props.extraId} label={label} />
      )}
    </div>
  );
}

interface IMemo {
  val: string;
  label: string;
  classes?: string;
}
function Memo({ val, label, classes = "" }: IMemo) {
  return (
    <div className={`grid justify-items-center ${classes}`}>
      <p className="text-sm mb-2">
        <span className="sr-only">{label}: </span>
        {val}
      </p>
      <Copier
        text={val}
        classes={{
          container: "flex items-center gap-2 px-2 py-1.5 rounded border",
          icon: "size-5",
        }}
      >
        <span className="text-sm">Copy {label}</span>
      </Copier>
    </div>
  );
}
