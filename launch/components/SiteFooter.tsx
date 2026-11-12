// Mirrors authentyc.ai's footer (landing_page/components/landing/Footer.tsx):
// same layout, same company line, same links.
const LINK = 'text-gray-400 transition-colors duration-300 hover:text-brand-primary';

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 px-4 py-16">
      <div className="mx-auto max-w-6xl space-y-6 text-center">
        <p className="font-display text-3xl font-bold text-white">LeetVibeCode</p>
        <p className="text-lg text-gray-300">
          An{' '}
          <a href="https://authentyc.ai" className="text-brand-primary hover:underline">
            Authentyc
          </a>{' '}
          product.
        </p>

        <div className="flex justify-center space-x-8 pt-6">
          <a href="https://x.com/AuthentycAI" className={LINK}>
            Twitter
          </a>
          <a href="https://www.linkedin.com/company/authentyc" className={LINK}>
            LinkedIn
          </a>
          <a href="mailto:hello@authentyc.ai" className={LINK}>
            Email
          </a>
        </div>

        <div className="border-t border-white/10 pt-8 text-sm">
          <p className="text-gray-400">© 2026 Authentyc AI, Inc.</p>
          <div className="mt-3 flex justify-center space-x-6">
            <a href="https://authentyc.ai/privacy" className={LINK}>
              Privacy Policy
            </a>
            <span className="text-gray-700">•</span>
            <a href="https://authentyc.ai/terms" className={LINK}>
              Terms of Service
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
