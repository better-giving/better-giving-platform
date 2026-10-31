import type { LucideProps } from "lucide-react";
import { Bitcoin, Building2, Landmark } from "lucide-react";
import { motion } from "motion/react";
import type { ComponentType } from "react";

interface IPillar {
  icon: ComponentType<LucideProps>;
  title: string;
  body: string;
}

const pillars: IPillar[] = [
  {
    icon: Landmark,
    title: "US Foundation Grants",
    body: "Access grants from US foundations that require 501(c)(3) status to give.",
  },
  {
    icon: Building2,
    title: "Donor Advised Funds (DAF)",
    body: "Tap into the $38 Billion held in DAFs by tech entrepreneurs and expats.",
  },
  {
    icon: Bitcoin,
    title: "Global Crypto Giving",
    body: "Accept digital currency with lower fees than traditional UK processors.",
  },
];

export function Pillars() {
  return (
    <section className="surface-primary py-20 md:py-24 relative overflow-hidden">
      {/* subtle diagonal accent */}
      <div className="absolute -top-32 -right-32 size-96 bg-primary-fg/3 rotate-45 rounded" />

      <div className="page relative">
        <motion.div
          className="text-center mb-14 grid gap-4"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: 0.4 }}
        >
          <h2 className="section-heading font-bold">
            Three Pillars of Opportunity
          </h2>
          <p className="section-body text-primary-fg/80 max-w-2xl mx-auto">
            Unlock revenue streams that were previously out of reach for UK
            charities.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {pillars.map((pillar, i) => (
            <motion.div
              key={pillar.title}
              className="bg-primary-fg/10 backdrop-blur-sm border border-primary-fg/20 rounded-card p-6 grid content-start gap-3"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.1 }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <div className="size-12 rounded bg-primary-fg/15 flex-center">
                <pillar.icon className="icon-2xl" />
              </div>
              <h3 className="text-xl font-bold">{pillar.title}</h3>
              <p className="text-primary-fg/80">{pillar.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
