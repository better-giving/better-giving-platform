import { ExtLink } from "@better-giving/ui";
import { app_name } from "#/constants/env";
import { PRIVACY_POLICY, TERMS_OF_USE_DONOR } from "#/constants/urls";
import { DEDUCTIBILITY_STATEMENT } from "@/constants/common";

interface Props {
  classes?: string;
  endowName: string;
}
export function DonationTerms({ classes = "", endowName }: Props) {
  return (
    <p className={`${classes} text-sm leading-normal text-gray-11`}>
      {DEDUCTIBILITY_STATEMENT} Your donation is made to {app_name}, a
      tax-exempt US 501(c)(3) charity that grants unrestricted funds to{" "}
      {endowName} on your behalf. As a legal matter, {app_name} must provide any
      donations to {endowName} on an unrestricted basis, regardless of any
      designations or restrictions made by you. By making a donation to{" "}
      {app_name}, you agree to our{" "}
      <A href={TERMS_OF_USE_DONOR}>Terms of Service</A>,{" "}
      <A href={PRIVACY_POLICY}>Privacy Policy</A>.
    </p>
  );
}

const A: typeof ExtLink = ({ className, ...props }) => {
  return <ExtLink {...props} className={`${className} font-medium link`} />;
};
