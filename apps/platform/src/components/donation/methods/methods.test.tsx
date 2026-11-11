import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { donor_fv_blank } from "@/donations/schema";
import type { DonateMethodId } from "@/npo";
import { Steps } from "../index";

import { type Config, donation_recipient_init, type TDonation } from "../types";
import { stb } from "./__tests__/test-data";

type Screen = Awaited<ReturnType<typeof render>>;

describe("payment method form state persistence", () => {
  const all_methods_config: Config = {
    success_redirect: undefined,
    method_ids: [
      "stripe",
      "stripe_bank",
      "crypto",
      "daf",
      "stocks",
      "ira_qcd",
    ] as DonateMethodId[],
    freq_opts: undefined,
    id: null,
  };

  const fill_donor = async (screen: Screen) => {
    const email = screen.getByPlaceholder(/john@doe\.com/i);
    await expect.element(email).toBeVisible();
    await email.fill("john@doe.com");
    await screen.getByRole("textbox", { name: /first name/i }).fill("John");
    await screen.getByRole("textbox", { name: /last name/i }).fill("Doe");
  };

  interface Case {
    method: TDonation["method"];
    tab: RegExp;
    /** methods whose amount field only becomes usable once an asset is picked */
    asset?: true;
    /** crypto is the only one of these routed through the donor step */
    donor?: true;
    amount: string;
    /** what proves the trip reached this method's own checkout page */
    arrived: (screen: Screen) => Promise<void>;
  }

  const cases: Case[] = [
    {
      method: "crypto",
      tab: /crypto/i,
      asset: true,
      donor: true,
      amount: "2",
      arrived: async (screen) => {
        await expect
          .element(
            screen.getByRole("button", {
              name: /i have completed the payment/i,
            })
          )
          .toBeVisible();
      },
    },
    {
      method: "daf",
      tab: /donor advised fund/i,
      amount: "500",
      // daf's checkout is the chariot widget — nothing of its own to name, so
      // leaving the form is the marker
      arrived: async (screen) => {
        await expect
          .element(screen.getByTestId("donate-methods"))
          .not.toBeInTheDocument();
        await expect
          .element(screen.getByRole("button", { name: /go back/i }))
          .toBeVisible();
      },
    },
    {
      method: "stocks",
      tab: /stocks/i,
      asset: true,
      amount: "10",
      arrived: async (screen) => {
        await expect
          .element(screen.getByText(/donation pending/i))
          .toBeVisible();
        await expect
          .element(screen.getByRole("link", { name: /generate email/i }))
          .toBeVisible();
      },
    },
    {
      method: "ira_qcd",
      tab: /ira \/ qcd/i,
      amount: "300",
      arrived: async (screen) => {
        await expect
          .element(screen.getByText(/ira donation pending/i))
          .toBeVisible();
        await expect
          .element(screen.getByRole("link", { name: /generate email/i }))
          .toBeVisible();
      },
    },
  ];

  test.each(cases)(
    "$method: form state persists when navigating to checkout and back",
    async (c) => {
      const init: TDonation = {
        base_url: "",
        source: "bg-marketplace",
        mode: "live",
        recipient: donation_recipient_init({ hide_bg_tip: true }),
        donor: donor_fv_blank,
        config: all_methods_config,
        method: c.method,
      };
      const Stub = stb(<Steps init={init} />);
      const screen = await render(<Stub />);

      await expect.element(screen.getByTestId("donate-methods")).toBeVisible();
      await screen.getByRole("tab", { name: c.tab }).click();

      if (c.asset) {
        const selector = screen.getByRole("combobox");
        await selector.click();
        await expect.element(screen.getByRole("option")).toBeVisible();
        await screen.getByRole("option").first().click();
      }

      const amount_input = screen.getByPlaceholder(/enter amount/i);
      await expect.element(amount_input).toBeVisible();
      await amount_input.fill(c.amount);
      await screen.getByRole("button", { name: /continue/i }).click();

      if (c.donor) {
        await fill_donor(screen);
        await screen.getByRole("button", { name: /continue/i }).click();
      }

      await c.arrived(screen);

      await screen.getByRole("button", { name: /go back/i }).click();

      if (c.donor) {
        // the donor step sits between checkout and the form, and holds its own
        await expect
          .element(screen.getByPlaceholder(/john@doe\.com/i))
          .toHaveValue("john@doe.com");
        await expect
          .element(screen.getByRole("textbox", { name: /first name/i }))
          .toHaveValue("John");
        await expect
          .element(screen.getByRole("textbox", { name: /last name/i }))
          .toHaveValue("Doe");
        await screen.getByRole("button", { name: /go back/i }).click();
      }

      await expect
        .element(screen.getByPlaceholder(/enter amount/i))
        .toHaveValue(c.amount);
    }
  );

  test("form state persists when switching between payment methods after checkout", async () => {
    const init: TDonation = {
      base_url: "",
      source: "bg-marketplace",
      mode: "live",
      recipient: donation_recipient_init({ hide_bg_tip: true }),
      donor: donor_fv_blank,
      config: all_methods_config,
      method: "crypto",
    };
    const Stub = stb(<Steps init={init} />);
    const screen = await render(<Stub />);

    // wait for donate-methods to render
    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();

    // fill crypto form
    const crypto_tab = screen.getByRole("tab", { name: /crypto/i });
    await crypto_tab.click();

    const token_selector = screen.getByRole("combobox");
    await expect.element(token_selector).toBeVisible();
    await token_selector.click();
    await expect.element(screen.getByRole("option")).toBeVisible();
    await screen.getByRole("option").first().click();

    let amount_input = screen.getByPlaceholder(/enter amount/i);
    await expect.element(amount_input).toBeVisible();
    await amount_input.fill("5");

    // submit to donor step
    const continue_btn = screen.getByRole("button", { name: /continue/i });
    await expect.element(continue_btn).toBeVisible();
    await continue_btn.click();

    // fill donor info
    const email_input = screen.getByPlaceholder(/john@doe\.com/i);
    await expect.element(email_input).toBeVisible();
    await email_input.fill("alice@example.com");

    const first_name_input = screen.getByRole("textbox", {
      name: /first name/i,
    });
    await first_name_input.fill("Alice");

    const last_name_input = screen.getByRole("textbox", { name: /last name/i });
    await last_name_input.fill("Smith");

    // submit to checkout to persist state in context
    const continue_btn2 = screen.getByRole("button", { name: /continue/i });
    await continue_btn2.click();

    // should be on checkout page
    await expect
      .element(
        screen.getByRole("button", {
          name: /i have completed the payment/i,
        })
      )
      .toBeVisible();

    // go back to donor step
    const back_btn = screen.getByRole("button", { name: /go back/i });
    await back_btn.click();

    // verify donor info persists, then go back to form
    await expect
      .element(screen.getByPlaceholder(/john@doe\.com/i))
      .toHaveValue("alice@example.com");
    const back_btn2 = screen.getByRole("button", { name: /go back/i });
    await back_btn2.click();

    // switch to daf (tabs should already be rendered)
    const daf_tab = screen.getByRole("tab", { name: /donor advised fund/i });
    await daf_tab.click();

    // fill daf form
    amount_input = screen.getByPlaceholder(/enter amount/i);
    await amount_input.fill("1000");

    // submit directly to checkout (donor step is skipped for daf)
    const continue_btn3 = screen.getByRole("button", { name: /continue/i });
    await continue_btn3.click();

    // should be on daf checkout
    await expect
      .element(screen.getByTestId("donate-methods"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /go back/i }))
      .toBeVisible();

    // go back to form (donor step is skipped for daf)
    const back_btn3 = screen.getByRole("button", { name: /go back/i });
    await back_btn3.click();

    // switch back to crypto - form state should persist (tabs already rendered)
    const crypto_tab2 = screen.getByRole("tab", { name: /crypto/i });
    await crypto_tab2.click();

    await expect
      .element(screen.getByPlaceholder(/enter amount/i))
      .toHaveValue("5");

    // switch back to DAF - form state should persist
    const daf_tab2 = screen.getByRole("tab", { name: /donor advised fund/i });
    await daf_tab2.click();

    await expect
      .element(screen.getByPlaceholder(/enter amount/i))
      .toHaveValue("1,000");
  });

  test("form state persists after going to checkout from one method and switching to another", async () => {
    const init: TDonation = {
      base_url: "",
      source: "bg-marketplace",
      mode: "live",
      recipient: donation_recipient_init({ hide_bg_tip: true }),
      donor: donor_fv_blank,
      config: all_methods_config,
      method: "crypto",
    };
    const Stub = stb(<Steps init={init} />);
    const screen = await render(<Stub />);

    // wait for donate-methods to render
    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();

    // fill and submit crypto form to checkout - this persists state in context
    const crypto_tab = screen.getByRole("tab", { name: /crypto/i });
    await crypto_tab.click();

    const token_selector = screen.getByRole("combobox");
    await expect.element(token_selector).toBeVisible();
    await token_selector.click();
    await expect.element(screen.getByRole("option")).toBeVisible();
    await screen.getByRole("option").first().click();

    let amount_input = screen.getByPlaceholder(/enter amount/i);
    await expect.element(amount_input).toBeVisible();
    await amount_input.fill("2");

    const continue_btn = screen.getByRole("button", { name: /continue/i });
    await continue_btn.click();

    // fill donor info
    const email_input = screen.getByPlaceholder(/john@doe\.com/i);
    await expect.element(email_input).toBeVisible();
    await email_input.fill("bob@example.com");

    const first_name_input = screen.getByRole("textbox", {
      name: /first name/i,
    });
    await first_name_input.fill("Bob");

    const last_name_input = screen.getByRole("textbox", { name: /last name/i });
    await last_name_input.fill("Johnson");

    const continue_btn2 = screen.getByRole("button", { name: /continue/i });
    await continue_btn2.click();

    // should be on crypto checkout
    await expect
      .element(
        screen.getByRole("button", {
          name: /i have completed the payment/i,
        })
      )
      .toBeVisible();

    // go back to donor step
    const back_btn = screen.getByRole("button", { name: /go back/i });
    await back_btn.click();

    // go back to form
    const back_btn2 = screen.getByRole("button", { name: /go back/i });
    await back_btn2.click();

    // wait for donate-methods to render again
    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();

    // fill daf form and go to checkout - this also persists daf state in context (tabs already rendered)
    const daf_tab = screen.getByRole("tab", {
      name: /donor advised fund/i,
    });
    await daf_tab.click();

    amount_input = screen.getByPlaceholder(/enter amount/i);
    await amount_input.fill("750");

    // submit directly to checkout (donor step is skipped for daf)
    const continue_btn3 = screen.getByRole("button", { name: /continue/i });
    await continue_btn3.click();

    // should be on daf checkout - check we left the form
    await expect
      .element(screen.getByTestId("donate-methods"))
      .not.toBeInTheDocument();

    // go back to form (donor step is skipped for daf)
    const back_btn3 = screen.getByRole("button", { name: /go back/i });
    await back_btn3.click();

    // switch back to crypto - all form state should persist from context (tabs already rendered)
    const crypto_tab2 = screen.getByRole("tab", { name: /crypto/i });
    await crypto_tab2.click();

    await expect
      .element(screen.getByPlaceholder(/enter amount/i))
      .toHaveValue("2");
  });
});
