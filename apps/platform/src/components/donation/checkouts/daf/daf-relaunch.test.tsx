import { HttpResponse, http } from "msw";
import { href } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { fv, stb, success_detail } from "#/__tests__/fixtures/daf";
import { CHARIOT_CONNECT_SDK } from "#/constants/chariot";
import { mswWorker } from "#/setup-tests-browser";
import { resp } from "@/helpers/https";
import type { Config } from "../../types";
import { ChariotCheckout } from ".";

const don_mock = vi.hoisted(() => ({
  recipient: { id: "1", name: "test", members: [] },
  source: "bg-marketplace",
  mode: "live",
  config: null as Config | null,
  base_url: "https://test.example.com",
}));
vi.mock("../../context", () => ({
  use_donation: vi.fn().mockReturnValue({ don: don_mock, don_set: vi.fn() }),
}));

const redirect_mock = vi.hoisted(() => vi.fn());
vi.mock("../../common/redirect", () => ({
  use_donation_redirect: () => redirect_mock,
}));

// chariot's element is a custom element the cdn script defines; the script is
// never loaded here, so this stands in for it with the one behavior that
// matters: a launch button inside its shadow root that reports a recommended
// grant. a definition can't be undone, so it lives in a file of its own, where
// it upgrades every `<chariot-connect>` this file renders. each launch reports
// `connect.detail`, so a test can give a relaunch its own session.
const connect = { detail: success_detail };
customElements.define(
  "chariot-connect",
  class extends HTMLElement {
    connectedCallback() {
      const btn = document.createElement("button");
      btn.textContent = "Launch DAF";
      btn.addEventListener("click", () =>
        this.dispatchEvent(
          new CustomEvent("CHARIOT_SUCCESS", { detail: connect.detail })
        )
      );
      this.attachShadow({ mode: "open" }).appendChild(btn);
    }
  }
);

describe("daf checkout: a second launch while the first intent is in flight", () => {
  afterEach(() => {
    connect.detail = success_detail;
    redirect_mock.mockReset();
    for (const s of document.querySelectorAll(
      `script[src="${CHARIOT_CONNECT_SDK}"]`
    )) {
      s.remove();
    }
  });

  test("the launcher goes inert before the intent is answered, so a second launch cannot make a second intent", async () => {
    const posted: unknown[] = [];
    let answer!: () => void;
    const answered = new Promise<void>((r) => {
      answer = r;
    });
    mswWorker.use(
      http.post(href("/api/donation-intents"), async ({ request }) => {
        posted.push(await request.json());
        await answered;
        return HttpResponse.json({ id: "don_1" });
      })
    );
    redirect_mock.mockImplementation(() => {});
    const s = document.createElement("script");
    s.type = "text/plain";
    s.src = CHARIOT_CONNECT_SDK;
    document.head.appendChild(s);

    const Stub = stb(<ChariotCheckout {...fv} />);
    const screen = await render(<Stub />);
    const launch = screen.getByRole("button", { name: /launch daf/i });
    // `closest` stops at the shadow boundary, so inertness is read off the host
    const host = screen.container.querySelector("chariot-connect")!;

    await launch.click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    // the first intent has no answer yet. `inert` is what stops the second
    // click: it shuts out pointer and keyboard, where a programmatic click()
    // still reaches the handler, which holds no latch of its own.
    await vi.waitFor(() => expect(host.closest("[inert]")).not.toBeNull());
    // and the donor cannot reach it by role either
    expect(
      screen.getByRole("button", { name: /launch daf/i }).query()
    ).toBeNull();

    answer();
    await vi.waitFor(() => expect(redirect_mock).toHaveBeenCalledOnce());
    expect(posted).toHaveLength(1);
  });

  test("a refusal that made no grant brings the launcher back, and a second launch posts a second intent for its own session", async () => {
    // the live read for the test above: the same click does post when nothing
    // has been sent, so one intent there is the guard and not a dead button
    const posted: { via_extra?: string }[] = [];
    let refuse_first = true;
    mswWorker.use(
      http.post(href("/api/donation-intents"), async ({ request }) => {
        posted.push((await request.json()) as { via_extra?: string });
        if (refuse_first) {
          refuse_first = false;
          return resp.refuse("Your fund couldn't make this grant.", 410);
        }
        return HttpResponse.json({ id: "don_1" });
      })
    );
    redirect_mock.mockImplementation(() => {});
    const s = document.createElement("script");
    s.type = "text/plain";
    s.src = CHARIOT_CONNECT_SDK;
    document.head.appendChild(s);

    const Stub = stb(<ChariotCheckout {...fv} />);
    const screen = await render(<Stub />);
    const launch = screen.getByRole("button", { name: /launch daf/i });

    await launch.click();
    await expect
      .element(screen.getByRole("dialog"))
      .toMatchTextContent(/couldn't make this grant/i);
    (
      screen
        .getByRole("button", { name: "Ok", exact: true })
        .element() as HTMLElement
    ).click();
    await vi.waitFor(() =>
      expect(screen.getByRole("dialog").query()).toBeNull()
    );
    connect.detail = { ...success_detail, workflowSessionId: "ws_2" };
    await launch.click();

    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted.map((x) => x.via_extra)).toEqual(["ws_1", "ws_2"]);
  });
});
