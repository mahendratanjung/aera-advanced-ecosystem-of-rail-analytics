import { MapTrifold } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="enter mx-auto flex min-h-[70dvh] max-w-xl flex-col items-start justify-center px-6 py-16">
      <p className="num text-[13px] font-bold uppercase tracking-[0.08em] text-accent">Error 404</p>
      <h1 className="mt-2 text-[32px] font-extrabold leading-tight tracking-tight text-ink sm:text-[40px]">Page not found</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-ink-2">The page you are looking for does not exist or has moved.</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link href="/" className="pressable inline-flex h-12 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-bold text-white hover:brightness-110">
          <MapTrifold size={18} weight="fill" aria-hidden />Go to the live map
        </Link>
      </div>
    </main>
  );
}
