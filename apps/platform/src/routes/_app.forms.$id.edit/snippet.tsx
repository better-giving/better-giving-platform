import { Copier } from "@better-giving/ui";

type Props = {
  classes?: string;
  form_id: string;
  base_url: string;
};
export function Snippet({ classes = "", form_id, base_url }: Props) {
  /** allow payment https://docs.stripe.com/payments/payment-methods/pmd-registration?dashboard-or-api=dashboard#using-an-iframe */
  const iframe_url = `<iframe src="${base_url}/forms/${form_id}" allow="payment" width="700" height="900" style="border:0px"></iframe>`;

  return (
    <div className={`${classes} relative`}>
      <p className="text-sm gap-x-1 mb-1">
        Copy snippet below and paste into your website
      </p>
      <div className="flex p-4 rounded bg-gray-3 divide-x divide-hairline">
        {/* wraps at the snippet's spaces; a src longer than the well scrolls */}
        <div className="flex-1 min-w-0 overflow-x-auto scrollbars pr-2">
          <code className="block text-sm font-mono whitespace-pre-wrap">
            {iframe_url}
          </code>
        </div>
        <Copier
          classes={{
            icon: "size-5 hover:text-primary",
            container: "ml-2",
          }}
          text={iframe_url}
        />
      </div>
    </div>
  );
}
