import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CLOUD_AI_OFF_MESSAGE, cloudAiConfigured, cloudAiErrorMessage } from '../src/utils/cloudAi';
import ScrimImport from '../src/components/ScrimImport';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('cloud AI availability', () => {
  it('treats only an explicitly configured Gemini key as available', () => {
    expect(cloudAiConfigured({ gemini: { configured: true } })).toBe(true);
    expect(cloudAiConfigured({ gemini: { configured: false } })).toBe(false);
    expect(cloudAiConfigured({})).toBe(false);
    expect(cloudAiConfigured(null)).toBe(false);
  });

  it('explains a disabled cloud AI route instead of blaming the key setting', async () => {
    expect(await cloudAiErrorMessage(json(410, { error: 'Paid cloud AI is disabled.' }), 'fallback')).toBe(CLOUD_AI_OFF_MESSAGE);
    expect(await cloudAiErrorMessage(json(503, {}), 'fallback')).toBe(CLOUD_AI_OFF_MESSAGE);
  });

  it('passes the server reason through for other failures', async () => {
    expect(await cloudAiErrorMessage(json(500, { error: 'Gemini is not configured. Use the free local screenshot extractor.' }), 'fallback'))
      .toBe('Gemini is not configured. Use the free local screenshot extractor.');
    expect(await cloudAiErrorMessage(new Response('not json', { status: 500 }), 'fallback')).toBe('fallback');
  });
});

describe('scrim import wording', () => {
  it('says the manual screenshot reader is cloud AI and keeps it off until availability is known', () => {
    const data: any = { matches: [], playerStats: [], rounds: [], rosterPlayers: [], players: [], tryoutBatches: [], settings: {} };
    vi.stubGlobal('window', {});
    const html = renderToStaticMarkup(<ScrimImport data={data} theme={{ border: '', bg: '' } as any} onClose={vi.fn()} onSaveMatch={vi.fn() as any} />);
    vi.unstubAllGlobals();
    expect(html).not.toContain('reads captured screenshots locally on this PC');
    expect(html).toContain('sends the images you choose to Gemini, a cloud AI service');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Read selected screenshots with cloud AI/s);
  });
});
