import { Accordion } from "@better-giving/ui";

const items = [
  {
    value: "1",
    trigger: "How does my donation work to benefit nonprofits?",
    content: (
      <p>
        Better Giving handles all donation processing and reporting, and grants
        your donation 100% to the charitable organization you selected.
      </p>
    ),
  },
  {
    value: "2",
    trigger: "Can I receive a tax receipt?",
    content: (
      <p>
        Yes! We will email you a tax receipt immediately after your donation.
      </p>
    ),
  },
  {
    value: "3",
    trigger: "How much does Better Giving charge?",
    content: (
      <p>
        It is free to set up and use a Better Giving account. No subscriptions.
        No upfront costs.
      </p>
    ),
  },
];

export const Compact = () => <Accordion className="w-96" items={items} />;

export const Divided = () => (
  <Accordion className="w-96" variant="divided" items={items} />
);

export const Box = () => (
  <section className="card w-96">
    <Accordion
      variant="box"
      heading_level={2}
      items={[
        {
          value: "receipts",
          trigger: (
            <span className="grid gap-1">
              <span className="text-lg font-semibold">Tax receipts</span>
              <span className="text-sm font-normal text-gray-11">
                When and how you get one.
              </span>
            </span>
          ),
          content: (
            <div className="grid gap-4 border-t border-hairline pt-4 text-sm">
              <p className="text-gray-11">
                We will email you a tax receipt immediately after your donation.
              </p>
            </div>
          ),
        },
      ]}
    />
  </section>
);
