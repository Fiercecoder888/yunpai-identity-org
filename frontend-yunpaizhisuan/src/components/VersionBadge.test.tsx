import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from '../tests/testUtils';
import { VersionBadge } from './VersionBadge';

describe('VersionBadge', () => {
  it('renders nothing when window.__YUNPAI_BUILD__ is absent', () => {
    delete window.__YUNPAI_BUILD__;

    const { container } = renderWithApp(<VersionBadge />);

    expect(container.querySelector('.version-badge')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders short commit, branch and build time from the global build info', () => {
    window.__YUNPAI_BUILD__ = {
      commit: 'abcdef0123456789',
      branch: 'dev_codex_frontend_adaptive_20260809',
      buildTime: '2026-08-09T00:00:00.000Z',
      dirty: false,
    };

    renderWithApp(<VersionBadge />);

    expect(screen.getByText(/abcdef0/)).toBeInTheDocument();
    expect(screen.getByText(/dev_codex_frontend_adaptive_20260809/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-09/)).toBeInTheDocument();
  });

  it('treats missing build info fields as "no badge" and does not crash', () => {
    window.__YUNPAI_BUILD__ = { commit: '', branch: 'main', buildTime: '' };

    const { container } = renderWithApp(<VersionBadge />);

    expect(container.querySelector('.version-badge')).toBeNull();
  });

  it('shows a dev @ commit badge from the injected meta tag in dev mode', () => {
    delete window.__YUNPAI_BUILD__;
    const meta = document.createElement('meta');
    meta.name = 'yunpai-build-commit';
    meta.content = 'abcdef0123456789';
    document.head.appendChild(meta);

    renderWithApp(<VersionBadge />);

    expect(screen.getByText('dev @ abcdef0')).toBeInTheDocument();
    meta.remove();
  });
});
