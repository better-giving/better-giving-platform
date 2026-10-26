import { ExtLink, Modal } from "@better-giving/ui";
import { LucideShare, X, XIcon } from "lucide-react";
import { useCallback, useState } from "react";
import facebook from "#/assets/icons/social/facebook.webp";
import linkedin from "#/assets/icons/social/linkedin.webp";
import telegram from "#/assets/icons/social/telegram.webp";
import x from "#/assets/icons/social/x.webp";
import { app_name } from "#/constants/env";

interface SocialMedia {
  id: "x" | "telegram" | "linkedin" | "fb";
  title: string;
  src: string;
  size: number;
  handle: string;
}

const socials: SocialMedia[] = [
  {
    id: "linkedin",
    src: linkedin,
    title: "LinkedIn",
    size: 24,
    handle: app_name,
  },
  { id: "fb", src: facebook, title: "Facebook", size: 21, handle: app_name },
  { id: "x", src: x, title: "X", size: 16, handle: "@BetterDotGiving" },
  {
    id: "telegram",
    src: telegram,
    title: "Telegram",
    size: 22,
    handle: "@bettergiving",
  },
];

type ShareProps = {
  recipientName: string;
  classes?: string;
  url: string;
  /** sentence after the invite. the campaign page keeps the invested line. */
  line?: string;
  /**
   * omitted: the heading and the icon row.
   * `"button"`: one Share button that opens the same four networks.
   * `"icon"`: the same, as a 44px share glyph named by `label`.
   * neither trigger appends the invested line unless `line` is set.
   */
  trigger?: "button" | "icon";
  /** the icon trigger's accessible name */
  label?: string;
};

const invested_line =
  "Every gift is invested to provide sustainable funding for nonprofits: Give once, give forever.";

export function Share(props: ShareProps) {
  const [chooser, set_chooser] = useState(false);
  if (props.trigger === "button" || props.trigger === "icon") {
    return (
      <>
        {props.trigger === "button" ? (
          <button
            type="button"
            onClick={() => set_chooser(true)}
            className={`h-12 w-full rounded border border-gray-7 bg-surface text-base font-semibold text-gray-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${props.classes ?? ""}`}
          >
            Share
          </button>
        ) : (
          <button
            type="button"
            aria-label={props.label ?? "Share"}
            onClick={() => set_chooser(true)}
            className={`glyph-btn size-11 text-primary hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${props.classes ?? ""}`}
          >
            <LucideShare aria-hidden className="icon-xl" />
          </button>
        )}
        <Modal
          open={chooser}
          onClose={() => set_chooser(false)}
          size="panel"
          // `!`: the tier's own width classes match this specificity and would
          // otherwise win or lose by stylesheet order
          classes="w-fit! grid content-start gap-2 border bg-surface pb-4"
        >
          {/* no `title`: Modal names the dialog by this heading */}
          <div className="flex items-center justify-between gap-4 pt-2 pr-2 pl-4">
            <h2 className="text-lg font-bold text-gray-12">Share</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => set_chooser(false)}
              className="grid size-11 place-items-center rounded text-gray-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <XIcon aria-hidden className="icon-2xl" />
            </button>
          </div>
          <div className="flex items-center justify-center gap-2 px-4">
            {socials.map((s) => (
              <ShareBtn
                key={s.id}
                {...s}
                url={props.url}
                recipientName={props.recipientName}
                line={props.line ?? ""}
              />
            ))}
          </div>
        </Modal>
      </>
    );
  }
  return (
    <div className={`${props.classes ?? ""} grid py-2`}>
      <h2 data-heading="" className="w-full pt-2 font-bold text-primary mb-2">
        Spread the word!
      </h2>
      <p className="text-gray-11 text-sm max-w-sm">
        Encourage your friends to join in and contribute, making a collective
        impact through donations.
      </p>
      <div className="flex items-center gap-2 mt-1">
        {socials.map((s) => (
          <ShareBtn
            key={s.id}
            {...s}
            url={props.url}
            recipientName={props.recipientName}
            line={props.line}
          />
        ))}
      </div>
    </div>
  );
}

interface IShare extends SocialMedia {
  recipientName: string;
  url: string;
  line?: string;
}
function ShareBtn(props: IShare) {
  const [open, set_open] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={`Share on ${props.title}`}
        onClick={() => set_open(true)}
        className="relative size-11 grid place-items-center"
      >
        <img
          src={props.src}
          width={props.size}
          className="absolute-center"
          alt=""
        />
      </button>
      <Prompt {...props} open={open} set_open={set_open} line={props.line} />
    </>
  );
}

interface IPrompt extends SocialMedia {
  url: string;
  recipientName: string;
  line?: string;
  open: boolean;
  set_open: (open: boolean) => void;
}
function Prompt({
  recipientName,
  open,
  set_open,
  url,
  line,
  ...social
}: IPrompt) {
  //shareText will always hold some value
  const [shareText, setShareText] = useState("");
  const msgRef = useCallback((node: HTMLParagraphElement | null) => {
    if (node) {
      setShareText(node.innerText);
    }
  }, []);

  return (
    <Modal
      open={open}
      onClose={() => set_open(false)}
      size="md"
      classes="grid content-start border bg-background"
    >
      <div className="grid place-items-center relative h-16  font-bold bg-gray-3 border-b">
        Share on {social.title}
        <button
          type="button"
          aria-label="Close"
          onClick={() => set_open(false)}
          className="absolute top-1/2 transform -translate-y-1/2 right-4 size-10 border rounded "
        >
          <X className="absolute-center" width={35} />
        </button>
      </div>
      <p
        ref={msgRef}
        className="my-6 sm:my-10 mx-4 sm:mx-12 text-sm leading-normal p-3 border rounded"
      >
        Donate to <span className="font-bold">{recipientName}</span> on{" "}
        <span className="font-bold">{social.handle}</span>!{" "}
        {line ?? invested_line}
      </p>
      <ExtLink
        href={generateShareLink(shareText, social.id, url)}
        className="btn btn-secondary btn-donate gap-2 min-w-[16rem] mb-6 sm:mb-10 mx-4 sm:justify-self-center sm:w-auto"
      >
        <div className="relative size-8 grid place-items-center">
          <img
            src={social.src}
            className="absolute-center"
            width={social.size}
            alt=""
          />
        </div>
        <span>Share now</span>
      </ExtLink>
    </Modal>
  );
}

function generateShareLink(
  rawText: string,
  type: SocialMedia["id"],
  url: string
) {
  const encodedText = encodeURIComponent(rawText);
  const encodedURL = encodeURIComponent(url);
  switch (type) {
    case "x":
      //https://developer.twitter.com/en/docs/twitter-for-websites/tweet-button/guides/web-intent
      return `https://x.com/intent/tweet?text=${encodedText}&url=${encodedURL}`;
    /**
     * feed description is depracated
     * https://developers.facebook.com/docs/sharing/reference/feed-dialog#response
     * NOTE 6/3/2024: must rely on OpenGraph metadata
     */
    case "fb":
      return `https://www.facebook.com/dialog/share?app_id=1286913222079194&display=popup&href=${encodedURL}&quote=${encodedText}`;

    //https://core.telegram.org/widgets/share#custom-buttons
    case "telegram":
      return `https://telegram.me/share/url?url=${encodedURL}&text=${encodedText}`;

    //Linkedin
    default:
      return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(`${rawText} ${url}`)}`;
  }
}
