import Image from "next/image";
import Link from "next/link";

export default function PageHero({
  eyebrow,
  title,
  description,
  image,
  imageAlt,
  primaryHref= "",
  primaryLabel = "Enroll Now",
  secondaryHref = "/prices",
  secondaryLabel = "See Prices",
}: {
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <section className="border-b border-slate-100 bg-gradient-to-b from-accent-50/60 to-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-2 md:py-20">
        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent-600">
            {eyebrow}
          </p>
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-600">
            {description}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href={primaryHref}
              className="rounded-full bg-accent-500 px-6 py-3 text-sm font-semibold text-accent-ink shadow-card transition hover:bg-accent-600"
            >
              {primaryLabel}
            </Link>
            <Link
              href={secondaryHref}
              className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-accent-300"
            >
              {secondaryLabel}
            </Link>
          </div>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-card">
          <Image
            src={image}
            alt={imageAlt}
            fill
            sizes="(min-width: 768px) 480px, 100vw"
            className="object-cover"
            priority
          />
        </div>
      </div>
    </section>
  );
}
