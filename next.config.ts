import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  // Release packages (scripts/package-release.ts) ship the self-contained server that
  // `standalone` produces; everyday `next build` / `next start` stays as it was.
  ...(process.env.SAZKARA_RELEASE === '1' ? { output: 'standalone' as const } : {}),
  // The release script type-checks in its own step first (tsc), so the build does not
  // hold the compiler and the bundler in memory at once — on a 6 GB laptop it can't.
  ...(process.env.SAZKARA_TYPECHECKED === '1' ? { typescript: { ignoreBuildErrors: true } } : {}),
  // exceljs and puppeteer-core are Node-only; keep them out of the bundler's reach.
  serverExternalPackages: ['exceljs', 'puppeteer-core', '@prisma/client', 'bcryptjs'],
  experimental: {
    // Photo + signature uploads arrive as multipart bodies on server actions/routes.
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
};

export default withNextIntl(nextConfig);
