import { Tab, TabList, TabPanel, Tabs } from "@better-giving/ui";
import { CodeIcon, TableIcon } from "lucide-react";

export const Default = () => (
  <Tabs classes="w-96" defaultValue="donation">
    <TabList aria-label="Settings">
      <Tab value="donation">Donation</Tab>
      <Tab value="fundraiser">Fundraiser</Tab>
      <Tab value="donation-form">Donation Form</Tab>
    </TabList>
    <TabPanel value="donation" classes="mt-4 text-sm">
      Receipt message and donor address settings
    </TabPanel>
    <TabPanel value="fundraiser" classes="mt-4 text-sm">
      Let supporters run fundraisers for this nonprofit
    </TabPanel>
    <TabPanel value="donation-form" classes="mt-4 text-sm">
      Payment methods, suggested amounts and goal
    </TabPanel>
  </Tabs>
);

export const WithIcons = () => (
  <Tabs classes="w-96" defaultValue="table">
    <TabList aria-label="Records">
      <Tab value="table" classes="gap-2">
        <TableIcon size={14} />
        Records
      </Tab>
      <Tab value="json" classes="gap-2">
        <CodeIcon size={14} />
        JSON
      </Tab>
    </TabList>
    <TabPanel value="table" classes="mt-3 text-sm">
      Distribution $1,240.00
    </TabPanel>
    <TabPanel value="json" classes="mt-3 text-xs">
      {'{ "_record": "distribution", "net": 1240 }'}
    </TabPanel>
  </Tabs>
);

export const Stretch = () => (
  <Tabs classes="w-96" defaultValue="1">
    <TabList aria-label="Period">
      <Tab value="1" classes="flex-1 justify-center">
        1 Year
      </Tab>
      <Tab value="5" classes="flex-1 justify-center">
        5 Year
      </Tab>
      <Tab value="10" classes="flex-1 justify-center">
        10 Year
      </Tab>
    </TabList>
    <TabPanel value="1" classes="mt-4 text-sm">
      Year 1 balance $52,000
    </TabPanel>
    <TabPanel value="5" classes="mt-4 text-sm">
      Year 5 balance $281,000
    </TabPanel>
    <TabPanel value="10" classes="mt-4 text-sm">
      Year 10 balance $624,000
    </TabPanel>
  </Tabs>
);
