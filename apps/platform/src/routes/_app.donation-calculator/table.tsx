import { Image, Tab, TabList, TabPanel, Tabs } from "@better-giving/ui";
import { to_usd } from "@better-giving/ui/helpers";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import laira_coin from "#/assets/laira/laira-coin.webp";
import type { View } from "./types";
import { Usd } from "./usd";

interface Props extends View {
  classes?: string;
}

export function Table({ classes = "", ...v }: Props) {
  const [tab, set_tab] = useState("1 Year");
  // array of time periods
  const periods = [
    { label: "1 Year", value: 1 },
    { label: "5 Year", value: 5 },
    { label: "10 Year", value: 10 },
  ];

  const period = periods.find((p) => p.label === tab)!;
  const p = v.projection[period.value - 1];

  return (
    <div className={`${classes} p-6 @container`}>
      <div
        className={`${
          p.total > 0
            ? "bg-success-subtle"
            : p.total < 0
              ? "bg-destructive-subtle"
              : "bg-gray-3"
        } p-4 @md:p-6 rounded @md:flex items-center gap-4 mb-2`}
      >
        {p.total > 0 ? (
          <TrendingUp className="size-8 sm:size-10 text-success" />
        ) : p.total < 0 ? (
          <TrendingDown className="size-8 sm:size-10 text-destructive" />
        ) : null}
        <div>
          <p className="sm:text-lg font-bold text-balance">
            {tab} Savings & Investment Impact
          </p>
          <Usd classes="text-lg font-bold">{p.total}</Usd>
        </div>
        {p.total > 0 && (
          <Image
            src={laira_coin}
            width={70}
            className="@max-md:hidden ml-auto"
          />
        )}
      </div>
      <Tabs value={tab} onValueChange={(e) => set_tab(e.value)}>
        <TabList aria-label="Projection period">
          {periods.map((p) => (
            <Tab key={p.value} value={p.label} classes="flex-1 justify-center">
              {p.label}
            </Tab>
          ))}
        </TabList>
        {periods.map((p) => {
          const x = v.projection[p.value - 1];
          return (
            <TabPanel key={p.value} value={p.label} classes="mt-4">
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>{p.value === 1 ? "Allocation" : "Total Invested"}</th>
                      <th>Year {p.value} Balance</th>
                      <th>Growth</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        Savings (3.4% variable interest, illustrative example)
                      </td>
                      <td>{to_usd(x.end.liq - x.liq)}</td>
                      <td>{to_usd(x.end.liq)}</td>
                      <td>{to_usd(x.liq)}</td>
                    </tr>
                    <tr>
                      <td>Sustainability Fund (11%, illustrative example)</td>
                      <td>{to_usd(x.end.lock - x.lock)}</td>
                      <td>{to_usd(x.end.lock)}</td>
                      <td>{to_usd(x.lock)}</td>
                    </tr>
                    <tr>
                      <td>Total</td>
                      <td>{to_usd(x.end.total - x.total)}</td>
                      <td>{to_usd(x.end.total)}</td>
                      <td>{to_usd(x.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </TabPanel>
          );
        })}
      </Tabs>
    </div>
  );
}
