import { ImagePlaceholder } from "@better-giving/ui";

// stands in for an image that is missing or failed to load. it has no
// intrinsic size — the caller's classes sets the box, and the lucide glyph
// inside scales to half of it.

export const OrgLogo = () => (
  <ImagePlaceholder classes="h-24 w-24 rounded-full" />
);

export const FundraiserCover = () => (
  <ImagePlaceholder classes="h-40 w-60 rounded border" />
);

// how a marketplace card renders before its cover image exists.
export const InCard = () => (
  <div className="w-64 bg-card rounded-card overflow-clip">
    <ImagePlaceholder classes="h-40 w-full" />
    <div className="p-3">
      <h3 className="text-center mb-2">Books for Kids</h3>
      <p className="text-gray-11 text-sm text-center">
        Putting a book in every child's hands.
      </p>
    </div>
  </div>
);

export const Sizes = () => (
  <div className="flex items-end gap-4">
    <ImagePlaceholder classes="h-10 w-10 rounded" />
    <ImagePlaceholder classes="h-24 w-24 rounded" />
    <ImagePlaceholder classes="h-40 w-60 rounded" />
  </div>
);
