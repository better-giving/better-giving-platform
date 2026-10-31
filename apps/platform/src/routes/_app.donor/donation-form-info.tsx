import { Image } from "@better-giving/ui";
import { Star } from "lucide-react";
import { StepsCarousel } from "#/components/donation";
import { benefits } from "#/content/benefits";

export function DonationFormInfo({ classes = "" }) {
  return (
    <section className={`${classes} grid @6xl:grid-cols-2 gap-x-16`}>
      <h4 className="mb-4 col-span-full text-lg text-primary uppercase text-center">
        Your all-in-one donation portal
      </h4>
      <h2 className="mb-16 col-span-full text-center text-4xl">
        Give the way you want, to the causes you care about most
      </h2>

      <StepsCarousel classes="w-full max-w-lg self-center justify-self-center" />

      <ul className="divide-y divide-hairline mt-6 @6xl:mt-0">
        {benefits.donorsOrder2.map((b, idx) => (
          <ListItem
            title={b.title}
            description={b.description}
            icon={b.listIcon}
            key={idx}
          />
        ))}
      </ul>
    </section>
  );
}

type TListItem = {
  title: string;
  description: string;
  icon?: { src: string; height?: number; width?: number };
};

function ListItem(props: TListItem) {
  return (
    <li className="grid grid-cols-[auto_1fr] gap-y-1 gap-x-4 py-6">
      {props.icon ? (
        <Image
          className="col-start-1 row-span-2 mt-1"
          src={props.icon.src}
          height={props.icon.height}
          width={props.icon.width}
        />
      ) : (
        <Star className="col-start-1 row-span-2 text-gray-11 mt-1 size-4.5 @6xl:size-5" />
      )}
      <h6 className="text-lg font-medium @6xl:text-xl">{props.title}</h6>
      <p className="text-lg @6xl:text-xl text-gray-11">{props.description}</p>
    </li>
  );
}
