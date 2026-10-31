import { Link } from "react-router";
import { static_url } from "#/constants/urls";

interface FormEmbed {
  src: string;
  to: string;
}

const form_embeds: FormEmbed[] = [
  {
    src: static_url("form-embed-1.webp"),
    to: "https://www.globalbrigades.org/donate/",
  },
  {
    src: static_url("form-embed-2.webp"),
    to: "https://foodbank.co/#foodbank-donate",
  },
  {
    src: static_url("form-embed-4.webp"),
    to: "https://www.acesangels.org/donations",
  },
];
export function Members({ classes = "" }) {
  return (
    <div className={`${classes} grid content-start py-24`}>
      <h2 className="col-span-full text-center section-heading mb-16">
        All-In-One Donation Form in Action
      </h2>
      <ul className="grid gap-y-20 gap-x-16 lg:gap-y-0 lg:grid-cols-3 justify-self-center">
        {form_embeds.map((item, idx) => (
          <Link to={item.to} key={idx} target="_blank">
            <img
              width={300}
              className="object-contain"
              src={item.src}
              key={idx}
              alt="Screenshot of a Better Giving donation form embedded on a member's website"
            />
          </Link>
        ))}
      </ul>
    </div>
  );
}
