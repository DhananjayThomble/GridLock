/**
 * generate-sitemap.mjs — Write dist/sitemap.xml for the public, indexable pages.
 *
 * Runs after `vite build` (see `build:seo`). Uses today's date as <lastmod> so
 * the field reflects the last deploy; Google ignores <changefreq>/<priority>,
 * so they are omitted. Private pages (settings, history, game rooms, profiles)
 * are noindex and intentionally absent.
 *
 * Site URL comes from VITE_SITE_URL (defaults to https://gridlock.pro).
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

// Keep in sync with ROUTES in scripts/prerender.mjs
const PUBLIC_ROUTES = ['/', '/how-to-play', '/leaderboard', '/daily'];

const siteUrl = (process.env.VITE_SITE_URL || 'https://gridlock.pro').replace(/\/+$/, '');
const lastmod = new Date().toISOString().slice(0, 10);

const urls = PUBLIC_ROUTES.map(
  (route) => `  <url>\n    <loc>${siteUrl}${route === '/' ? '/' : route}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`,
).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

mkdirSync(DIST_DIR, { recursive: true });
writeFileSync(join(DIST_DIR, 'sitemap.xml'), xml);
console.log(`Wrote dist/sitemap.xml (${PUBLIC_ROUTES.length} URLs, lastmod ${lastmod})`);
