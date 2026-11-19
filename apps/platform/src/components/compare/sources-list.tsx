import { ExtLink } from "@better-giving/ui";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { ICompareSource } from "#/content/compare/types";

interface ISourcesList {
  sources: ICompareSource[];
}

const SOURCE_HASH = /^#s\d+$/;

/** the page's sources, collapsed. a superscript's `#s<n>` opens it and lands
 * on the entry: a closed <details> hides its list, and not every browser
 * expands it for a fragment. */
export function SourcesList({ sources }: ISourcesList) {
  const [open, set_open] = useState(false);

  useEffect(() => {
    const reveal = (hash: string) => {
      if (!SOURCE_HASH.test(hash)) return;
      set_open(true);
      requestAnimationFrame(() =>
        document
          .getElementById(hash.slice(1))
          ?.scrollIntoView({ block: "center" })
      );
    };
    reveal(window.location.hash);
    const on_hash = () => reveal(window.location.hash);
    // a second click on the number already in the url fires no hashchange
    const on_click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href^='#s']");
      const hash = a?.getAttribute("href");
      if (hash) reveal(hash);
    };
    window.addEventListener("hashchange", on_hash);
    document.addEventListener("click", on_click);
    return () => {
      window.removeEventListener("hashchange", on_hash);
      document.removeEventListener("click", on_click);
    };
  }, []);

  return (
    <details
      open={open}
      onToggle={(e) => set_open(e.currentTarget.open)}
      className="group card"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded text-sm font-bold focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        Sources for this page
        <ChevronDown className="icon-lg transition group-open:rotate-180" />
      </summary>
      <ol className="mt-4 grid list-decimal gap-2 pl-5 text-sm marker:text-gray-11">
        {sources.map((s, i) => (
          <li key={s.id} id={`s${i + 1}`} className="scroll-mt-20">
            <ExtLink href={s.url} className="link">
              {s.title}
            </ExtLink>
          </li>
        ))}
      </ol>
    </details>
  );
}
