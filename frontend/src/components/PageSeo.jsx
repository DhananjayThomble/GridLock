import React, { useLayoutEffect } from 'react';
import { Helmet } from 'react-helmet-async';

const DEFAULT_SITE_NAME = 'GridLock';
const DEFAULT_DESCRIPTION = 'Play Dots & Boxes online for free. Challenge up to three friends, practice against the CPU, or try the daily puzzle in your browser.';
const DEFAULT_OG_IMAGE = '/og-image-v2.jpg';

function buildAbsoluteUrl(pathname) {
  const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
  return new URL(pathname, siteUrl).toString();
}

export default function PageSeo({
  title,
  description = DEFAULT_DESCRIPTION,
  pathname = window.location.pathname,
  noindex = false,
}) {
  useLayoutEffect(() => {
    // Keep the built metadata in place until this route's tags have mounted.
    document.querySelectorAll('[data-static-seo]').forEach((tag) => tag.remove());
  }, []);

  const canonicalUrl = buildAbsoluteUrl(pathname.replace(/\/+$/, '') + '/');
  const imageUrl = buildAbsoluteUrl(DEFAULT_OG_IMAGE);
  const pageTitle = title ? `${title} | ${DEFAULT_SITE_NAME}` : DEFAULT_SITE_NAME;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: pageTitle,
    description,
    url: canonicalUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: DEFAULT_SITE_NAME,
      url: buildAbsoluteUrl('/'),
    },
  };

  return (
    <Helmet>
      <title data-route-seo="">{pageTitle}</title>
      <link data-route-seo="" rel="canonical" href={canonicalUrl} />
      <meta data-route-seo="" name="description" content={description} />
      <meta data-route-seo="" name="robots" content={noindex ? 'noindex, nofollow' : import.meta.env.VITE_ROBOTS} />
      <meta data-route-seo="" property="og:title" content={pageTitle} />
      <meta data-route-seo="" property="og:description" content={description} />
      <meta data-route-seo="" property="og:url" content={canonicalUrl} />
      <meta data-route-seo="" property="og:image" content={imageUrl} />
      <meta data-route-seo="" name="twitter:card" content="summary_large_image" />
      <meta data-route-seo="" name="twitter:title" content={pageTitle} />
      <meta data-route-seo="" name="twitter:description" content={description} />
      <meta data-route-seo="" name="twitter:image" content={imageUrl} />
      <script data-route-seo="" type="application/ld+json">{JSON.stringify(structuredData)}</script>
    </Helmet>
  );
}
