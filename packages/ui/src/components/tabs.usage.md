# tabs

Registry item `tabs` (file: `components/tabs.tsx`). Needs the `tokens` item, `react` and `@ark-ui/react`.

## API

`import { Tabs, TabList, Tab, TabPanel } from "./components/tabs"`.

```tsx
<Tabs defaultValue="monthly">
  <TabList aria-label="Billing">
    <Tab value="monthly">Monthly</Tab>
    <Tab value="yearly">Yearly</Tab>
  </TabList>
  <TabPanel value="monthly">...</TabPanel>
  <TabPanel value="yearly">...</TabPanel>
</Tabs>
```

- `Tabs`: Ark UI root. Uncontrolled with `defaultValue`; controlled with `value` and `onValueChange` (receives `{ value }`). Other Ark options (`orientation`, `activationMode`) pass through.
- `TabList`: name it with `aria-label` or `aria-labelledby`.
- `Tab`: `value` (required), `disabled`.
- `TabPanel`: `value` of the tab that shows it.
- Every part takes `classes`, appended last.

## Accessibility

Roles `tablist`, `tab`, `tabpanel`, `aria-selected`, `aria-controls` and a roving tab stop come from Ark UI. Arrow keys move between tabs and skip disabled ones; each panel is named by its tab. Focus shows a 2px `--ring` outline.

## Layout

`TabList` neither wraps nor scrolls. With many tabs on a narrow screen, put it in a container that scrolls horizontally (`overflow-x-auto`), or keep the labels short.

## Theming

The selected tab uses `border-primary` and `text-accent-11`; the rest use `text-gray-11`; the list edge is `border-hairline`. Everything is a scale step or role, so a theme or `.dark` recolors the set.
