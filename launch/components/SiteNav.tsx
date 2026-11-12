import Link from 'next/link';

// The same bar sits on authentyc.ai: company mark on the left, then the
// product. Keep the two in step when either changes.
export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-dark-950/80 backdrop-blur-xl">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-2 font-display text-base font-bold sm:gap-3 sm:text-lg">
          <a href="https://authentyc.ai" className="text-gray-400 transition-colors hover:text-white">
            Authentyc
          </a>
          <span aria-hidden="true" className="text-gray-600">
            /
          </span>
          <Link href="/" className="truncate text-white">
            LeetVibeCode
          </Link>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <Link href="/#challenges" className="hidden text-gray-300 transition-colors hover:text-white sm:block">
            Challenges
          </Link>
          <Link href="/#scoring" className="hidden text-gray-300 transition-colors hover:text-white sm:block">
            Scoring
          </Link>
          <Link
            href="/#waitlist"
            className="whitespace-nowrap rounded-lg border border-brand-primary/40 px-3 py-2 font-semibold sm:px-4 text-brand-primary transition-colors hover:bg-brand-primary/10"
          >
            Join waitlist
          </Link>
        </div>
      </nav>
    </header>
  );
}
