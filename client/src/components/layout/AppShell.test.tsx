import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders its children inside the shell', () => {
    render(
      <AppShell>
        <p>내용</p>
      </AppShell>
    );

    expect(screen.getByText('내용')).toBeInTheDocument();
  });
});
