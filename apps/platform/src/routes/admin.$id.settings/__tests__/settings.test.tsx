import { eq } from "drizzle-orm";
import { createRoutesStub, useLocation, useNavigate } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { npos } from "$/pg/schema/npo";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks (hoisted) ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);

vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((_d: unknown, msg: string) => ({ toast: msg })),
  dataWithError: vi.fn((_d: unknown, msg: string) => ({ error: msg })),
}));

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

// --- imports (after mocks hoisted) ---

import { admin_ctx } from "$/auth/test-utils";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "../api";
import SettingsPage from "../route";

// --- setup ---

const NPO_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN-SETTINGS",
  name: "Settings Test NPO",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
  published: false,
  active: true,
};

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(npos);
});

// --- helpers ---

async function seed_npo(
  overrides: Partial<Omit<typeof npos.$inferInsert, "id">> = {}
) {
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({ ...NPO_SEED, ...overrides })
    .returning();
  return row;
}

async function render_settings(npo_id: number) {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/settings",
      Component: SettingsPage,
      HydrateFallback: () => null,
      loader: loader as any,
      action,
      middleware: [
        async ({ context }, next) => {
          context.set(admin_ctx, npo_id);
          return next();
        },
      ],
    },
  ]);

  return await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/settings`]}
      future={{ v8_middleware: true }}
    />
  );
}

// --- donation tab — defaults ---

describe("donation tab — defaults", () => {
  it("renders empty/unchecked when no settings set", async () => {
    const npo = await seed_npo();
    const screen = await render_settings(npo.id);

    // receipt msg textarea empty
    await expect
      .element(screen.getByLabelText(/tax receipt message/i))
      .toBeVisible();
    await expect
      .element(screen.getByLabelText(/tax receipt message/i))
      .toHaveDisplayValue("");

    // checkboxes unchecked
    await expect
      .element(screen.getByLabelText(/opt out of support/i))
      .not.toBeChecked();
    await expect
      .element(screen.getByLabelText(/require donor address/i))
      .not.toBeChecked();

    // submit disabled (pristine)
    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();
  });
});

// --- donation tab — pre-filled & edits ---

describe("donation tab — pre-filled", () => {
  it("shows seeded values", async () => {
    const npo = await seed_npo({
      receipt_msg: "Thank you for your generosity!",
      hide_bg_tip: true,
      donor_address_required: true,
    });
    const screen = await render_settings(npo.id);

    await expect
      .element(screen.getByLabelText(/tax receipt message/i))
      .toBeVisible();
    await expect
      .element(screen.getByLabelText(/tax receipt message/i))
      .toHaveDisplayValue("Thank you for your generosity!");
    await expect
      .element(screen.getByLabelText(/opt out of support/i))
      .toBeChecked();
    await expect
      .element(screen.getByLabelText(/require donor address/i))
      .toBeChecked();
    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();
  });
});

describe("donation tab — edit receipt message", () => {
  it("updates receipt message and revalidates", async () => {
    const npo = await seed_npo({ receipt_msg: "Old message" });
    const screen = await render_settings(npo.id);

    const receipt = screen.getByLabelText(/tax receipt message/i);
    await expect.element(receipt).toBeVisible();
    await receipt.clear();
    await receipt.fill("New receipt message");

    await screen.getByRole("button", { name: /submit changes/i }).click();

    // revalidation: form resets, new value persists
    await expect
      .element(screen.getByLabelText(/tax receipt message/i))
      .toHaveDisplayValue("New receipt message");
    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();
  });
});

describe("donation tab — toggle checkboxes", () => {
  it("enables both checkboxes", async () => {
    const npo = await seed_npo();
    const screen = await render_settings(npo.id);

    await expect
      .element(screen.getByLabelText(/tax receipt message/i))
      .toBeVisible();

    await screen.getByLabelText(/opt out of support/i).click();
    await screen.getByLabelText(/require donor address/i).click();

    await screen.getByRole("button", { name: /submit changes/i }).click();

    // revalidation: checkboxes stay checked, form resets
    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();
    await expect
      .element(screen.getByLabelText(/opt out of support/i))
      .toBeChecked();
    await expect
      .element(screen.getByLabelText(/require donor address/i))
      .toBeChecked();
  });

  it("disables both checkboxes", async () => {
    const npo = await seed_npo({
      hide_bg_tip: true,
      donor_address_required: true,
    });
    const screen = await render_settings(npo.id);

    await expect
      .element(screen.getByLabelText(/tax receipt message/i))
      .toBeVisible();

    // uncheck both
    await screen.getByLabelText(/opt out of support/i).click();
    await screen.getByLabelText(/require donor address/i).click();

    await screen.getByRole("button", { name: /submit changes/i }).click();

    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();
    await expect
      .element(screen.getByLabelText(/opt out of support/i))
      .not.toBeChecked();
    await expect
      .element(screen.getByLabelText(/require donor address/i))
      .not.toBeChecked();
  });
});

describe("donation tab — validation", () => {
  it("blocks submit when receipt message exceeds max length", async () => {
    const npo = await seed_npo();
    const screen = await render_settings(npo.id);

    const receipt = screen.getByLabelText(/tax receipt message/i);
    await expect.element(receipt).toBeVisible();
    await receipt.fill("x".repeat(501));

    await screen.getByRole("button", { name: /submit changes/i }).click();

    // form stays dirty — submit still enabled (validation blocked action)
    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeEnabled();
    await expect
      .element(screen.getByText(/cannot exceed 500 characters/i))
      .toBeInTheDocument();
  });
});

// --- fundraiser tab ---

describe("fundraiser tab — defaults", () => {
  it("renders unchecked when fund_opt_in not set", async () => {
    const npo = await seed_npo();
    const screen = await render_settings(npo.id);

    // switch to fundraiser tab
    await expect
      .element(
        screen.getByRole("tab", { name: "Supporter campaigns", exact: true })
      )
      .toBeVisible();
    await screen
      .getByRole("tab", { name: "Supporter campaigns", exact: true })
      .click();

    const checkbox = screen.getByLabelText(/allow campaigns/i);
    await expect.element(checkbox).toBeVisible();
    await expect.element(checkbox).not.toBeChecked();
    // use page.elementLocator for within-like scoping
    await vi.waitFor(() => {
      const panel_el = checkbox.element().closest("[role='tabpanel']")!;
      const submit = page
        .elementLocator(panel_el as HTMLElement)
        .getByRole("button", { name: /submit changes/i });
      expect(submit.element()).toBeDisabled();
    });
  });
});

describe("fundraiser tab — pre-filled", () => {
  it("renders checked when fund_opt_in is true", async () => {
    const npo = await seed_npo({ fund_opt_in: true });
    const screen = await render_settings(npo.id);

    await expect
      .element(
        screen.getByRole("tab", { name: "Supporter campaigns", exact: true })
      )
      .toBeVisible();
    await screen
      .getByRole("tab", { name: "Supporter campaigns", exact: true })
      .click();

    await expect
      .element(screen.getByLabelText(/allow campaigns/i))
      .toBeChecked();
  });
});

describe("fundraiser tab — toggle on", () => {
  it("enables fund_opt_in and revalidates", async () => {
    const npo = await seed_npo();
    const screen = await render_settings(npo.id);

    await expect
      .element(
        screen.getByRole("tab", { name: "Supporter campaigns", exact: true })
      )
      .toBeVisible();
    await screen
      .getByRole("tab", { name: "Supporter campaigns", exact: true })
      .click();

    const checkbox = screen.getByLabelText(/allow campaigns/i);
    await expect.element(checkbox).toBeVisible();
    await checkbox.click();

    await screen.getByRole("button", { name: /submit changes/i }).click();

    // revalidation: checkbox stays checked, form resets
    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();
    await expect
      .element(screen.getByLabelText(/allow campaigns/i))
      .toBeChecked();
  });
});

// --- donation form tab — defaults ---

describe("donation form tab — defaults", () => {
  it("renders defaults when no settings set", async () => {
    const npo = await seed_npo();
    const screen = await render_settings(npo.id);

    await expect
      .element(screen.getByRole("tab", { name: /donation form/i }))
      .toBeVisible();
    await screen.getByRole("tab", { name: /donation form/i }).click();

    // default donate method: only Card enabled
    // Card checkbox is checked, others unchecked
    await expect
      .element(screen.getByText("Card", { exact: true }))
      .toBeVisible();
    await vi.waitFor(() => {
      const card_item = screen
        .getByText("Card", { exact: true })
        .element()
        .closest("[id]")!;
      const card_checkbox = card_item.querySelector(
        "input[type='checkbox']"
      ) as HTMLInputElement;
      expect(card_checkbox.checked).toBe(true);

      const crypto_item = screen
        .getByText("Crypto", { exact: true })
        .element()
        .closest("[id]")!;
      const crypto_checkbox = crypto_item.querySelector(
        "input[type='checkbox']"
      ) as HTMLInputElement;
      expect(crypto_checkbox.checked).toBe(false);
    });

    // default frequencies: One time + Monthly checked
    await expect.element(screen.getByLabelText(/one time/i)).toBeChecked();
    await expect.element(screen.getByLabelText(/monthly/i)).toBeChecked();
    await expect.element(screen.getByLabelText(/weekly/i)).not.toBeChecked();
    await expect.element(screen.getByLabelText(/annual/i)).not.toBeChecked();

    // no increments
    await expect
      .element(screen.getByText(/click the plus symbol/i))
      .toBeInTheDocument();

    // the org has no goal setting
    expect(screen.getByRole("radio", { name: /goal/i }).query()).toBeNull();

    // submit disabled
    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();
  });
});

// --- donation form tab — pre-filled ---

describe("donation form tab — pre-filled", () => {
  it("shows seeded methods, increments, frequencies, and no goal even when one is stored", async () => {
    const npo = await seed_npo({
      donate_methods: ["stripe", "crypto"],
      increments: [{ value: "25", label: "Feed a child" }],
      target_number: 5000,
      donate_frequencies: ["one-time", "monthly"],
    });
    const screen = await render_settings(npo.id);

    await expect
      .element(screen.getByRole("tab", { name: /donation form/i }))
      .toBeVisible();
    await screen.getByRole("tab", { name: /donation form/i }).click();

    // Card + Crypto enabled
    await expect
      .element(screen.getByText("Card", { exact: true }))
      .toBeVisible();
    await vi.waitFor(() => {
      const card_item = screen
        .getByText("Card", { exact: true })
        .element()
        .closest("[id]")!;
      expect(
        (card_item.querySelector("input[type='checkbox']") as HTMLInputElement)
          .checked
      ).toBe(true);

      const crypto_item = screen
        .getByText("Crypto", { exact: true })
        .element()
        .closest("[id]")!;
      expect(
        (
          crypto_item.querySelector(
            "input[type='checkbox']"
          ) as HTMLInputElement
        ).checked
      ).toBe(true);
    });

    // increment present
    await vi.waitFor(() => {
      const panel = screen.getByRole("tabpanel").element();
      const num_input = panel.querySelector(
        "input[type='number']"
      ) as HTMLInputElement;
      expect(num_input.value).toBe("25");
      const textarea = panel.querySelector("textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Feed a child");
    });

    // frequencies
    await expect.element(screen.getByLabelText(/one time/i)).toBeChecked();
    await expect.element(screen.getByLabelText(/monthly/i)).toBeChecked();
    await expect.element(screen.getByLabelText(/weekly/i)).not.toBeChecked();

    const panel = screen.getByRole("tabpanel", { name: "Donation Form" });
    expect(panel.getByText("Donation goal").query()).toBeNull();
    expect(panel.getByRole("radio", { name: /goal/i }).query()).toBeNull();
    expect(panel.getByLabelText(/how much money/i).query()).toBeNull();
  });
});

// --- donation form tab — edits ---

describe("donation form tab — update methods", () => {
  it("unchecks crypto and revalidates", async () => {
    const npo = await seed_npo({
      donate_methods: ["stripe", "crypto"],
    });
    const screen = await render_settings(npo.id);

    await expect
      .element(screen.getByRole("tab", { name: /donation form/i }))
      .toBeVisible();
    await screen.getByRole("tab", { name: /donation form/i }).click();

    // uncheck Crypto
    await expect
      .element(screen.getByText("Crypto", { exact: true }))
      .toBeVisible();
    await vi.waitFor(async () => {
      const crypto_item = screen
        .getByText("Crypto", { exact: true })
        .element()
        .closest("[id]")!;
      const crypto_checkbox = crypto_item.querySelector(
        "input[type='checkbox']"
      ) as HTMLInputElement;
      await page.elementLocator(crypto_checkbox).click();
    });

    await screen.getByRole("button", { name: /submit changes/i }).click();

    // revalidation: Crypto becomes unchecked, form resets
    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();

    // after revalidation, only Card should be enabled
    await vi.waitFor(() => {
      const card_item = screen
        .getByText("Card", { exact: true })
        .element()
        .closest("[id]")!;
      expect(
        (card_item.querySelector("input[type='checkbox']") as HTMLInputElement)
          .checked
      ).toBe(true);

      const crypto_revalidated = screen
        .getByText("Crypto", { exact: true })
        .element()
        .closest("[id]")!;
      expect(
        (
          crypto_revalidated.querySelector(
            "input[type='checkbox']"
          ) as HTMLInputElement
        ).checked
      ).toBe(false);
    });
  });
});

describe("donation form tab — update frequencies", () => {
  it("enables weekly and revalidates", async () => {
    const npo = await seed_npo({
      donate_frequencies: ["one-time", "monthly"],
    });
    const screen = await render_settings(npo.id);

    await expect
      .element(screen.getByRole("tab", { name: /donation form/i }))
      .toBeVisible();
    await screen.getByRole("tab", { name: /donation form/i }).click();

    await expect.element(screen.getByLabelText(/one time/i)).toBeVisible();
    await screen.getByLabelText(/weekly/i).click();

    await screen.getByRole("button", { name: /submit changes/i }).click();

    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();

    await expect.element(screen.getByLabelText(/one time/i)).toBeChecked();
    await expect.element(screen.getByLabelText(/weekly/i)).toBeChecked();
    await expect.element(screen.getByLabelText(/monthly/i)).toBeChecked();
  });
});

describe("donation form tab — add increment", () => {
  it("adds an increment and revalidates", async () => {
    const npo = await seed_npo();
    const screen = await render_settings(npo.id);

    await expect
      .element(screen.getByRole("tab", { name: /donation form/i }))
      .toBeVisible();
    await screen.getByRole("tab", { name: /donation form/i }).click();

    // click Plus to add increment
    await expect
      .element(screen.getByText("Donation increments", { exact: true }))
      .toBeVisible();
    await vi.waitFor(async () => {
      const heading = screen
        .getByText("Donation increments", { exact: true })
        .element();
      const plus_btn = heading.closest("div")!.querySelector("button")!;
      await page.elementLocator(plus_btn).click();
    });

    // fill value + label — increment inputs lack accessible labels,
    // query by input type within the form
    await vi.waitFor(async () => {
      const panel = screen.getByRole("tabpanel").element();
      const value_input = panel.querySelector(
        "input[type='number']"
      ) as HTMLInputElement;
      await page.elementLocator(value_input).fill("100");

      const label_textarea = panel.querySelector(
        "textarea"
      ) as HTMLTextAreaElement;
      await page.elementLocator(label_textarea).fill("Feed a family");
    });

    await screen.getByRole("button", { name: /submit changes/i }).click();

    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();

    // revalidated: increment persists
    await vi.waitFor(() => {
      const panel = screen.getByRole("tabpanel").element();
      const num_input = panel.querySelector(
        "input[type='number']"
      ) as HTMLInputElement;
      expect(num_input.value).toBe("100");
      const textarea = panel.querySelector("textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Feed a family");
    });
  });
});

describe("donation form tab — save without a goal", () => {
  it.each([
    ["fixed goal", { target_number: 5000, target_smart: null }],
    ["smart goal", { target_number: null, target_smart: true }],
  ])("saves the form and leaves the stored %s as it was", async (_, goal) => {
    const npo = await seed_npo({
      donate_frequencies: ["one-time", "monthly"],
      ...goal,
    });
    const screen = await render_settings(npo.id);

    await expect
      .element(screen.getByRole("tab", { name: /donation form/i }))
      .toBeVisible();
    await screen.getByRole("tab", { name: /donation form/i }).click();

    await expect.element(screen.getByLabelText(/one time/i)).toBeVisible();
    await screen.getByLabelText(/weekly/i).click();

    const submit = screen
      .getByRole("tabpanel", { name: "Donation Form" })
      .getByRole("button", { name: /submit changes/i });
    await submit.click();
    await expect.element(submit).toBeDisabled();
    await expect.element(screen.getByLabelText(/weekly/i)).toBeChecked();

    const [row] = await test_db
      .current!.db.select({
        donate_frequencies: npos.donate_frequencies,
        target_number: npos.target_number,
        target_smart: npos.target_smart,
      })
      .from(npos)
      .where(eq(npos.id, npo.id));
    expect(row.donate_frequencies).toContain("weekly");
    expect(row.target_number).toBe(goal.target_number);
    expect(row.target_smart).toBe(goal.target_smart);
  });
});

describe("donation form tab — reset", () => {
  it("reverts changes on reset", async () => {
    const npo = await seed_npo({
      donate_frequencies: ["one-time", "monthly"],
    });
    const screen = await render_settings(npo.id);

    await expect
      .element(screen.getByRole("tab", { name: /donation form/i }))
      .toBeVisible();
    await screen.getByRole("tab", { name: /donation form/i }).click();

    await expect.element(screen.getByLabelText(/weekly/i)).toBeVisible();
    await screen.getByLabelText(/weekly/i).click();

    // reset is enabled
    await expect
      .element(screen.getByRole("button", { name: /reset changes/i }))
      .toBeEnabled();

    await screen.getByRole("button", { name: /reset changes/i }).click();

    // weekly reverts to unchecked, submit disabled
    await expect.element(screen.getByLabelText(/weekly/i)).not.toBeChecked();
    await expect
      .element(screen.getByRole("button", { name: /submit changes/i }))
      .toBeDisabled();
  });
});

function AddressProbe() {
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="url-search">{useLocation().search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
    </>
  );
}

async function render_tab_history(npo_id: number, entry: string) {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/settings",
      Component: (props: any) => (
        <>
          <SettingsPage {...props} />
          <AddressProbe />
        </>
      ),
      HydrateFallback: () => null,
      loader: loader as any,
      action,
      middleware: [
        async ({ context }, next) => {
          context.set(admin_ctx, npo_id);
          return next();
        },
      ],
    },
  ]);
  return render(
    <Stub initialEntries={[entry]} future={{ v8_middleware: true }} />
  );
}

describe("settings tabs", () => {
  it("opens Fundraisers for the previous campaign param", async () => {
    const npo = await seed_npo();
    const screen = await render_tab_history(
      npo.id,
      `/admin/${npo.id}/settings?tab=campaign`
    );
    await expect
      .element(
        screen.getByRole("tab", { name: "Supporter campaigns", exact: true })
      )
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByLabelText(/allow campaigns/i))
      .toBeVisible();
    await expect
      .element(screen.getByTestId("url-search"))
      .toHaveTextContent("?tab=campaign");
  });

  it("names the page and opens Donation when tab is missing or unknown", async () => {
    const npo = await seed_npo();
    const screen = await render_tab_history(
      npo.id,
      `/admin/${npo.id}/settings?tab=nope`
    );
    await expect
      .element(screen.getByRole("heading", { level: 1, name: "Settings" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("tab", { name: "Donation", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByLabelText(/tax receipt message/i))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("tab", { name: "Supporter campaigns", exact: true })
      )
      .toHaveAttribute("aria-selected", "false");
  });

  it("writes the tab into the address and Back returns to the previous one", async () => {
    const npo = await seed_npo();
    const screen = await render_tab_history(
      npo.id,
      `/admin/${npo.id}/settings`
    );
    await expect
      .element(
        screen.getByRole("tab", { name: "Supporter campaigns", exact: true })
      )
      .toBeVisible();
    await screen
      .getByRole("tab", { name: "Supporter campaigns", exact: true })
      .click();
    await expect
      .element(screen.getByTestId("url-search"))
      .toHaveTextContent("?tab=fundraisers");
    await expect
      .element(screen.getByLabelText(/allow campaigns/i))
      .toBeVisible();

    await screen.getByRole("button", { name: "Back", exact: true }).click();
    await vi.waitFor(() => {
      expect(screen.getByTestId("url-search").element().textContent).toBe("");
    });
    await expect
      .element(screen.getByRole("tab", { name: "Donation", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByLabelText(/allow campaigns/i))
      .not.toBeVisible();
  });

  it("shows a refused save on the tab that submitted it", async () => {
    const npo = await seed_npo();
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/settings",
        Component: SettingsPage,
        HydrateFallback: () => null,
        loader: loader as any,
        action: () => ({
          ok: false,
          error: "The nonprofit could not be saved",
        }),
        middleware: [
          async ({ context }, next) => {
            context.set(admin_ctx, npo.id);
            return next();
          },
        ],
      },
    ]);
    const screen = await render(
      <Stub
        initialEntries={[`/admin/${npo.id}/settings`]}
        future={{ v8_middleware: true }}
      />
    );
    const receipt = screen.getByLabelText(/tax receipt message/i);
    await expect.element(receipt).toBeVisible();
    await receipt.fill("A note for the receipt");
    await screen.getByRole("button", { name: /submit changes/i }).click();
    await expect
      .element(screen.getByRole("alert").nth(0))
      .toHaveTextContent("The nonprofit could not be saved");

    await screen
      .getByRole("tab", { name: "Supporter campaigns", exact: true })
      .click();
    await vi.waitFor(() => {
      const box = screen
        .getByLabelText(/allow campaigns/i)
        .element()
        .closest("[role='tabpanel']");
      expect(box?.textContent ?? "").not.toContain(
        "The nonprofit could not be saved"
      );
    });
  });

  it("clears a refused save when reset changes is pressed", async () => {
    const npo = await seed_npo();
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/settings",
        Component: SettingsPage,
        HydrateFallback: () => null,
        loader: loader as any,
        action: () => ({
          ok: false,
          error: "The nonprofit could not be saved",
        }),
        middleware: [
          async ({ context }, next) => {
            context.set(admin_ctx, npo.id);
            return next();
          },
        ],
      },
    ]);
    const screen = await render(
      <Stub
        initialEntries={[`/admin/${npo.id}/settings`]}
        future={{ v8_middleware: true }}
      />
    );
    const receipt = screen.getByLabelText(/tax receipt message/i);
    await expect.element(receipt).toBeVisible();
    await receipt.fill("A note for the receipt");
    await screen.getByRole("button", { name: /submit changes/i }).click();
    await expect
      .element(screen.getByRole("alert").nth(0))
      .toHaveTextContent("The nonprofit could not be saved");
    await screen.getByRole("button", { name: /reset changes/i }).click();
    await vi.waitFor(() => {
      expect(screen.getByRole("alert").nth(0).element().textContent).toBe("");
    });
  });
});
