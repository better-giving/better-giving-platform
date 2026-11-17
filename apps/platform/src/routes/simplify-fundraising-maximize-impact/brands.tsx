import { brands } from "#/content/brands";

export function Brands({ classes = "" }) {
  return (
    <section className={`${classes} grid`}>
      <h2 className="text-center text-3xl/tight md:text-4.5xl/tight text-pretty mb-16 px-4 capitalize">
        More than $7 million raised <br /> through Better Giving since 2021
      </h2>
      <div className="flex items-center flex-wrap justify-center gap-4 page">
        {brands.map((b, idx) => (
          <img
            key={idx}
            src={b}
            width={140}
            className="object-contain mx-6 hover:scale-110"
            alt="organization logo"
          />
        ))}
      </div>
    </section>
  );
}
