import { LoaderCircle } from "lucide-react";
import type { PropsWithChildren } from "react";

export function LoadText({
  text = "Submitting...",
  is_loading,
  children,
}: PropsWithChildren<{ is_loading?: boolean; text?: string }>) {
  return is_loading ? (
    <>
      {/* a .btn spaces its children with its own gap; any other host gets the
          margin */}
      <LoaderCircle className="inline animate-spin inset-be-px relative me-1 in-[.btn]:me-0" />
      {text}
    </>
  ) : (
    children
  );
}
