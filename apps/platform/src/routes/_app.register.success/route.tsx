import { CircleCheck } from "lucide-react";
import { href, Link, useSearchParams } from "react-router";

export default function Page() {
  const [params] = useSearchParams();
  const name = params.get("name") || "Your organization";
  const id = params.get("id");
  return (
    // not a page container: a 32rem success card in the auth funnel, whose
    // chrome is flush-wide. it centers at every width.
    <div className="grid mx-auto px-5 max-w-lg justify-items-center">
      <CircleCheck className="text-success pictogram-lg" />
      <h1 className="text-3xl mt-10 text-center">
        {name}’s account has been created!
      </h1>
      <Link
        className="mt-6 link underline decoration-1 text-center text-lg transition duration-slow"
        to={`${href("/admin/:id/organization", { id: id ?? "invalid id" })}#page`}
      >
        Start filling out {name}’s Better Giving page and attract donors! Thank
        you!
      </Link>
    </div>
  );
}
