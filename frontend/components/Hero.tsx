"use client";

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4";

const REPO_URL = "https://github.com/Aditya-20121/persona-debate";

export default function Hero({ onBegin }: { onBegin: () => void }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Falls back to the navy body background if the video fails to load */}
      <video
        autoPlay
        loop
        muted
        playsInline
        src={VIDEO_SRC}
        className="absolute inset-0 w-full h-full object-cover z-0"
      />

      <nav className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <span className="font-display text-3xl tracking-tight text-white">
          Debate Arena
        </span>

        <div className="hidden md:flex items-center gap-8">
          <span className="text-sm text-white">Arena</span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted hover:text-white transition-colors"
          >
            GitHub
          </a>
        </div>

        <button
          onClick={onBegin}
          className="liquid-glass rounded-full px-6 py-2.5 text-sm text-white hover:scale-[1.03] transition-transform"
        >
          Begin Debate
        </button>
      </nav>

      <section className="relative z-10 flex flex-col items-center justify-center text-center px-6 pt-32 pb-40 py-[90px]">
        <h1 className="animate-fade-rise font-display text-5xl sm:text-7xl md:text-8xl leading-[0.95] tracking-[-2.46px] max-w-7xl font-normal text-white">
          Where <em className="not-italic text-muted">history&rsquo;s</em>{" "}
          greatest minds{" "}
          <em className="not-italic text-muted">meet again.</em>
        </h1>

        <p className="animate-fade-rise-delay text-muted text-base sm:text-lg max-w-2xl mt-8 leading-relaxed">
          Gandhi, Mandela, and Marx — resurrected as AI debaters, arguing in
          their own voice, grounded in their real writings through hybrid
          retrieval-augmented generation.
        </p>

        <button
          onClick={onBegin}
          className="animate-fade-rise-delay-2 liquid-glass rounded-full px-14 py-5 text-base text-white mt-12 hover:scale-[1.03] transition-transform cursor-pointer"
        >
          Begin Debate
        </button>
      </section>
    </div>
  );
}
