import { Image } from "@better-giving/ui";
import { Link } from "react-router";
import img3 from "#/assets/images/man-using-laptop.png";
import img4 from "./diamond-logo.png";
import img5 from "./laira-holding-folder.png";
import img1 from "./laptop.png";
import img2 from "./people-using-gadget.png";

interface ICard {
  id: string;
  title: string;
  img: {
    src: string;
    alt: string;
  };
  to: string;
}
const cards: ICard[] = [
  {
    id: "1",
    title: "Logo and Brand Assets",
    img: { src: img1, alt: "laptop" },
    to: "https://intercom.help/better-giving/en/articles/11549962-referral-resource-hub-logos-and-brand-assets",
  },
  {
    id: "2",
    title: "Social Media Templates",
    img: { src: img2, alt: "people using gadget" },
    to: "https://intercom.help/better-giving/en/articles/11549960-referral-resource-hub-social-media-guidance-and-templates",
  },
  {
    id: "3",
    title: "Email Templates",
    img: {
      src: img3,
      alt: "man using laptop",
    },
    to: "https://intercom.help/better-giving/en/articles/11549957-referral-resource-hub-emails",
  },
  {
    id: "4",
    title: "Resource Hub",
    img: { src: img4, alt: "diamond logo" },
    to: "https://intercom.help/better-giving/en/collections/13341032-referral-program-resource-hub",
  },
];

interface Props {
  classes?: string;
}
export const Hub = ({ classes = "" }: Props) => {
  return (
    <div className={classes}>
      <h3 className="text-2xl mb-2">Referral Hub</h3>
      <div className="card">
        <p className="mb-6">
          Your all-in-one resource for sharing Better Giving, equipping you to
          refer nonprofits, grow your network, and earn rewards smoothly.
        </p>
        {/* wraps rather than scrolls: five tiles are wider than a dashboard
            column, and a scroller hides the last one past the card's edge */}
        <div className="@container">
          <div className="grid grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-5 gap-x-8 gap-y-6">
            {cards.map((card) => (
              <div key={card.title} className="grid content-start gap-y-2">
                <Link target="_blank" to={card.to}>
                  <Image
                    src={card.img.src}
                    alt={card.img.alt}
                    width={200}
                    className="rounded w-full"
                  />
                </Link>

                <Link
                  target="_blank"
                  to={card.to}
                  className="link text-center font-semibold"
                >
                  {card.title}
                </Link>
              </div>
            ))}
            <Image
              src={img5}
              alt="laira holding folder"
              height={100}
              className="w-full h-36 object-contain"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
