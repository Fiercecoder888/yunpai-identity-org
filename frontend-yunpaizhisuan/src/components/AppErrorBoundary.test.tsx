import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from '../tests/testUtils';
import { AppErrorBoundary } from './AppErrorBoundary';

const Boom = () => {
  throw new Error('渲染炸了');
};

describe('AppErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    renderWithApp(
      <AppErrorBoundary>
        <div>正常内容</div>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('正常内容')).toBeInTheDocument();
    expect(screen.queryByTestId('app-error-boundary')).not.toBeInTheDocument();
  });

  it('renders a Chinese fallback UI instead of a white screen when a child throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderWithApp(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );

    expect(screen.getByTestId('app-error-boundary')).toBeInTheDocument();
    expect(screen.getByText('页面渲染出错')).toBeInTheDocument();
    expect(screen.getByText('渲染炸了')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument();
    expect(screen.queryByText('正常内容')).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });

  it('invokes the optional report hook when a child throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();

    renderWithApp(
      <AppErrorBoundary onError={onError}>
        <Boom />
      </AppErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ componentStack: expect.any(String) }));

    errorSpy.mockRestore();
  });
});
