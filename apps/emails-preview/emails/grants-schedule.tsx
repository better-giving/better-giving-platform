import { grants_schedule } from "emails";

const { node } = grants_schedule.template({
  rows: [
    {
      id: 1,
      name: "Save The Rainforest",
      amount: 250,
      min: 50,
      effect: "pass",
    },
    {
      id: 2,
      name: "Ocean Cleanup Fund",
      amount: 30,
      min: 50,
      effect: "skipped",
    },
    { id: 3, name: "Local Food Bank", amount: 1200, min: 100, effect: "pass" },
    {
      id: 1293826,
      name: "SXM Paws",
      amount: 4812.4,
      min: 100,
      effect: "manual_wire",
      net: 4200,
      deductions: [
        { donation_id: "8f3a2c10-5d71-4b9e-a6c3-1e07d9b45f28", usd: 412.4 },
        { donation_id: "c91e07b4-2a68-4f35-8d0c-6b13a5e7f902", usd: 200 },
      ],
    },
  ],
  total_grant: 1450,
  wise_usd_balance: 2000,
  report_period: "2605",
  low_balance: false,
});

export default () => node;
