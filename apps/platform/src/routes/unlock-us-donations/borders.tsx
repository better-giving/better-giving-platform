import type { LucideProps } from "lucide-react";
import { ArrowLeftRight, Lightbulb, TrendingDown } from "lucide-react";
import { motion } from "motion/react";
import type { ComponentType } from "react";

interface ICard {
  icon: ComponentType<LucideProps>;
  title: string;
  body: string;
}

const cards: ICard[] = [
  {
    icon: TrendingDown,
    title: "The Reality",
    body: "UK charities are facing unprecedented cuts. Meanwhile, American philanthropy is at an all-time high.",
  },
  {
    icon: ArrowLeftRight,
    title: "The Bridge",
    body: "Better Giving acts as your US fiscal sponsor. You keep your local identity; we provide the 501(c)(3) status required to unlock international donations.",
  },
  {
    icon: Lightbulb,
    title: "The Logic",
    body: "It runs parallel to your current fundraising. No disruption. No risk. No overhead.",
  },
];

export function Borders() {
  return (
    <section className="bg-band py-20 md:py-24">
      <div className="page">
        <motion.h2
          className="section-heading font-bold text-center mb-14"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: 0.4 }}
        >
          Funding Has No Borders
        </motion.h2>

        <div className="grid md:grid-cols-3 gap-6">
          {cards.map((card, i) => (
            <motion.div
              key={card.title}
              className="card grid content-start gap-3"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.1 }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <div className="size-12 rounded bg-secondary flex-center text-primary">
                <card.icon className="icon-2xl" />
              </div>
              <h3 className="text-xl font-bold">{card.title}</h3>
              <p className="text-gray-11">{card.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
