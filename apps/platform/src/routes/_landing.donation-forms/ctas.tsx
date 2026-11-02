import { motion } from "motion/react";
import { href, Link } from "react-router";
import { BOOK_A_DEMO, static_url } from "#/constants/urls";

const images = [
  static_url("donation-form-cta-1.webp"),
  static_url("donation-form-cta-2.webp"),
  static_url("donation-form-cta-3.webp"),
  static_url("donation-form-cta-4.webp"),
];

export function Ctas({ classes = "" }) {
  return (
    <section
      className={`${classes} grid gap-y-20 md:gap-y-32 py-14 md:py-28 overflow-x-clip`}
      aria-label="Key benefits"
    >
      <article className="grid md:grid-cols-2 gap-x-4 items-center">
        <motion.div
          className="grid max-md:order-2"
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ type: "spring" }}
        >
          <h3 className="text-2xl max-md:text-center md:text-3xl mb-2">
            More completed gifts.
          </h3>
          <p className="md:text-lg mb-4 max-md:text-center">
            Our conversion-optimized donation flow and best-in-class form ensure
            a simple process for your donors, resulting in more completed gifts
            and more recurring donors.
          </p>
          <div className="justify-self-center md:justify-self-start">
            <Link
              to={href("/register")}
              className="btn btn-lg btn-primary inline-flex items-center font-bold"
            >
              Join us today!
            </Link>
            <div className="md:ml-3 max-md:text-center mt-2">
              or,{" "}
              <Link
                target="_blank"
                to={BOOK_A_DEMO}
                className="text-sm indent-3 mt-2 underline link"
              >
                Get a demo
              </Link>
            </div>
          </div>
        </motion.div>
        <img
          src={images[0]}
          className="justify-self-center max-md:mb-4"
          width={400}
          alt="Screenshot of a donation form showing completed gift flow"
        />
      </article>
      <article className="grid md:grid-cols-2 gap-x-4 items-center">
        <img
          src={images[1]}
          className="justify-self-center max-md:mb-4"
          width={400}
          alt="Screenshot of donation form with multiple payment methods"
        />
        <motion.div
          className="grid"
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ type: "spring" }}
        >
          <h3 className="text-2xl md:text-3xl mb-2 max-md:text-center">
            Never miss a donation.
          </h3>
          <p className="md:text-lg mb-4 max-md:text-center">
            Accept card, bank, stock, crypto, and DAF gifts in one seamless flow
            with no extra tools or portals. Every option is included so you
            capture more, and larger, gifts automatically.
          </p>
          <div className="justify-self-center md:justify-self-start">
            <Link
              to={href("/register")}
              className="btn btn-lg btn-primary inline-flex items-center font-bold"
            >
              Join us today!
            </Link>
            <div className="md:ml-3 max-md:text-center mt-2">
              or,{" "}
              <Link
                target="_blank"
                to={BOOK_A_DEMO}
                className="text-sm indent-3 mt-2 underline link"
              >
                Get a demo
              </Link>
            </div>
          </div>
        </motion.div>
      </article>
      <article className="grid md:grid-cols-2 gap-x-4 items-center">
        <motion.div
          className="grid max-md:order-2"
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ type: "spring" }}
        >
          <h3 className="text-2xl max-md:text-center md:text-3xl mb-2">
            Make it yours.
          </h3>
          <p className="md:text-lg mb-4 max-md:text-center">
            Match your brand with custom colors, language, and easy website
            integration. Branded tax receipts and thank you messages are
            included automatically, building donor relationships and
            establishing trust.
          </p>
          <div className="justify-self-center md:justify-self-start">
            <Link
              to={href("/register")}
              className="btn btn-lg btn-primary inline-flex items-center font-bold"
            >
              Join us today!
            </Link>
            <div className="md:ml-3 max-md:text-center mt-2">
              or,{" "}
              <Link
                target="_blank"
                to={BOOK_A_DEMO}
                className="text-sm indent-3 mt-2 underline link"
              >
                Get a demo
              </Link>
            </div>
          </div>
        </motion.div>
        <img
          src={images[2]}
          className="justify-self-center max-md:mb-4"
          width={400}
          alt="Screenshot of a branded donation form with custom colors"
        />
      </article>
      <article className="grid md:grid-cols-2 gap-x-4 items-center">
        <img
          src={images[3]}
          className="justify-self-center max-md:mb-4"
          width={400}
          alt="Screenshot showing donation funds earning savings interest"
        />
        <motion.div
          className="grid"
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ type: "spring" }}
        >
          <h3 className="text-2xl md:text-3xl mb-2 max-md:text-center">
            Grow your impact.
          </h3>
          <p className="md:text-lg mb-4 max-md:text-center">
            Put your donations to work in FDIC-insured savings or the
            Sustainability Fund. Returns vary, and past performance isn't a
            guarantee.
          </p>
          <div className="justify-self-center md:justify-self-start">
            <Link
              to={href("/register")}
              className="btn btn-lg btn-primary inline-flex items-center font-bold"
            >
              Join us today!
            </Link>
            <div className="md:ml-3 max-md:text-center mt-2">
              or,{" "}
              <Link
                target="_blank"
                to={BOOK_A_DEMO}
                className="text-sm indent-3 mt-2 underline link"
              >
                Get a demo
              </Link>
            </div>
          </div>
        </motion.div>
      </article>
    </section>
  );
}
