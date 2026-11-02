import { Breadcrumb } from "@better-giving/ui";

// the title of a nested dashboard page: ancestors are links, the last item is
// the page's h1. previews mount under DsProvider's MemoryRouter.

export const Default = () => (
  <Breadcrumb
    items={[
      { label: "Programs", to: "/admin/9/programs" },
      { label: "Clean water for Turkana County" },
    ]}
  />
);

export const ThreeLevels = () => (
  <Breadcrumb
    items={[
      { label: "Programs", to: "/admin/9/programs" },
      { label: "Clean water for Turkana County", to: "/admin/9/programs/3" },
      { label: "Edit milestone" },
    ]}
  />
);

// ancestors keep their full label; the current item alone truncates, so a
// long trail fits a narrow column instead of widening the page.
export const LongLabel = () => (
  <div className="w-80">
    <Breadcrumb
      items={[
        { label: "Applications", to: "/platform/applications" },
        {
          label:
            "Rainforest Trust Conservation Action Fund for the Amazon Basin and Guiana Shield",
        },
      ]}
    />
  </div>
);
