import { Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import dapp_logo from "#/assets/images/bg-logo-503c.webp";

type Props = {
  classes?: string;
};

export function DappLogo({ classes = "" }: Props) {
  return (
    <Image
      className={classes}
      src={dapp_logo}
      alt="Better Giving"
      render={(img) => (
        <Link to={href("/")} title="Go to Home page">
          {img}
        </Link>
      )}
    />
  );
}
