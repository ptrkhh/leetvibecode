import type { NextConfig } from 'next';

const config: NextConfig = {
  // Demo mode (no OPENROUTER_API_KEY) reads reference solutions at request time.
  outputFileTracingIncludes: { '/api/generate': ['./challenges/**/*.py'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
        ],
      },
    ];
  },
};

export default config;
