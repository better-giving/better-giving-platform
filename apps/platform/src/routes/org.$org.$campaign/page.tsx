import { ExtLink, Image, Modal } from "@better-giving/ui";
import { XIcon } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { DonorMsgs, type IDonorHighlight } from "#/components/donor-msgs";
import { DappLogo } from "#/components/image";
import { RichText } from "#/components/rich-text";
import { extract_youtube_id } from "#/components/youtube-player";
import { Share } from "#/routes/_app.campaigns.$fund_id/share";
import { Video } from "#/routes/_app.campaigns.$fund_id/video";
import type { RichTextContent } from "#/types/components";

const ring =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const donate_inline = `h-16 w-full rounded bg-primary text-2xl font-semibold text-primary-fg hover:bg-blue-10 ${ring}`;
const donate_header = `h-11 shrink-0 rounded bg-primary px-4 text-base font-semibold text-primary-fg hover:bg-blue-10 ${ring}`;
const donate_bar = `h-12 min-w-0 flex-1 rounded bg-primary text-base font-semibold text-primary-fg hover:bg-blue-10 ${ring}`;
const close_btn =
  "grid size-11 place-items-center rounded text-2xl leading-none text-gray-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-9";
// a bare min-[1288px]: sorts before lg: (px vs 64rem), so the zero is lg:-prefixed
const gutter = "px-5 lg:px-8 lg:min-[1288px]:px-0";

export interface ICampaignPage {
  title: string;
  org_name: string;
  org_href: string;
  logo: string | null;
  legal?: string;
  website?: { href: string; label: string };
  tag: string | null;
  program_name: string | null;
  hero: string | null;
  hero_alt: string;
  story: RichTextContent;
  videos: { url: string; title?: string }[];
  raised_line: string;
  bar: { raised: number; goal: number } | null;
  donor_line: string;
  no_gifts: boolean;
  open: boolean;
  ended_body: string | null;
  thanks?: { amount: string; receipt?: string };
  gift_failed?: boolean;
  pay_busy?: boolean;
  highlight?: IDonorHighlight;
  donors: { id: string; campaign_id: string };
  form: ReactNode;
  initial_dialog_open?: boolean;
  share: { recipientName: string; url: string };
}

export function CampaignPage(props: ICampaignPage) {
  const [dialog, set_dialog] = useState(
    props.open && props.initial_dialog_open === true
  );
  const [away, set_away] = useState(false);
  // false until the first measure, so a tall column can show the header
  const [fits, set_fits] = useState(false);
  const donate_ref = useRef<HTMLButtonElement>(null);
  const close_ref = useRef<HTMLButtonElement>(null);
  const action_ref = useRef<HTMLDivElement>(null);
  const open_dialog = () => set_dialog(true);

  useLayoutEffect(() => {
    const node = action_ref.current;
    if (!node) return;
    const measure = () => {
      // unresolved feed is a short box; sticking now unsticks when cards land
      if (node.querySelector("[data-feed-pending]")) {
        set_fits(false);
        return;
      }
      const height = node.getBoundingClientRect().height;
      // 0 is the mobile display:contents box; it has nothing to stick
      set_fits(height > 0 && height <= window.innerHeight - 64);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    // a marker can leave without a box change (empty feed, highlight already painted)
    const mo = new MutationObserver(measure);
    mo.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-feed-pending"],
    });
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const node = donate_ref.current;
    if (!props.open || !node) {
      set_away(false);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        set_away(entry ? !entry.isIntersecting : false);
      },
      { threshold: 0 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [props.open]);

  const sticky_bar = props.open && away;
  const sticky_header = sticky_bar && !fits;

  return (
    <>
      <div
        inert={dialog ? true : undefined}
        className="min-h-[100dvh] text-gray-12"
      >
        {sticky_header && (
          <header
            data-sticky="header"
            className="fixed inset-x-0 top-0 z-sticky hidden h-14 bg-card shadow-floating lg:flex"
          >
            <div
              className={`mx-auto flex h-full w-full max-w-[1224px] items-center justify-between gap-3 ${gutter}`}
            >
              <p className="min-w-0 truncate text-base font-semibold">
                {props.title}
              </p>
              <button
                type="button"
                onClick={open_dialog}
                className={donate_header}
              >
                Donate
              </button>
            </div>
          </header>
        )}
        <div
          className={`mx-auto w-full max-w-[1224px] pt-4 pb-12 lg:pt-8 lg:pb-16 ${gutter}`}
        >
          <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_392px] lg:items-start lg:gap-8">
            <div
              data-col="story"
              className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-10"
            >
              <Mast {...props} />
              {props.hero && (
                <Image
                  src={props.hero}
                  alt={props.hero_alt}
                  className="order-5 aspect-video w-full rounded object-cover lg:order-none"
                />
              )}
              <section aria-label="Story" className="order-6 lg:order-none">
                <RichText
                  readOnly
                  content={props.story}
                  classes={{
                    field:
                      "flex w-full flex-col gap-4 text-base font-normal leading-relaxed",
                  }}
                />
              </section>
              {props.videos.length > 0 && (
                <Videos title={props.title} videos={props.videos} />
              )}
            </div>
            <div
              ref={action_ref}
              data-col="action"
              className={`contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6 lg:has-[[data-feed]]:gap-10${fits ? " lg:sticky lg:top-8 lg:self-start" : ""}`}
            >
              <Notice {...props} />
              <div className="order-4 flex flex-col gap-2 lg:order-none">
                {props.open && (
                  <button
                    ref={donate_ref}
                    type="button"
                    onClick={open_dialog}
                    className={donate_inline}
                  >
                    Donate
                  </button>
                )}
                <Share
                  trigger="button"
                  recipientName={props.share.recipientName}
                  url={props.share.url}
                />
              </div>
              <Progress {...props} />
              <DonorMsgs
                layout="feed"
                classes="order-8 lg:order-none"
                id={props.donors.id}
                campaign_id={props.donors.campaign_id}
                highlight={props.highlight}
              />
            </div>
          </div>
          <footer className="mt-10 flex w-full items-center gap-3 border-t border-hairline py-6 lg:mt-16">
            <DappLogo classes="h-8" />
            <span className="text-sm font-semibold">Better Giving</span>
          </footer>
        </div>
        {sticky_bar && (
          <div
            data-sticky="bar"
            className="fixed inset-x-0 bottom-0 z-sticky flex gap-2 bg-card shadow-floating px-5 py-3 lg:hidden"
          >
            <Share
              trigger="button"
              classes="min-w-0 flex-1"
              recipientName={props.share.recipientName}
              url={props.share.url}
            />
            <button type="button" onClick={open_dialog} className={donate_bar}>
              Donate
            </button>
          </div>
        )}
      </div>
      <Modal
        open={dialog}
        busy={props.pay_busy === true}
        onClose={() => {
          if (props.pay_busy) return;
          set_dialog(false);
        }}
        size="donate"
        classes="bg-card"
        scrim="bg-gray-12/56"
        title="Donate"
        adoptStripeChallenge
        initialFocusEl={() => {
          // lib.dom FocusOptions stops at preventScroll; the flag is what skips :focus-visible
          close_ref.current?.focus({ focusVisible: false } as FocusOptions);
          return close_ref.current;
        }}
      >
        <div className="flex shrink-0 justify-end bg-surface px-2 pt-2 sm:sticky sm:top-0 sm:z-sticky">
          <button
            ref={close_ref}
            type="button"
            aria-label="Close"
            disabled={props.pay_busy === true}
            onClick={() => {
              if (props.pay_busy) return;
              set_dialog(false);
            }}
            className={`${close_btn} disabled:opacity-40`}
          >
            <XIcon className="icon-2xl" />
          </button>
        </div>
        <div className="max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col max-sm:overflow-y-auto max-sm:scrollbars">
          {props.form}
        </div>
      </Modal>
    </>
  );
}

function Mast(props: ICampaignPage) {
  return (
    <div className="order-2 flex flex-col gap-3 lg:order-none">
      <div className="order-2 flex items-center gap-3 lg:order-1">
        {props.logo && (
          <Image
            src={props.logo}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-full border border-gray-6 object-cover"
          />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link
            to={props.org_href}
            className={`min-w-0 text-base font-semibold text-gray-12 hover:text-primary ${ring}`}
          >
            {props.org_name}
          </Link>
          {(props.legal || props.website) && (
            <p className="text-sm text-gray-11">
              {props.legal}
              {props.legal && props.website ? " · " : null}
              {props.website && (
                <ExtLink
                  href={props.website.href}
                  className="link font-semibold underline"
                >
                  {props.website.label}
                </ExtLink>
              )}
            </p>
          )}
        </div>
      </div>
      <h1 className="order-1 text-3xl font-bold leading-[1.15] tracking-[-0.02em] text-balance break-words lg:order-2 lg:text-4xl">
        {props.title}
      </h1>
      {(props.tag || props.program_name) && (
        <div className="order-3 flex flex-wrap gap-2">
          {props.tag && (
            <p className="inline-block rounded bg-secondary px-2 py-1 text-xs font-semibold uppercase tracking-badge text-gray-12">
              {props.tag}
            </p>
          )}
          {props.program_name && (
            <p className="inline-block max-w-full rounded bg-gray-3 px-2 py-1 text-sm font-medium break-words text-gray-12">
              {props.program_name}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Notice(props: ICampaignPage) {
  if (props.thanks) {
    return (
      <section className="order-1 flex flex-col gap-2 rounded border border-green-6 bg-green-2 p-4 lg:order-none">
        <h2 className="text-xl font-bold">Thank you</h2>
        <p>Your {props.thanks.amount} gift is in.</p>
        {props.thanks.receipt && (
          <Link
            to={props.thanks.receipt}
            className="text-sm font-semibold underline"
          >
            View your receipt
          </Link>
        )}
      </section>
    );
  }
  if (props.gift_failed) {
    return (
      <section className="order-1 lg:order-none">
        <div className="bg-card rounded-card">
          <div className="flex flex-col gap-2 p-4">
            <h2 className="text-xl font-bold">This gift didn't go through</h2>
            {props.open ? (
              <p>You can try again from this page.</p>
            ) : (
              <>
                {props.ended_body ? <p>{props.ended_body}</p> : null}
                <Link
                  to={props.org_href}
                  className="link text-sm font-semibold"
                >
                  Visit {props.org_name}
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
    );
  }
  if (!props.open && props.ended_body) {
    return (
      <section className="order-1 lg:order-none">
        <div className="bg-card rounded-card">
          <div className="flex flex-col gap-2 p-4">
            <h2 className="text-xl font-bold">Giving has ended</h2>
            <p>{props.ended_body}</p>
            <Link to={props.org_href} className="link text-sm font-semibold">
              Visit {props.org_name}
            </Link>
          </div>
        </div>
      </section>
    );
  }
  return null;
}

function Progress(props: ICampaignPage) {
  return (
    <div className="order-3 flex flex-col gap-2 lg:order-none">
      <p className="text-base">{props.raised_line}</p>
      {props.bar && (
        <RaisedBar raised={props.bar.raised} goal={props.bar.goal} />
      )}
      <p className="text-base">{props.donor_line}</p>
      {props.no_gifts && <p className="text-base">No gifts yet</p>}
    </div>
  );
}

function RaisedBar({ raised, goal }: { raised: number; goal: number }) {
  const percent = goal > 0 ? Math.min(100, (raised / goal) * 100) : 0;
  const square = percent < 1;
  const fill = raised <= 0 ? "0px" : `max(4px, ${percent}%)`;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={goal}
      aria-valuenow={Math.min(raised, goal)}
      aria-label="Amount raised"
      className={`h-2 w-full bg-gray-3 inset-shadow-track ${square ? "rounded-none" : "rounded"}`}
    >
      <div
        className={`h-full bg-success shadow-track-fill ${square ? "rounded-none" : "rounded"}`}
        style={{ width: fill }}
      />
    </div>
  );
}

function Videos({
  title,
  videos,
}: {
  title: string;
  videos: ICampaignPage["videos"];
}) {
  return (
    <section className="order-7 flex flex-col gap-2 lg:order-none">
      {videos.map((video) =>
        extract_youtube_id(video.url) ? (
          <Video
            key={video.url}
            url={video.url}
            title={
              video.title
                ? `Play video: ${video.title}`
                : `Play video: ${title}`
            }
          />
        ) : (
          <ExtLink key={video.url} href={video.url} className="link">
            {video.url}
          </ExtLink>
        )
      )}
    </section>
  );
}
