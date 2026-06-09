"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Glow } from "./primitives/glow";
import { Parallax } from "./primitives/parallax";
import { Reveal } from "./primitives/reveal";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden px-6 py-44">
      <Glow className="left-1/2 top-1/2 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2" />

      {/* faint cube logo drifting behind the copy */}
      <Parallax speed={60} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Image
          src="/logo.png"
          alt=""
          aria-hidden
          width={420}
          height={420}
          className="opacity-[0.04] invert"
        />
      </Parallax>

      <Reveal className="relative z-10 mx-auto flex max-w-2xl flex-col items-center text-center">
        <h2 className="text-5xl font-semibold tracking-tight text-white md:text-6xl">
          Stop fighting the console.
        </h2>
        <p className="mt-5 text-lg text-[var(--landing-muted)]">
          Connect your first bucket in under a minute.
        </p>
        <div className="mt-10 flex items-center gap-4">
          <Link
            href="/sign-up"
            className="flex items-center gap-2 rounded-full bg-[var(--accent-amber)] px-7 py-3 font-semibold text-black transition-opacity hover:opacity-90"
          >
            Get started free
            <ArrowRight className="size-4" />
          </Link>
          <a
            href="#top"
            className="text-sm text-white/50 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            Watch the demo again
          </a>
        </div>
      </Reveal>
    </section>
  );
}
