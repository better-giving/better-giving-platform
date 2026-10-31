import { ExtLink, Modal } from "@better-giving/ui";
import { X } from "lucide-react";
import { useState } from "react";
import facebook from "#/assets/icons/social/facebook.webp";
import linkedin from "#/assets/icons/social/linkedin.webp";
import telegram from "#/assets/icons/social/telegram.webp";
import x from "#/assets/icons/social/x.webp";
import { is_fund } from "#/components/donation";
import { app_name } from "#/constants/env";

interface SocialMedia {
  id: "x" | "telegram" | "linkedin" | "fb";
  title: string;
  src: string;
  size: number;
  handle: string;
}

export const socials: SocialMedia[] = [
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

interface IRecipient {
  id: string;
  name: string;
}

interface IBase {
  recipient: IRecipient;
  donate_url: string;
  donate_thanks_url: string;
}

interface IShareBtn extends SocialMedia, IBase {}
export function ShareBtn(props: IShareBtn) {
  const [open, set_open] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={`Share on ${props.title}`}
        onClick={() => set_open(true)}
        className="relative size-10 grid place-items-center"
      >
        <img
          src={props.src}
          width={props.size}
          className="absolute-center"
          alt=""
        />
      </button>
      <Prompt {...props} open={open} set_open={set_open} />
    </>
  );
}

interface IPrompt extends IShareBtn {
  open: boolean;
  set_open: React.Dispatch<React.SetStateAction<boolean>>;
  recipient: IRecipient;
  donate_url: string;
  donate_thanks_url: string;
}

function Prompt({
  recipient,
  open,
  set_open,
  donate_thanks_url,
  donate_url,
  ...social
}: IPrompt) {
  //share_txt will always hold some values
  const [share_txt, set_share_txt] = useState("");

  return (
    <Modal
      open={open}
      onClose={() => set_open(false)}
      title={`Share on ${social.title}`}
      size="md"
      classes="grid content-start bg-card"
    >
      <div className="grid place-items-center relative h-16  font-bold bg-gray-3 border-b border-hairline">
        Share on {social.title}
        <button
          type="button"
          aria-label="Close"
          onClick={() => set_open(false)}
          className="absolute top-1/2 transform -translate-y-1/2 right-4 size-10 border rounded "
        >
          <X className="absolute-center icon-xl" />
        </button>
      </div>
      <p
        ref={(node) => {
          if (!node) return;
          set_share_txt(node.innerText);
        }}
        className="my-6 sm:my-10 mx-4 sm:mx-12 text-sm leading-normal p-3 bg-panel rounded"
      >
        I just donated to <span className="font-bold">{recipient.name}</span> on{" "}
        <span className="font-bold">@BetterDotGiving</span>!{" "}
        {is_fund(recipient.id)
          ? "My gift to this campaign helps raise funds for causes they love. Why don't you donate as well?"
          : "They can choose to use my gift today, or save and invest it for sustainable growth"}
        . When you give today, you give forever.
      </p>
      <ExtLink
        href={gen_share_link(
          share_txt,
          donate_url,
          donate_thanks_url,
          social.id
        )}
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

function gen_share_link(
  raw_txt: string,
  donate_url: string,
  donate_thanks_url: string,
  type: SocialMedia["id"]
) {
  switch (type) {
    case "x":
      //https://developer.twitter.com/en/docs/twitter-for-websites/tweet-button/guides/web-intent
      return `https://x.com/intent/tweet?text=${encodeURIComponent(`${raw_txt} ${donate_url}`)}`;
    /**
     * feed description is depracated
     * https://developers.facebook.com/docs/sharing/reference/feed-dialog#response
     * NOTE 6/3/2024: must rely on OpenGraph metadata
     */
    case "fb":
      return `https://www.facebook.com/dialog/share?app_id=1286913222079194&display=popup&href=${encodeURIComponent(donate_thanks_url)}&quote=${encodeURIComponent(raw_txt)}`;

    //https://core.telegram.org/widgets/share#custom-buttons
    case "telegram":
      return `https://telegram.me/share/url?url=${encodeURIComponent(donate_url)}&text=${encodeURIComponent(raw_txt)}`;

    //Linkedin
    default:
      return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(`${raw_txt} ${donate_url}`)}`;
  }
}
