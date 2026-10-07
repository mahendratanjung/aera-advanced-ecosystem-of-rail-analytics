/** Content page frame: a readable column with a large title. */
export function Page({ title, intro, children, wide = false, actions, eyebrow }: {
  title: string; intro?: React.ReactNode; children: React.ReactNode; wide?: boolean; actions?: React.ReactNode; eyebrow?: string;
}) {
  return (
    <main className={`enter mx-auto px-4 pb-16 pt-6 sm:px-6 lg:pt-10 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 lg:mb-8">
        <div className="max-w-2xl">
          {eyebrow && <p className="mb-1 text-sm font-semibold text-accent">{eyebrow}</p>}
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-ink sm:text-4xl">{title}</h1>
          {intro && <div className="mt-2 text-[15px] leading-relaxed text-ink-2">{intro}</div>}
        </div>
        {actions}
      </header>
      {children}
    </main>
  );
}

export function Section({ title, note, children, id, action }: { title: string; note?: React.ReactNode; children: React.ReactNode; id?: string; action?: React.ReactNode }) {
  return (
    <section className="mb-10" aria-labelledby={id}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={id} className="text-xl font-bold tracking-tight text-ink">{title}</h2>
          {note && <div className="mt-1 max-w-2xl text-sm text-ink-2">{note}</div>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
