/** Everything inside `<body>` of the pre-publish page: the domain, one line on what is going on, the way in. */
export function PlaceholderPage({ host }: { host: string }) {
  return (
    <main className="flex min-h-svh flex-col justify-between gap-12 bg-linear-to-b from-sky to-[#4a6a8c] p-[clamp(20px,3.2vw,56px)] font-sans text-white antialiased">
      <p className="text-[13px] font-semibold tracking-[0.08em] uppercase">Not published yet</p>
      <div className="max-w-[40rem]">
        <h1 className="text-[clamp(2rem,7vw,4.5rem)] leading-none font-extrabold tracking-tight [overflow-wrap:anywhere]">
          {host}
        </h1>
        <p className="mt-5 text-lg text-pretty text-white/85">
          This domain is set up, but its page hasn't been published. If it's yours, pick a design and publish it from
          the admin.
        </p>
        <a
          href="/admin"
          className="mt-8 inline-flex min-h-13 items-center gap-3 rounded-full bg-white px-[26px] text-[15px] font-bold whitespace-nowrap text-ink transition-[background-color,scale] duration-150 ease-out hover:bg-[#eef3e6] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-white active:scale-[0.96]"
        >
          Open the admin
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 8h10m0 0-4-4m4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </div>
    </main>
  );
}
