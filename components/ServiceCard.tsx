import Image from "next/image";
import Link from "next/link";

export default function ServiceCard({
  href,
  title,
  description,
  image,
  imageAlt,
}: {
  href: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
}) {
  return (
    <Link
      href={href}
      className="group overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <Image
          src={image}
          alt={imageAlt}
          fill
          sizes="(min-width: 1024px) 280px, (min-width: 640px) 45vw, 100vw"
          className="object-cover transition duration-300 group-hover:scale-105"
        />
      </div>
      <div className="p-5">
        <h3 className="font-display text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{description}</p>
        <span className="mt-3 inline-block text-sm font-semibold text-accent-600 group-hover:text-accent-700">
          Learn more →
        </span>
      </div>
    </Link>
  );
}
