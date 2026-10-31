import { chains, is_custom } from "@better-giving/crypto";
import { Image } from "@better-giving/ui";
import { logo_url, PROCESSING_RATES } from "@/constants/common";
import { min_fee_allowance } from "@/helpers/donation";
import { Summary } from "../../common/summary";
import { token } from "../../common/token";
import { use_donation } from "../../context";
import { type CryptoDonationDetails, tip_val, to_step } from "../../types";
import { DonationTerms } from "../donation-terms";
import { DirectMode } from "./direct-mode";

export function Crypto(props: CryptoDonationDetails) {
  const { don, don_set } = use_donation();
  const { token: t, tip_format, tip, cover_processing_fee } = props;

  const tipv = tip_val(tip_format, tip, +t.amount);
  const mfa = cover_processing_fee
    ? min_fee_allowance(tipv + +t.amount, PROCESSING_RATES.crypto)
    : 0;
  const Amount = token(t.usdpu, t.precision);
  return (
    <Summary
      classes="grid content-start p-4 @xl/steps:p-8"
      on_back={() => to_step("crypto", props, "donor", don_set)}
      Amount={Amount}
      amount={+t.amount}
      fee_allowance={mfa}
      tip={
        tipv > 0 ? { value: tipv, charity_name: don.recipient.name } : undefined
      }
      pre_split_content={
        <>
          <dl className="py-3 flex items-center justify-between border-b border-hairline">
            <dt className="mr-auto">Currency</dt>
            <Image
              className="ml-auto object-cover size-4 rounded-full mr-1"
              src={logo_url(t.logo, is_custom(t.id))}
            />
            <dd>{t.symbol}</dd>
          </dl>
          <dl className="py-3 flex items-center justify-between">
            <dt className="mr-auto">Blockchain</dt>
            <dd>{chains[t.network].name}</dd>
          </dl>
        </>
      }
    >
      <DirectMode
        donor={don.donor}
        fv={props}
        init={don}
        fee_allowance={mfa}
        tipv={tipv}
        classes="mt-4"
      />
      <DonationTerms endowName={don.recipient.name} classes="mt-5" />
    </Summary>
  );
}
