import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScreenErrorBoundary from '../src/components/ScreenErrorBoundary';

function boundary(screen = 'VOD Submission') {
  const instance: any = new (ScreenErrorBoundary as any)({ screen, children: <p>screen body</p> });
  instance.setState = (update: any) => { instance.state = { ...instance.state, ...(typeof update === 'function' ? update(instance.state) : update) }; };
  return instance;
}

describe('screen error boundary', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('renders the screen untouched while nothing has failed', () => {
    expect(renderToStaticMarkup(<>{boundary().render()}</>)).toBe('<p>screen body</p>');
  });

  it('replaces only the failed screen with a named, recoverable notice', () => {
    const instance = boundary();
    instance.state = { ...instance.state, ...ScreenErrorBoundary.getDerivedStateFromError(new TypeError('listIngestionJobs is not a function')) };
    const html = renderToStaticMarkup(<>{instance.render()}</>);
    expect(html).toContain('role="alert"');
    expect(html).toContain('VOD Submission could not be shown');
    expect(html).toContain('every other screen still works');
    expect(html).toContain('listIngestionJobs is not a function');
    expect(html).not.toContain('screen body');
    instance.retry();
    expect(renderToStaticMarkup(<>{instance.render()}</>)).toBe('<p>screen body</p>');
  });

  it('keeps a non-Error throw readable', () => {
    expect(ScreenErrorBoundary.getDerivedStateFromError('boom').error?.message).toBe('boom');
    expect(ScreenErrorBoundary.getDerivedStateFromError(undefined).error?.message).toBe('Unknown error');
  });

  it('records the failure in the desktop crash log and shows its error code', async () => {
    const reportDiagnostic = vi.fn(async () => ({ code: 'MT-20261022-ABC123' }));
    vi.stubGlobal('window', { moeDesktop: { reportDiagnostic } });
    const instance = boundary('Settings');
    const error = new Error('secrets missing');
    instance.state = { ...instance.state, ...ScreenErrorBoundary.getDerivedStateFromError(error) };
    instance.componentDidCatch(error);
    await vi.waitFor(() => expect(instance.state.code).toBe('MT-20261022-ABC123'));
    expect(reportDiagnostic).toHaveBeenCalledWith({ action: 'screen-render:Settings', message: 'secrets missing' });
    expect(renderToStaticMarkup(<>{instance.render()}</>)).toContain('Error code: MT-20261022-ABC123');
  });
});
