import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { mask_string } from "#/helpers/mask-string";
import type { IBalanceTx } from "@/balance-txs";

interface IRowMeta {
  icon: ReactNode;
  description: ReactNode;
}

interface IDescription {
  id: string;
  text: string;
}
export const Description = (props: IDescription) => {
  return (
    <p>
      {props.text}{" "}
      <span className="text-xs text-gray-11">{mask_string(props.id, 4)}</span>
    </p>
  );
};

/** pov: investments */
export const row_meta = (data: IBalanceTx): IRowMeta => {
  // always positive
  if (data.account_other === "donation") {
    return {
      icon: <ArrowRight className="text-success icon-md" />,
      description: <Description text="Donation" id={data.account_other_id!} />,
    };
  }

  if (data.account_other === "dividend") {
    return {
      icon: <ArrowRight className="text-success icon-md" />,
      description: <Description text="Dividend" id={data.account_other_id!} />,
    };
  }
  // always negative
  if (data.account_other === "refund") {
    return {
      icon: <ArrowLeft className="text-destructive icon-md" />,
      description: <Description text="Refund" id={data.account_other_id!} />,
    };
  }
  // always negative
  if (data.account_other === "grant") {
    return {
      icon: <ArrowLeft className="text-destructive icon-md" />,
      description: <Description text="Grant" id={data.account_other_id!} />,
    };
  }
  // record-only correction, sign decides the arrow
  if (data.account_other === "adjustment") {
    return {
      icon:
        data.bal_end - data.bal_begin > 0 ? (
          <ArrowRight className="text-success icon-md" />
        ) : (
          <ArrowLeft className="text-destructive icon-md" />
        ),
      description: <Description text="Balance adjustment" id={data.id} />,
    };
  }
  // investments
  const flow = data.bal_end - data.bal_begin > 0 ? "in" : "out";
  return {
    icon:
      flow === "in" ? (
        <ArrowRight className="text-success icon-md" />
      ) : (
        <ArrowLeft className="text-destructive icon-md" />
      ),
    description: (
      <Description
        text={`Transfer ${flow === "in" ? "from" : "to"} savings`}
        id={flow === "in" ? data.account_other_id! : data.id}
      />
    ),
  };
};
