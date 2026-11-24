import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { describe, it, expect } from 'vitest';
import PageSeo from '../PageSeo';

const renderSeo = (props) =>
  render(
    <HelmetProvider>
      <PageSeo pathname="/x" {...props} />
    </HelmetProvider>,
  );

const robotsMeta = () => document.head.querySelector('meta[name="robots"]');

describe('PageSeo', () => {
  it('uses the deployment robots directive for public pages', async () => {
    renderSeo({ title: 'How to Play' });
    await waitFor(() => expect(document.title).toBe('How to Play | GridLock'));
    expect(robotsMeta().getAttribute('content')).toBe(import.meta.env.VITE_ROBOTS);
  });

  it('replaces the built tags with the mounted route metadata', async () => {
    const fallback = document.createElement('link');
    fallback.rel = 'canonical';
    fallback.href = 'https://gridlock.pro/';
    fallback.setAttribute('data-static-seo', '');
    document.head.append(fallback);

    renderSeo({ title: 'How to Play', pathname: '/how-to-play' });
    await waitFor(() => expect(document.title).toBe('How to Play | GridLock'));
    expect(fallback.isConnected).toBe(false);
    const links = document.head.querySelectorAll('link[rel="canonical"]');
    expect(links).toHaveLength(1);
    expect(new URL(links[0].href).pathname).toBe('/how-to-play/');
  });

  it('adds noindex, nofollow for private pages', async () => {
    renderSeo({ title: 'Settings', noindex: true });
    await waitFor(() => expect(robotsMeta()).not.toBeNull());
    expect(robotsMeta().getAttribute('content')).toBe('noindex, nofollow');
  });
});
