const rights = [
  {
    num: "01",
    title: "Financial self-sufficiency",
    body: "Grow durable reserves and access the tools of long-term stability, not perpetual dependence on the next grant cycle.",
  },
  {
    num: "02",
    title: "Equal opportunity",
    body: "Fair access to modern fundraising and finance, regardless of size, location, or cause.",
  },
  {
    num: "03",
    title: "Organizational autonomy",
    body: "Independence to allocate funds and reduce admin drag on your terms, with no lock-in, ever.",
  },
] as const;

interface IManifesto {
  classes?: string;
}

export function Manifesto({ classes = "" }: IManifesto) {
  return (
    <section className={classes} aria-labelledby="manifesto-heading">
      <div className="page">
        <p className="text-xs font-bold uppercase tracking-wider text-primary text-center">
          The Better Giving Manifesto
        </p>
        <h2
          id="manifesto-heading"
          className="section-heading mt-3 text-center max-w-2xl mx-auto"
        >
          Every nonprofit has three rights
        </h2>
        <div className="grid gap-5 md:grid-cols-3 mt-11">
          {rights.map((r) => (
            <div
              key={r.num}
              className="card shadow-lift-card grid gap-2.5 content-start"
            >
              <span className="text-3xl font-bold text-primary">{r.num}</span>
              <span className="text-xl font-bold">{r.title}</span>
              <p className="text-sm/relaxed text-gray-11">{r.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
