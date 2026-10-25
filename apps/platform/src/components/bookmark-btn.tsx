import { Arrow, Content, Tooltip } from "@better-giving/ui/tooltip";
import { Heart } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { login_url } from "#/helpers/login-url";
import { use_user } from "#/hooks/use-user";
import type { INpoBookmark } from "#/types/user";

interface IBookmarkBtn {
  npo: INpoBookmark;
  /** the button's box, ink and placement; the bare glyph-sized target unless
   * given */
  classes?: string;
  /** the heart's ink while it can't save yet (loading, logged out) */
  idle_ink?: string;
}

/** the heart a save fills grows into place */
const POP_IN = "transition-[scale] ease-out starting:scale-75";

const focus_ring =
  "focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2";

export function BookmarkBtn({
  classes = "",
  npo,
  idle_ink = "text-gray-11",
}: IBookmarkBtn) {
  const { user, toggle_bookmark } = use_user();
  const [pending, set_pending] = useState(false);
  // set by the press that saves, so a heart already saved on load stays still
  const [saved_here, set_saved_here] = useState(false);
  const { pathname, search } = useLocation();

  if (user === "loading") {
    return (
      <span aria-hidden className={`glyph-btn ${classes}`}>
        <Heart className={`icon-xl animate-pulse ${idle_ink}`} />
      </span>
    );
  }

  if (!user) {
    return (
      <Tooltip
        tip={
          <Content className="text-sm">
            Login to save your favorites
            <Arrow />
          </Content>
        }
        trigger="child"
      >
        <Link
          to={login_url(pathname + search)}
          aria-label="Add to favorites"
          className={`glyph-btn ${focus_ring} ${classes}`}
        >
          <Heart aria-hidden className={`icon-xl ${idle_ink}`} />
        </Link>
      </Tooltip>
    );
  }

  const is_bookmarked = user.bookmarks.some((b) => b.id === npo.id);

  return (
    <Tooltip
      tip={
        !is_bookmarked ? (
          <Content className="text-sm">
            Add to favorites
            <Arrow />
          </Content>
        ) : null
      }
    >
      <button
        type="button"
        disabled={pending}
        aria-label="Add to favorites"
        aria-pressed={is_bookmarked}
        className={`glyph-btn disabled:text-gray-11 ${focus_ring} ${classes}`}
        onClick={async () => {
          set_saved_here(!is_bookmarked);
          set_pending(true);
          await toggle_bookmark(npo, user);
          set_pending(false);
        }}
      >
        {/* keyed, so the filled heart is a new node and can pop in */}
        <Heart
          key={String(is_bookmarked)}
          aria-hidden
          className={`icon-xl ${
            is_bookmarked ? "fill-destructive text-destructive" : ""
          } ${is_bookmarked && saved_here ? POP_IN : ""}`}
        />
      </button>
    </Tooltip>
  );
}
