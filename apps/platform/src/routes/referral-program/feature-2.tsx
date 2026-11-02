import { Image } from "@better-giving/ui";
import { ArrowRight } from "lucide-react";
import { href, Link } from "react-router";
import laira_heart from "#/assets/laira/laira-heart.webp";
import laira_laptop from "#/assets/laira/laira-laptop.webp";
import laira_shake_hands from "#/assets/laira/laira-shaking-hands.webp";

type TListItem = {
  title1: string;
  title2: string;
  description: string;
  image: { src: string; width?: number; height?: number; alt: string };
};
export const items: TListItem[] = [
  {
    title1: "Step 1",
    title2: "Get Your Unique Link",
    description:
      "Sign up for a free Better Giving account and access your referral link.",
    image: { src: laira_laptop, width: 50, alt: "Laira negotiating" },
  },
  {
    title1: "Step 2",
    title2: "Share with Your Network",
    description:
      "Send your link to nonprofits, consultants, or anyone who could benefit.",
    image: { src: laira_heart, width: 60, alt: "Laira using laptop" },
  },
  {
    title1: "Step 3",
    title2: "Earn Rewards",
    description:
      "Earn through Better Giving whenever your referred nonprofits succeed their donations stay 100% theirs.",
    image: { src: laira_shake_hands, width: 90, alt: "Laira presenting" },
  },
];

export function Feature2({ classes = "" }) {
  return (
    <section className={`${classes} py-10 xl:py-32 grid content-start`}>
      <h2 className="text-3xl md:text-4xl text-balance mb-6 text-center col-span-full">
        How It Works - Simple Steps
      </h2>

      <p className="text-center max-lg:px-10 max-lg:text-center mb-2 text-xl col-span-full">
        Our referral program makes it easy to share Better Giving while earning
        rewards.
      </p>

      <ul className="col-span-full mt-4 lg:divide-x divide-hairline grid gap-y-20 lg:gap-y-0 lg:grid-cols-3">
        {items.map((item, idx) => (
          <ListItem {...item} key={idx} />
        ))}
      </ul>
      <Link
        to={{
          pathname: href("/signup"),
          search: `?redirect=${href("/dashboard/referrals")}`,
        }}
        className="btn btn-lg btn-primary mt-8 justify-self-center col-span-full ml-1 font-bold inline-flex items-center gap-1"
      >
        Get Your Link Now
        <ArrowRight className="icon-lg" />
      </Link>
    </section>
  );
}

export function ListItem(props: TListItem) {
  return (
    <li className="grid lg:grid-rows-subgrid row-span-4 px-9 justify-items-center">
      <Image
        src={props.image.src}
        height={props.image.height}
        width={props.image.width}
        alt={props.image.alt}
        className="mb-4"
      />
      <h4 className="text-center  font-medium text-2xl px-8">{props.title1}</h4>
      <h5 className="py-4 text-center font-medium  text-lg @6xl:text-xl border-b-[3px] border-primary mb-7 px-8">
        {props.title2}
      </h5>
      <p className="text-center text-lg @6xl:text-xl">{props.description}</p>
    </li>
  );
}
