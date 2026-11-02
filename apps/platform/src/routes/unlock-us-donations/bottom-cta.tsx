import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { href, Link } from "react-router";

export function BottomCta() {
  return (
    <section className="bg-band border-t border-hairline py-20 md:py-24 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--primary) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="page relative">
        <motion.div
          className="max-w-2xl mx-auto text-center grid justify-items-center gap-6"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: 0.4 }}
        >
          <h2 className="section-heading font-bold">
            Ready to expand your reach?
          </h2>
          <p className="section-body text-gray-11">
            It costs nothing to explore. Sign up today and add a global revenue
            stream to your local mission.
          </p>

          <Link
            to={href("/register")}
            className="btn btn-lg btn-primary capitalize inline-flex items-center gap-2 mt-2"
          >
            Join Us Today!
            <ArrowRight className="icon-lg" />
          </Link>

          <p className="text-sm text-gray-11">
            Free to sign up. No interference with your existing UK Gift Aid or
            fundraising.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
