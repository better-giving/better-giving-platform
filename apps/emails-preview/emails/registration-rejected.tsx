import { registration_rejected } from "emails";

const { node } = registration_rejected.template({
  registrant_first_name: "Jane",
  rejection_reason:
    "The organization's 501(c)(3) status could not be verified. Please provide a valid IRS determination letter.",
  stripe_connected: true,
  resume_url: "https://better.giving/register/REG-2025-001234/5",
});

export default () => node;
