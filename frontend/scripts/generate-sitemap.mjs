/**
 * generate-sitemap.mjs — Write dist/sitemap.xml for the public, indexable pages.
 *
 * Runs after `vite build` (see `build:seo`). Only public pages belong in
 * the sitemap. Deploy timestamps do not describe changes to page content.
 *
 * Site URL comes from VITE_SITE_URL (defaults to https://gridlock.pro).
 */

import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

// Keep in sync with ROUTES in scripts/prerender.mjs
const PUBLIC_ROUTES = ['/', '/how-to-play', '/leaderboard', '/daily', '/challenge', '/privacy'];

const siteUrl = (process.env.VITE_SITE_URL || 'https://gridlock.pro').replace(/\/+$/, '');
if (process.env.VITE_ROBOTS?.split(',').some((rule) => rule.trim() === 'noindex')) {
  rmSync(join(DIST_DIR, 'sitemap.xml'), { force: true });
  writeFileSync(join(DIST_DIR, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  process.exit(0);
}

const urls = PUBLIC_ROUTES.map(
  (route) => `  <url>\n    <loc>${siteUrl}${route === '/' ? route : `${route}/`}</loc>\n  </url>`,
).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

mkdirSync(DIST_DIR, { recursive: true });
writeFileSync(join(DIST_DIR, 'sitemap.xml'), xml);
console.log(`Wrote dist/sitemap.xml (${PUBLIC_ROUTES.length} URLs)`);
