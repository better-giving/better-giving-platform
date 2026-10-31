import { tokens_map } from "@better-giving/crypto";
import { Modal, show_toast, use_ask_prompt } from "@better-giving/ui";
import { useState } from "react";
import { PayQr } from "#/components/donation";
import { error_prompt } from "#/helpers/error-prompt";
import type { Payment } from "#/types/crypto";
import { ru_vdec } from "@/helpers/decimal";

interface IQrModal extends Payment {
  on_close: () => void;
}
interface Props {
  payment_id: number | string;
  classes?: string;
}
export function PaymentResumer({ payment_id, classes }: Props) {
  const ask_prompt = use_ask_prompt();
  const [intent_state, set_intent_state] = useState<"pending">();
  const [qr, set_qr] = useState<IQrModal>();

  return (
    <>
      <button
        disabled={intent_state === "pending"}
        type="button"
        className={`${classes} text-xs text-primary`}
        onClick={async () => {
          try {
            set_intent_state("pending");
            const res = await fetch(`/api/crypto-intents/${payment_id}`);
            if (res.status === 410) {
              return show_toast({
                type: "error",
                message: "Donation is already processing.",
              });
            }
            const payment: Payment = await res.json();
            set_qr({
              ...payment,
              on_close: () => set_qr(undefined),
            });
          } catch (err) {
            set_qr(undefined);
            ask_prompt(error_prompt(err), { key: "payment-resume" });
          } finally {
            set_intent_state(undefined);
          }
        }}
      >
        {intent_state === "pending" ? "Loading..." : "Finish paying"}
      </button>
      {qr && <QrModal {...qr} on_close={() => set_qr(undefined)} />}
    </>
  );
}

function QrModal(props: IQrModal) {
  const token = tokens_map[props.currency];
  return (
    <Modal
      open={true}
      onClose={props.on_close ?? (() => {})}
      classes="grid bg-card px-4 py-8"
    >
      <h4 className="text-lg text-center mb-2">
        Donation to {props.description}
      </h4>

      <p className="text-gray-11 text-balance text-center mb-3.5 max-w-sm justify-self-center">
        To complete your donation, send{" "}
        {ru_vdec(props.amount, props.usdpu, token.precision)}
        &nbsp;
        {token.symbol} from your crypto wallet to the address below
      </p>

      <PayQr
        token={token}
        recipient={props.address}
        extraId={props.extra_address ?? null}
      />
    </Modal>
  );
}
