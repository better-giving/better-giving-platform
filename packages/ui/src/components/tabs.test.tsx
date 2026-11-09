import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Tab, TabList, TabPanel, Tabs } from "./tabs";

const items = [
  { value: "profile", label: "Profile" },
  { value: "donation", label: "Donation Page" },
  { value: "fundraiser", label: "Fundraiser" },
];

function Subject(props: {
  value?: string;
  onValueChange?: (e: { value: string }) => void;
}) {
  return (
    <Tabs defaultValue="profile" {...props}>
      <TabList aria-label="Sections">
        {items.map((it) => (
          <Tab key={it.value} value={it.value}>
            {it.label}
          </Tab>
        ))}
      </TabList>
      {items.map((it) => (
        <TabPanel key={it.value} value={it.value}>
          {it.label} panel
        </TabPanel>
      ))}
    </Tabs>
  );
}

describe("Tabs", () => {
  test("clicking a trigger selects it and shows its panel", async () => {
    const screen = await render(<Subject />);
    await expect
      .element(screen.getByRole("tabpanel"))
      .toHaveTextContent("Profile panel");

    await screen.getByRole("tab", { name: "Donation Page" }).click();

    await expect
      .element(screen.getByRole("tab", { name: "Donation Page" }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("tabpanel"))
      .toHaveTextContent("Donation Page panel");
  });

  test("arrow keys move the selection", async () => {
    const screen = await render(<Subject />);
    await screen.getByRole("tab", { name: "Profile" }).click();

    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(screen.getByRole("tab", { name: "Donation Page" }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("tab", { name: "Profile" }))
      .toHaveAttribute("aria-selected", "false");

    await userEvent.keyboard("{ArrowLeft}");
    await expect
      .element(screen.getByRole("tab", { name: "Profile" }))
      .toHaveAttribute("aria-selected", "true");

    // loops from the first trigger back to the last
    await userEvent.keyboard("{ArrowLeft}");
    await expect
      .element(screen.getByRole("tab", { name: "Fundraiser" }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("tabpanel"))
      .toHaveTextContent("Fundraiser panel");
  });

  test("controlled value reports the chosen tab's value", async () => {
    const seen: string[] = [];
    const screen = await render(
      <Subject value="profile" onValueChange={(e) => seen.push(e.value)} />
    );
    await screen.getByRole("tab", { name: "Fundraiser" }).click();
    expect(seen).toEqual(["fundraiser"]);
  });

  test("the selected tab is told by its underline", async () => {
    const screen = await render(<Subject />);
    await expect
      .element(screen.getByRole("tab", { name: "Profile" }))
      .toHaveAttribute("data-selected");
    await expect
      .element(screen.getByRole("tab", { name: "Donation Page" }))
      .not.toHaveAttribute("data-selected");
  });
});
