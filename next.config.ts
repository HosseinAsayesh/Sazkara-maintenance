import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
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
