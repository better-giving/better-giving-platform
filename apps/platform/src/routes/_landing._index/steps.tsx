import { Image } from "@better-giving/ui";
import laira1 from "#/assets/laira/laira1.webp";
import laira2 from "#/assets/laira/laira2.webp";
import laira3 from "#/assets/laira/laira3.webp";

const steps = [
  {
    img: laira1,
    alt: "Laira holding the number 1",
    step: "Step 1",
    title: "Sign up",
    body: "Register online. No platform fee while the optional donor contribution stays on. Turning that ask off is a 1.5% fee.",
  },
  {
    img: laira2,
    alt: "Laira holding the number 2",
    step: "Step 2",
    title: "Add the donation form",
    body: "Brand it and embed it on your site. Fewer clicks and express checkout mean more completed gifts and monthly donors.",
  },
  {
    img: laira3,
    alt: "Laira holding the number 3",
    step: "Step 3",
    title: "Grow",
    body: "Grants are paid out every 3 days once your balance reaches your payout minimum. You can also route a share into savings and the Sustainability Fund.",
  },
] as const;

interface ISteps {
  classes?: string;
}

export function Steps({ classes = "" }: ISteps) {
  return (
    <section className={classes} aria-labelledby="steps-heading">
      <div className="page">
        <h2 id="steps-heading" className="section-heading text-center">
          Easy as 1-2-3
        </h2>
        <div className="grid gap-8 md:grid-cols-3 mt-14">
          {steps.map((s) => (
            <div
              key={s.step}
              className="grid gap-3 justify-items-center text-center content-start"
            >
              <Image src={s.img} className="h-35 w-auto" alt={s.alt} />
              <span className="text-sm font-bold text-primary">{s.step}</span>
              <span className="text-2xl font-bold">{s.title}</span>
              <p className="text-sm/relaxed text-gray-11 max-w-72">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
