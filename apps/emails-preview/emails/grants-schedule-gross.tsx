import { grants_schedule } from "emails";

// a run that nets nothing owed: no row carries a net or deductions
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
    },
  ],
  total_grant: 1450,
  wise_usd_balance: 2000,
  report_period: "2605",
  low_balance: false,
});

export default () => node;
