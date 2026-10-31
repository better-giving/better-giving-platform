import type { Config, IProgram } from "#/components/donation";
import {
  all_method_ids,
  type DonationRecipient,
  type IUser,
  Steps,
} from "#/components/donation";
import type { IWidgetSearchObj } from "#/types/widget";
import type { IIncrement } from "@/schemas";
import type { INpoPublic } from "$/pg/queries/npo";

type Props = {
  npo: INpoPublic;
  config: IWidgetSearchObj;
  program: IProgram | undefined;
  user: IUser | undefined;
  classes?: string;
  base_url: string;
};

export function Content({
  npo,
  config,
  program,
  user,
  base_url,
  classes = "",
}: Props) {
  const recipient: DonationRecipient = {
    id: npo.id.toString(),
    name: npo.name,
    hide_bg_tip: npo.hide_bg_tip,
    members: [],
    donor_address_required: npo.donor_address_required,
  };

  const ms: any = config.methods ?? all_method_ids;
  const incs_str = config.increments || [];
  const incs_labels = config.descriptions || [];
  const incs: IIncrement[] = incs_str.map((val, idx) => ({
    value: val,
    label: incs_labels[idx] || "",
  }));

  const c: Config = {
    id: null,
    method_ids: ms,
    accent_primary: config.accentPrimary,
    accent_secondary: config.accentSecondary,
    increments: incs,
    success_redirect: undefined,
    freq_opts: undefined,
  };

  return (
    <div
      className={`${classes} w-full grid gap-5 content-start justify-items-center`}
    >
      {config.isTitleShown && (
        <h1 className="text-center w-full text-lg sm:text-3xl text-pretty">
          {config.title || `Donate to ${npo.name}`}
        </h1>
      )}
      {config.isDescriptionTextShown && (
        <p className="text-xs text-center sm:text-base">
          {config.description ||
            "Select your preferred payment option from our comprehensive donation choices and get an immediate tax receipt for your records."}
        </p>
      )}
      <Steps
        base_url={base_url}
        source="bg-widget"
        mode="live"
        classes="w-full border rounded-card"
        recipient={recipient}
        config={c}
        user={user}
        program={program}
      />
    </div>
  );
}
