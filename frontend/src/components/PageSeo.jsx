import React from 'react';
import { Helmet } from 'react-helmet-async';

const DEFAULT_SITE_NAME = 'GridLock';
const DEFAULT_DESCRIPTION = 'GridLock is a real-time multiplayer Dots & Boxes game where strategy and speed decide every match.';
const DEFAULT_OG_IMAGE = '/og-image.png';

function buildAbsoluteUrl(pathname) {
  const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
  return new URL(pathname, siteUrl).toString();
}

export default function PageSeo({
  title,
  description = DEFAULT_DESCRIPTION,
  pathname = window.location.pathname,
}) {
  const canonicalUrl = buildAbsoluteUrl(pathname);
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
      <title>{pageTitle}</title>
      <link rel="canonical" href={canonicalUrl} />
      <meta name="description" content={description} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={imageUrl} />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
      <script type="application/ld+json">{JSON.stringify(structuredData)}</script>
    </Helmet>
  );
}
