import type { LucideProps } from "lucide-react";
import { DollarSign, HeartHandshake, Settings, Zap } from "lucide-react";
import { motion } from "motion/react";
import type { ComponentType } from "react";

interface ICard {
  icon: ComponentType<LucideProps>;
  title: string;
  body: string;
}

const cards: ICard[] = [
  {
    icon: DollarSign,
    title: "Cost",
    body: "A fraction of the price of international operations.",
  },
  {
    icon: Zap,
    title: "Speed",
    body: "Start accepting global donations this week, not next year.",
  },
  {
    icon: Settings,
    title: "Simplicity",
    body: "We handle the US IRS compliance; you handle the community impact.",
  },
  {
    icon: HeartHandshake,
    title: "Support",
    body: "Access our resource folder to help you 'tell your network' effectively.",
  },
];

export function WhyBg() {
  return (
    <section className="surface-primary py-20 md:py-24 relative overflow-hidden">
      <div className="absolute -bottom-24 -left-24 size-80 bg-primary-fg/3 rounded-full" />

      <div className="page relative">
        <motion.h2
          className="section-heading font-bold text-center mb-14"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: 0.4 }}
        >
          Why Better Giving?
        </motion.h2>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {cards.map((card, i) => (
            <motion.div
              key={card.title}
              className="bg-primary-fg/10 backdrop-blur-sm border border-primary-fg/20 rounded-card p-6 grid content-start gap-3"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.1 }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <div className="size-12 rounded bg-primary-fg/15 flex-center">
                <card.icon className="icon-2xl" />
              </div>
              <h3 className="text-xl font-bold">{card.title}</h3>
              <p className="text-primary-fg/80">{card.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
