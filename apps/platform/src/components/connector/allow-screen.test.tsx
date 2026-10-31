import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { AllowScreen, type IAllowScreen } from "./allow-screen";

const disclosure =
  "The connection can read donors' names and email addresses, donations, campaigns, and forms. It can create, edit, publish, and end campaigns and add photos to them. It can create, edit, and publish donation forms. It cannot move money.";

const CONSENT_URL = "/admin/connector/allow?state=oauth-state&client=chatgpt";

type IProps = Omit<IAllowScreen, "email"> & { email?: string };

/** the header's two logos, client first; both are decorative (`alt=""`) */
function logos(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLImageElement>("header img"),
    (img) => ({ src: img.getAttribute("src"), alt: img.getAttribute("alt") })
  );
}

const empty_text =
  "Switch to the account that runs your nonprofit, or register one at better.giving/register.";

function render_screen({ email = "maria@hopeshelter.org", ...props }: IProps) {
  const Stub = createRoutesStub([
    {
      path: "/admin/connector/allow",
      Component: () => <AllowScreen email={email} {...props} />,
      HydrateFallback: () => null,
    },
  ]);
  return render(<Stub initialEntries={[CONSENT_URL]} />);
}

describe("AllowScreen", () => {
  test("an admin with two nonprofits sees both and can allow or deny", async () => {
    const screen = await render_screen({
      state: "oauth-state",
      client: "chatgpt",
      nonprofits: [
        { id: 12, name: "Harbor Food Bank" },
        { id: 48, name: "Ridge Clinic" },
      ],
    });

    await expect
      .element(
        screen.getByRole("heading", {
          name: "ChatGPT wants to connect to Better Giving",
        })
      )
      .toBeVisible();
    const [client_logo, bg_logo] = logos(screen.container);
    expect(client_logo).toEqual({
      src: "/icons/clients/openai-white-monoblossom.svg",
      alt: "",
    });
    expect(bg_logo?.alt).toBe("");
    await expect
      .element(screen.getByText(disclosure, { exact: true }))
      .toBeVisible();

    const harbor = screen.getByRole("radio", { name: "Harbor Food Bank" });
    const ridge = screen.getByRole("radio", { name: "Ridge Clinic" });
    await expect.element(harbor).toBeVisible();
    await expect.element(ridge).toBeVisible();
    await expect.element(harbor).toHaveAttribute("value", "12");
    await expect.element(ridge).toHaveAttribute("value", "48");
    await expect.element(harbor).not.toBeChecked();
    await expect.element(ridge).not.toBeChecked();

    const allow = screen.getByRole("button", { name: "Allow", exact: true });
    const deny = screen.getByRole("button", { name: "Deny", exact: true });
    await expect.element(allow).toBeVisible();
    await expect.element(deny).toBeVisible();
    await expect.element(allow).toBeEnabled();
    await expect.element(allow).toHaveAttribute("name", "decision");
    await expect.element(allow).toHaveAttribute("value", "allow");
    await expect.element(deny).toHaveAttribute("name", "decision");
    await expect.element(deny).toHaveAttribute("value", "deny");
  });

  test("an unknown client is named generically", async () => {
    const screen = await render_screen({
      state: "oauth-state",
      nonprofits: [{ id: 7, name: "Only Kitchen" }],
    });

    await expect
      .element(
        screen.getByRole("heading", {
          name: "An AI assistant wants to connect to Better Giving",
        })
      )
      .toBeVisible();
  });

  test("Claude is named and shows its own logo", async () => {
    const screen = await render_screen({
      state: "oauth-state",
      client: "claude",
      nonprofits: [{ id: 7, name: "Only Kitchen" }],
    });

    await expect
      .element(
        screen.getByRole("heading", {
          name: "Claude wants to connect to Better Giving",
        })
      )
      .toBeVisible();
    expect(logos(screen.container)[0]).toEqual({
      src: "/icons/clients/claude-icon-square.svg",
      alt: "",
    });
  });

  test("the signed-in account can be switched back to this request", async () => {
    const screen = await render_screen({
      state: "oauth-state",
      nonprofits: [{ id: 7, name: "Only Kitchen" }],
    });

    await expect
      .element(screen.getByText("maria@hopeshelter.org", { exact: true }))
      .toBeVisible();
    const swap = screen.getByRole("button", { name: "Switch account" });
    const form = swap.element().closest("form");
    expect(form?.getAttribute("action")).toBe("/logout");
    expect(form?.getAttribute("method")).toBe("post");
    const back = form?.querySelector<HTMLInputElement>(
      'input[name="redirect"]'
    );
    expect(back?.value).toBe(CONSENT_URL);
  });

  test("the only nonprofit is already selected", async () => {
    const screen = await render_screen({
      state: "oauth-state",
      nonprofits: [{ id: 7, name: "Only Kitchen" }],
    });

    const only = screen.getByRole("radio", { name: "Only Kitchen" });
    await expect.element(only).toBeVisible();
    await expect.element(only).toBeChecked();
  });

  test("a refused connection is an alert above the buttons", async () => {
    const message =
      "This connection request can't be completed. Start again from the chat.";
    const screen = await render_screen({
      state: "oauth-state",
      nonprofits: [{ id: 7, name: "Only Kitchen" }],
      error: message,
    });

    const alert = screen.getByRole("alert");
    await expect.element(alert).toBeVisible();
    await expect.element(alert).toHaveTextContent(message);
    await expect.element(alert).toHaveFocus();
    await expect
      .element(screen.getByRole("button", { name: "Allow", exact: true }))
      .toBeVisible();
  });

  test("a refusal to choose is an alert above the buttons", async () => {
    const screen = await render_screen({
      state: "oauth-state",
      nonprofits: [
        { id: 12, name: "Harbor Food Bank" },
        { id: 48, name: "Ridge Clinic" },
      ],
      error: "Choose a nonprofit",
    });

    const alert = screen.getByRole("alert");
    await expect.element(alert).toBeVisible();
    await expect.element(alert).toHaveTextContent("Choose a nonprofit");
  });

  test("a blocked connection request shows the refusal and no buttons, and can still switch account", async () => {
    const message =
      "This connection request can't be completed. Start again from the chat.";
    const screen = await render_screen({
      state: "not-used",
      client: "chatgpt",
      nonprofits: [{ id: 7, name: "Only Kitchen" }],
      error: message,
      blocked: true,
    });

    await expect
      .element(
        screen.getByRole("heading", {
          name: "ChatGPT wants to connect to Better Giving",
        })
      )
      .toBeVisible();
    await expect
      .element(screen.getByText("maria@hopeshelter.org", { exact: true }))
      .toBeVisible();
    const swap = screen.getByRole("button", { name: "Switch account" });
    await expect.element(swap).toBeVisible();
    expect(
      (swap.element() as HTMLElement).closest("form")?.getAttribute("action")
    ).toBe("/logout");

    const alert = screen.getByRole("alert");
    await expect.element(alert).toBeVisible();
    await expect.element(alert).toHaveTextContent(message);
    await expect
      .element(screen.getByRole("button", { name: "Allow", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Deny", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("radio")).not.toBeInTheDocument();
  });

  test("an account with no nonprofit is pointed at registration and can only deny", async () => {
    const screen = await render_screen({
      state: "oauth-state",
      nonprofits: [],
    });

    await expect
      .element(
        screen.getByText("This account doesn't manage a nonprofit", {
          exact: true,
        })
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "better.giving/register" }))
      .toHaveAttribute("href", "/register");
    const deny = screen.getByRole("button", { name: "Deny", exact: true });
    const allow = screen.getByRole("button", { name: "Allow", exact: true });
    await expect.element(deny).toBeVisible();
    await expect.element(deny).toBeEnabled();
    await expect.element(allow).toBeVisible();
    await expect.element(allow).toBeDisabled();
    // the disabled Allow says why, as Deny does
    await expect
      .element(allow)
      .toHaveAccessibleDescription(expect.stringContaining(empty_text));
    await expect
      .element(deny)
      .toHaveAccessibleDescription(expect.stringContaining(empty_text));
    await expect.element(screen.getByRole("radio")).not.toBeInTheDocument();
  });
});
