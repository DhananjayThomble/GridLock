// src/components/__tests__/HowToPlay.test.jsx
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import HowToPlay from '../HowToPlay';

const renderPage = () => render(<MemoryRouter><HowToPlay /></MemoryRouter>);

describe('HowToPlay (#590: R-01 / R-02)', () => {
  it('keeps each rule as one body so bold, plain and emphasised text flow together', () => {
    const { container } = renderPage();
    const items = container.querySelectorAll('.htp-rules-list > li');
    expect(items.length).toBe(4);
    items.forEach((li) => {
      // exactly one flex child (the body), not one per inline fragment
      expect(li.children).toHaveLength(1);
      expect(li.firstElementChild).toHaveClass('htp-rule-body');
    });
    expect(items[1].querySelector('.htp-rule-body')).toHaveTextContent('you earn a point and get an extra turn.');
  });

  it('renders the table of contents', () => {
    const { container } = renderPage();
    expect(container.querySelector('nav.htp-toc')).toBeInTheDocument();
  });
});
