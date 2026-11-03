import { AskHost } from "@better-giving/ui";
import { Elements } from "@stripe/react-stripe-js";
import type { Stripe, StripeError } from "@stripe/stripe-js";
import { HttpResponse, http } from "msw";
import { type ReactNode, useEffect, useRef } from "react";
import { createRoutesStub, href } from "react-router";
import { SWRConfig } from "swr";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { render } from "vitest-browser-react";
import { don_intents_error_handler } from "#/services/api/mock";
import { mswWorker } from "#/setup-tests-browser";
import type { Config } from "../../types";
import { type StripeDonationDetails, tip_fv_init } from "../../types";
import { StripeCheckout as Checkout } from "./checkout";

// what reached sentry, in order. `error_prompt` funnels everything through
// `report_error`, so this is the only way to tell a paged defect apart from a
// prompt the donor simply reads and corrects.
const reported = vi.hoisted(() => [] as unknown[]);
vi.mock("#/errors/report", async (orig) => ({
  ...(await orig<typeof import("#/errors/report")>()),
  report_error: (e: unknown) => {
    reported.push(e);
  },
}));

const don_set_mock = vi.hoisted(() => vi.fn());
const don_mock = vi.hoisted(() => ({
  recipient: { id: "1", name: "test", members: [] },
  source: "bg-marketplace",
  mode: "live",
  config: null as Config | null,
  base_url: "https://test.example.com",
  donor: {
    email: "john@doe.com",
    first_name: "John",
    last_name: "Doe",
  },
}));
const use_donation_mock = vi.hoisted(() => vi.fn());
vi.mock("../../context", () => ({
  use_donation: use_donation_mock,
}));
use_donation_mock.mockReturnValue({ don: don_mock, don_set: don_set_mock });

const confirm_payment_mock = vi.hoisted(() => vi.fn());
const confirm_setup_mock = vi.hoisted(() => vi.fn());

// leaving for the thank-you page is one shared helper with its own tests
// (../../common/redirect.test.ts) — what's asserted here is that a completed
// payment reaches it, and what the donor is shown when it reports back that
// the browser never left.
const redirect_mock = vi.hoisted(() => vi.fn());
vi.mock("../../common/redirect", () => ({
  use_donation_redirect: () => redirect_mock,
}));

// the latest change handler, so a test can type into the field after mount.
// the element itself fires once: a parent render is not the donor editing.
const payment_change = vi.hoisted(() => ({
  current: null as
    | ((event: { complete: boolean; value?: { type: string } }) => void)
    | null,
}));
// focus, for an edit stripe does not report as change.
const payment_focus = vi.hoisted(() => ({
  current: null as (() => void) | null,
}));
// one test renders a field we own, to check the form's own change clears too.
const own_field = vi.hoisted(() => ({ current: false }));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: vi.fn(({ children }) => children),
  PaymentElement: vi.fn(({ onReady, onChange, onFocus }: any) => {
    const ready = useRef(onReady);
    const change = useRef(onChange);
    ready.current = onReady;
    change.current = onChange;
    payment_change.current = onChange;
    payment_focus.current = onFocus;
    useEffect(() => {
      change.current({ complete: true });
      const id = setTimeout(() => ready.current(), 50);
      return () => {
        clearTimeout(id);
      };
    }, []);
    return own_field.current ? <input aria-label="gift note" /> : <div />;
  }),
  useStripe: vi.fn(() => {
    const stripe: Stripe = {
      confirmPayment: confirm_payment_mock,
      confirmSetup: confirm_setup_mock,
    } as any;
    return stripe;
  }),
  useElements: vi.fn(() => ({})),
}));

// the checkout's prompts are raised through `ask`, which mounts at `AskHost`
const stb = (node: ReactNode) =>
  createRoutesStub([
    {
      path: "/",
      Component: () => (
        <>
          {node}
          <AskHost />
        </>
      ),
    },
  ]);

const fv: StripeDonationDetails = {
  amount: "100",
  currency: { code: "usd", min: 1, rate: 1 },
  frequency: "one-time",
  ...tip_fv_init,
  cover_processing_fee: false,
};

describe("stripe checkout", () => {
  const og_error = console.error;
  beforeAll(() => {
    console.error = vi.fn();
  });
  afterAll(() => {
    console.error = og_error;
  });
  afterEach(() => {
    reported.length = 0;
    use_donation_mock.mockReturnValue({
      don: don_mock,
      don_set: don_set_mock,
    });
    don_set_mock.mockClear();
  });

  const crash_msg = /unexpected error occurred and has been reported/i;
  const generic_msg =
    "We couldn't start the payment. Please try again or choose a different payment method.";

  // fresh cache per render; a fast retry interval so a retry, if one were
  // allowed, lands well inside the test
  const fresh_swr = (node: ReactNode) => (
    <SWRConfig
      value={{
        provider: () => new Map(),
        errorRetryInterval: 10,
        dedupingInterval: 0,
      }}
    >
      {node}
    </SWRConfig>
  );

  test("a refused intent shows the server's sentence, not the crash screen", async () => {
    const sentence =
      "This amount is above the limit for this payment method. Try a smaller amount or a different payment method.";
    mswWorker.use(
      http.post(href("/api/donation-intents"), () =>
        // marked the way `resp.refuse` marks a refusal the donor may read
        HttpResponse.text(sentence, {
          status: 400,
          headers: { "x-refusal": "1" },
        })
      )
    );
    const screen = await render(fresh_swr(<Checkout {...fv} />));

    await expect.element(screen.getByText(sentence)).toBeVisible();
    expect(screen.getByText(crash_msg).query()).toBeNull();
    // handed over with its 4xx status, which `is_user_error` keeps off sentry
    expect(reported).toMatchObject([{ status: 400 }]);
  });

  test("a failed intent shows the generic sentence, not the error page", async () => {
    const page = "<!doctype html><h1>Application Error</h1>";
    mswWorker.use(
      http.post(
        href("/api/donation-intents"),
        () =>
          new HttpResponse(page, {
            status: 500,
            headers: { "content-type": "text/html" },
          })
      )
    );
    const screen = await render(fresh_swr(<Checkout {...fv} />));

    await expect.element(screen.getByText(generic_msg)).toBeVisible();
    expect(screen.getByText(/application error/i).query()).toBeNull();
    expect(screen.getByText(crash_msg).query()).toBeNull();
    expect(reported).toMatchObject([{ status: 500 }]);
  });

  test("a network failure shows the generic sentence", async () => {
    mswWorker.use(don_intents_error_handler);
    const screen = await render(fresh_swr(<Checkout {...fv} />));
    await expect.element(screen.getByText(generic_msg)).toBeVisible();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(TypeError);
  });

  test("a failed intent is not retried", async () => {
    // each request creates a donation row and a stripe intent
    let calls = 0;
    mswWorker.use(
      http.post(href("/api/donation-intents"), () => {
        calls++;
        return HttpResponse.text("nope", {
          status: 400,
          headers: { "x-refusal": "1" },
        });
      })
    );
    const screen = await render(fresh_swr(<Checkout {...fv} />));
    await expect.element(screen.getByText("nope")).toBeVisible();
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(1);
  });

  test("go back stays shut while a payment is in flight", async () => {
    use_donation_mock.mockReturnValue({
      don: don_mock,
      don_set: don_set_mock,
      pay_busy: true,
    });
    const screen = await render(fresh_swr(<Checkout {...fv} />));
    const back = screen.getByRole("button", { name: "Go Back" });
    await expect.element(back).toBeDisabled();
    await back.click({ force: true });
    expect(don_set_mock).not.toHaveBeenCalled();
  });

  test("stripe loading", async () => {
    const screen = await render(
      <Checkout {...fv} tip_format="20" /** reset cache */ />
    );

    //getting client secret from proxy
    await expect
      .element(screen.getByText(/loading payment form../i))
      .toBeVisible();
    await expect
      .element(screen.getByTestId("stripe-checkout-form"))
      .toBeVisible();

    //stripe is loading elements
    await expect.element(screen.getByTestId("loader")).toBeVisible();

    await expect
      .element(screen.getByRole("button", { name: /donate now/i }))
      .toBeVisible();
  });

  test("the payment fields are handed the face the page speaks, by absolute url", async () => {
    const screen = await render(<Checkout {...fv} tip_format="20" />);
    await expect
      .element(screen.getByTestId("stripe-checkout-form"))
      .toBeVisible();

    // stripe draws the fields in its own iframe, so a family that is named
    // in `appearance` but not loaded here falls back to sans-serif silently
    const { options } = vi.mocked(Elements).mock.calls.at(-1)![0];
    const fonts = options!.fonts as {
      family: string;
      src: string;
      weight: string;
    }[];
    const family = options!.appearance!.variables!.fontFamily!;
    expect(fonts.map((f) => f.weight)).toEqual(["400", "500", "600", "700"]);
    for (const f of fonts) {
      expect(family.startsWith(`"${f.family}"`)).toBe(true);
      expect(f.src).toMatch(/^url\(https?:\/\/[^)]+\.woff2\)$/);
    }
  });

  test("card error", async () => {
    const Stub = stb(<Checkout {...fv} tip_format="20" />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    const err: StripeError = {
      type: "card_error",
      message: "invalid card",
    };

    if (fv.frequency === "one-time") {
      confirm_payment_mock.mockResolvedValueOnce({ error: err });
    } else confirm_setup_mock.mockResolvedValueOnce({ error: err });

    //user sees modal on card error
    await donateBtn.click();
    const errorModal = screen.getByRole("dialog");
    await expect.element(errorModal).toMatchTextContent(/invalid card/i);

    // a wrong cvc is the donor's to fix, not ours. it must not page.
    expect(reported).toHaveLength(0);
  });

  test("a rejected amount is the donor's to fix too", async () => {
    const Stub = stb(<Checkout {...fv} tip_format="20" />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    const err: StripeError = {
      type: "validation_error",
      message: "Amount must be at least $1.00",
    };

    if (fv.frequency === "one-time") {
      confirm_payment_mock.mockResolvedValueOnce({ error: err });
    } else confirm_setup_mock.mockResolvedValueOnce({ error: err });

    await donateBtn.click();
    const errorModal = screen.getByRole("dialog");
    await expect.element(errorModal).toMatchTextContent(/must be at least/i);

    expect(reported).toHaveLength(0);
  });

  test("a peso amount is summarized in pesos", async () => {
    const screen = await render(
      <Checkout
        {...fv}
        amount="500"
        currency={{ code: "PHP", min: 113, rate: 56.5 }}
      />
    );
    await expect
      .element(screen.getByText("Your donation summary"))
      .toBeVisible();
    const text = screen.container.textContent ?? "";
    expect(text).toContain("PHP 500.00 ($8.84)");
    expect(text).not.toContain("28,250");
    expect(text).not.toContain("$500.00");
  });

  test("a failed card authentication tells the donor and is not reported", async () => {
    const Stub = stb(<Checkout {...fv} />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    confirm_payment_mock.mockResolvedValueOnce({
      error: {
        type: "invalid_request_error",
        code: "payment_intent_authentication_failure",
        message:
          "We are unable to authenticate your payment method. Please choose a different payment method and try again.",
      } satisfies StripeError,
    });

    await donateBtn.click();
    const errorModal = screen.getByRole("dialog");
    await expect
      .element(errorModal)
      .toMatchTextContent(/bank couldn't verify this card/i);
    await expect
      .element(errorModal)
      .toMatchTextContent(/try again or use another card/i);
    expect(screen.getByText(/unexpected error occurred/i).query()).toBeNull();
    expect(reported).toHaveLength(0);

    const form = screen
      .getByTestId("stripe-checkout-form")
      .element() as HTMLElement;
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    );
    expect(submit?.disabled).toBe(false);
  });

  test("a failed setup authentication tells the donor and is not reported", async () => {
    const Stub = stb(<Checkout {...fv} frequency="monthly" />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    confirm_setup_mock.mockResolvedValueOnce({
      error: {
        type: "invalid_request_error",
        code: "setup_intent_authentication_failure",
        message: "We are unable to authenticate your payment method.",
      } satisfies StripeError,
    });

    await donateBtn.click();
    const errorModal = screen.getByRole("dialog");
    await expect
      .element(errorModal)
      .toMatchTextContent(/bank couldn't verify this card/i);
    expect(screen.getByText(/unexpected error occurred/i).query()).toBeNull();
    expect(reported).toHaveLength(0);
    expect(confirm_payment_mock).not.toHaveBeenCalled();
  });

  test("unexpected error", async () => {
    const Stub = stb(<Checkout {...fv} tip_format="20" />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    const err: StripeError = {
      type: "idempotency_error",
      message: "unhelpful error message that won't be shown",
    };

    if (fv.frequency === "one-time")
      confirm_payment_mock.mockResolvedValueOnce({ error: err });
    else confirm_setup_mock.mockResolvedValueOnce({ error: err });

    await donateBtn.click();

    const errorModal = screen.getByRole("dialog");
    const genericError =
      "An unexpected error occurred while processing payment and has been reported. Please get in touch with hi@better.giving if the problem persists.";
    await expect.element(errorModal).toMatchTextContent(genericError);

    // the other half of the rule — quieting card errors must not quiet these.
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBe(err);
  });

  test("a completed payment leaves for the thank-you page", async () => {
    const Stub = stb(<Checkout {...fv} amount="101" />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    confirm_payment_mock.mockResolvedValueOnce({});
    await donateBtn.click();

    // the helper owns the iframe/top-level split — this only proves the
    // success branch hands it the donor's receipt url
    await vi.waitFor(() => expect(redirect_mock).toHaveBeenCalledOnce());
    expect(redirect_mock.mock.calls[0]![0]).toMatchObject({
      dest: {
        url: "https://test.example.com/donations/fake_order_id",
        is_custom: false,
      },
    });
  });

  test("a navigation that never lands leaves an answer, not a spinner", async () => {
    // the defect: inside a plain `<iframe src>` nothing ever cleared this and
    // the donor watched "Processing..." forever after a payment that worked.
    redirect_mock.mockImplementationOnce((x: { on_stuck?: () => void }) =>
      x.on_stuck?.()
    );
    const Stub = stb(<Checkout {...fv} amount="102" />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    confirm_payment_mock.mockResolvedValueOnce({});
    await donateBtn.click();

    // told the truth: the money moved, so this is never worded as a failure
    const dialog = screen.getByRole("dialog");
    await expect.element(dialog).toMatchTextContent(/donation went through/i);

    // and given the way out, which is the receipt — not the donate button
    const link = screen.getByRole("link", { name: /receipt/i });
    await expect
      .element(link)
      .toHaveAttribute(
        "href",
        "https://test.example.com/donations/fake_order_id"
      );

    // the spinner is gone, and paying again is not what's on offer.
    // (queried off the form, not by role — the open dialog hides everything
    // behind it from the accessibility tree)
    const form = screen
      .getByTestId("stripe-checkout-form")
      .element() as HTMLElement;
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    );
    expect(submit?.textContent).not.toMatch(/processing/i);
    expect(submit?.disabled).toBe(true);

    // the donate button never re-opens, so closing the prompt can't be what
    // takes the receipt away with it
    await screen.getByRole("button", { name: /^done$/i }).click();
    await vi.waitFor(() =>
      expect(screen.getByRole("dialog").query()).toBeNull()
    );
    await expect
      .element(screen.getByRole("link", { name: /receipt/i }))
      .toHaveAttribute(
        "href",
        "https://test.example.com/donations/fake_order_id"
      );
  });

  test("a pinned confirm failure stays on the form", async () => {
    use_donation_mock.mockReturnValue({
      don: { ...don_mock, pin: true },
      don_set: don_set_mock,
    });
    const scrolled = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const Stub = stb(<Checkout {...fv} />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    confirm_payment_mock.mockResolvedValueOnce({
      error: {
        type: "invalid_request_error",
        code: "payment_intent_authentication_failure",
        message: "We are unable to authenticate your payment method.",
      } satisfies StripeError,
    });

    await donateBtn.click();
    const alert = screen.getByRole("alert");
    await expect
      .element(alert)
      .toMatchTextContent(/bank couldn't verify this card/i);
    expect(screen.getByRole("dialog").query()).toBeNull();
    expect(screen.getByRole("button", { name: /^ok$/i }).query()).toBeNull();
    expect(reported).toHaveLength(0);
    expect(scrolled).toHaveBeenCalled();

    const form = screen
      .getByTestId("stripe-checkout-form")
      .element() as HTMLElement;
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    );
    expect(submit?.disabled).toBe(false);

    // past the two frames where stripe's own field update is ignored
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    payment_change.current?.({ complete: true, value: { type: "card" } });
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").query()).toBeNull()
    );
    expect(submit?.disabled).toBe(false);
    scrolled.mockRestore();
  });

  test("a pinned failure leaves when the donor edits the card", async () => {
    use_donation_mock.mockReturnValue({
      don: { ...don_mock, pin: true },
      don_set: don_set_mock,
    });
    own_field.current = true;
    try {
      const Stub = stb(<Checkout {...fv} amount="106" />);
      const screen = await render(<Stub />);
      const donateBtn = screen.getByRole("button", { name: /donate now/i });
      await expect.element(donateBtn).toBeVisible();

      const auth_error = {
        error: {
          type: "invalid_request_error",
          code: "payment_intent_authentication_failure",
          message: "We are unable to authenticate your payment method.",
        } satisfies StripeError,
      };
      confirm_payment_mock.mockResolvedValueOnce(auth_error);
      confirm_payment_mock.mockResolvedValueOnce(auth_error);

      await donateBtn.click();
      await expect
        .element(screen.getByRole("alert"))
        .toMatchTextContent(/bank couldn't verify this card/i);

      // past the two frames where stripe's own field update is ignored.
      // a replacement that leaves the change payload alone only focuses the field.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      payment_focus.current?.();
      await vi.waitFor(() =>
        expect(screen.getByRole("alert").query()).toBeNull()
      );

      await donateBtn.click();
      await expect
        .element(screen.getByRole("alert"))
        .toMatchTextContent(/bank couldn't verify this card/i);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await screen.getByRole("textbox", { name: "gift note" }).fill("thanks");
      await vi.waitFor(() =>
        expect(screen.getByRole("alert").query()).toBeNull()
      );
    } finally {
      own_field.current = false;
    }
  });

  test("a pinned card error stays under the field", async () => {
    use_donation_mock.mockReturnValue({
      don: { ...don_mock, pin: true },
      don_set: don_set_mock,
    });
    const Stub = stb(<Checkout {...fv} amount="103" />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    confirm_payment_mock.mockImplementationOnce(() => {
      // stripe marks the field incomplete in the same turn as the failure
      payment_change.current?.({ complete: false, value: { type: "card" } });
      return Promise.resolve({
        error: {
          type: "card_error",
          code: "card_declined",
          message: "Your card has been declined.",
        } satisfies StripeError,
      });
    });

    await donateBtn.click();
    expect(screen.getByRole("alert").query()).toBeNull();
    expect(screen.getByRole("dialog").query()).toBeNull();
    expect(reported).toHaveLength(0);
    const form = screen
      .getByTestId("stripe-checkout-form")
      .element() as HTMLElement;
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    );
    expect(submit?.disabled).toBe(true);
  });

  test("a pinned failure leaves when the donor submits again", async () => {
    use_donation_mock.mockReturnValue({
      don: { ...don_mock, pin: true },
      don_set: don_set_mock,
    });
    const Stub = stb(<Checkout {...fv} amount="104" />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    confirm_payment_mock.mockResolvedValueOnce({
      error: {
        type: "invalid_request_error",
        code: "payment_intent_authentication_failure",
        message: "We are unable to authenticate your payment method.",
      } satisfies StripeError,
    });
    confirm_payment_mock.mockImplementationOnce(() => new Promise(() => {}));

    await donateBtn.click();
    await expect
      .element(screen.getByRole("alert"))
      .toMatchTextContent(/bank couldn't verify this card/i);

    await donateBtn.click();
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").query()).toBeNull()
    );
    const form = screen
      .getByTestId("stripe-checkout-form")
      .element() as HTMLElement;
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    );
    expect(submit?.disabled).toBe(true);
  });

  test("a pinned outage is reported and shown in the same slot", async () => {
    use_donation_mock.mockReturnValue({
      don: { ...don_mock, pin: true },
      don_set: don_set_mock,
    });
    const Stub = stb(<Checkout {...fv} amount="105" />);
    const screen = await render(<Stub />);
    const donateBtn = screen.getByRole("button", { name: /donate now/i });
    await expect.element(donateBtn).toBeVisible();

    const err: StripeError = {
      type: "api_connection_error",
      message: "network down",
    };
    confirm_payment_mock.mockResolvedValueOnce({ error: err });

    await donateBtn.click();
    const alert = screen.getByRole("alert");
    await expect
      .element(alert)
      .toMatchTextContent(
        /unexpected error occurred while processing payment/i
      );
    expect(screen.getByRole("dialog").query()).toBeNull();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBe(err);
  });

  test("form_id included in intent", async () => {
    don_mock.config = {
      id: "V5K9H2mN3pQx",
      accent_primary: undefined,
      accent_secondary: undefined,
      method_ids: undefined,
      increments: undefined,
      success_redirect: undefined,
      freq_opts: undefined,
    } satisfies Config;

    try {
      const screen = await render(
        <Checkout {...fv} tip_format="10" /** unique key to bust SWR cache */ />
      );

      // if schema rejects form_id, msw returns 400 → error boundary renders
      await expect
        .element(screen.getByTestId("stripe-checkout-form"))
        .toBeVisible();
    } finally {
      don_mock.config = null;
    }
  });
});
