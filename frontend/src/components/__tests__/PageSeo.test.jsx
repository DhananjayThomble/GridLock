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
  it('does not add a robots meta tag for indexable pages', async () => {
    renderSeo({ title: 'How to Play' });
    await waitFor(() => expect(document.title).toBe('How to Play | GridLock'));
    expect(robotsMeta()).toBeNull();
  });

  it('adds noindex, nofollow for private pages', async () => {
    renderSeo({ title: 'Settings', noindex: true });
    await waitFor(() => expect(robotsMeta()).not.toBeNull());
    expect(robotsMeta().getAttribute('content')).toBe('noindex, nofollow');
  });
});
