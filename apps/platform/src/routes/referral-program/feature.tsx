import {
  ArrowRight,
  DollarSignIcon,
  Handshake,
  SproutIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { href, Link } from "react-router";

interface IListItem {
  title: string;
  description: string;
  icon: ReactNode;
}

const items: IListItem[] = [
  {
    title: "Make an Impact",
    description:
      "Every nonprofit you refer can access free, powerful fundraising tools.",
    icon: <SproutIcon className="text-success pictogram-md" />,
  },
  {
    title: "Earn Effortlessly",
    description:
      "Share your unique link and earn whenever your nonprofits receive donations.",
    icon: <DollarSignIcon className="text-primary pictogram-md" />,
  },
  {
    title: "Be Part of a Movement",
    description:
      "Join a growing community of supporters, organizers, and changemakers.",
    icon: <Handshake className="text-warning pictogram-sm" />,
  },
];

export function Feature({ classes = "" }) {
  return (
    <section className={`${classes} py-10 xl:py-20 grid content-start`}>
      <h2 className="text-3xl md:text-4xl text-balance mb-6 text-center col-span-full">
        Why Share Better Giving?
      </h2>

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
        Become an Affiliate
        <ArrowRight className="icon-lg" />
      </Link>
    </section>
  );
}

function ListItem(props: IListItem) {
  return (
    <li className="grid lg:grid-rows-subgrid row-span-3 px-9 justify-items-center">
      {props.icon}
      <h3 className="mt-4 py-4 text-center font-medium  text-2xl border-b-[3px] border-primary mb-7 px-8">
        {props.title}
      </h3>
      <p className="text-center text-lg @6xl:text-xl">{props.description}</p>
    </li>
  );
}
