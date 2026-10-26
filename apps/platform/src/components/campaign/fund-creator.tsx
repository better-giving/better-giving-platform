import { href, Link } from "react-router";
import * as v from "valibot";

interface IFundCreator {
  classes?: string;
  name: string;
  id: string;
}

const email = v.pipe(v.string(), v.email());
const uuid = v.pipe(v.string(), v.uuid());
const idNum = v.pipe(
  v.string(),
  v.transform((x) => +x),
  v.number()
);

const idSchema = v.union([email, uuid, idNum]);

export function FundCreator(props: IFundCreator) {
  const id = v.parse(idSchema, props.id);

  if (typeof id === "string") {
    return <p className={props.classes}>{props.name}</p>;
  }

  return (
    <Link
      className={`${props.classes} link`}
      to={href("/org/:org", { org: props.id })}
    >
      {props.name}
    </Link>
  );
}
