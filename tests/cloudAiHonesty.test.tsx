import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const availability = vi.hoisted(() => ({ value: null as boolean | null }));
vi.mock('../src/utils/cloudAi', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/utils/cloudAi')>()),
  useCloudAiAvailable: () => availability.value,
}));

import { CLOUD_AI_OFF_MESSAGE, cloudAiActionBlocked, cloudAiConfigured, cloudAiErrorMessage } from '../src/utils/cloudAi';
import ScrimImport from '../src/components/ScrimImport';
import AITacticalHub from '../src/components/AITacticalHub';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const emptyData: any = { matches: [], playerStats: [], rounds: [], rosterPlayers: [], players: [], tryoutBatches: [], strats: [], settings: { maps: ['Ascent'], agents: [], lowSample: 15 } };
const theme: any = { border: '', bg: '', text: '', muted: '' };

afterEach(() => { availability.value = null; vi.unstubAllGlobals(); });

describe('cloud AI availability', () => {
  it('treats only an explicitly configured Gemini key as available', () => {
    expect(cloudAiConfigured({ gemini: { configured: true } })).toBe(true);
    expect(cloudAiConfigured({ gemini: { configured: false } })).toBe(false);
    expect(cloudAiConfigured({})).toBe(false);
    expect(cloudAiConfigured(null)).toBe(false);
  });

  it('blocks a cloud AI action while availability is unknown or off, even when its input is ready', () => {
    expect(cloudAiActionBlocked(null, false)).toBe(true);
    expect(cloudAiActionBlocked(false, false)).toBe(true);
    expect(cloudAiActionBlocked(true, false)).toBe(false);
    expect(cloudAiActionBlocked(true, true)).toBe(true);
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

describe('playbook generator gate', () => {
  const generateButton = () => {
    const html = renderToStaticMarkup(<AITacticalHub data={emptyData} theme={theme} onUpsert={vi.fn()} onRemove={vi.fn()} />);
    const button = html.match(/<button[^>]*>(?:(?!<\/button>).)*GENERATE TACTICAL SETUP/s)?.[0] || '';
    expect(button).not.toBe('');
    return { html, disabled: /^<button[^>]*\sdisabled=""/.test(button) };
  };

  it('stays disabled while cloud AI availability is unknown', () => {
    availability.value = null;
    expect(generateButton().disabled).toBe(true);
  });

  it('stays disabled and says why when cloud AI is off', () => {
    availability.value = false;
    const { html, disabled } = generateButton();
    expect(disabled).toBe(true);
    expect(html).toContain(CLOUD_AI_OFF_MESSAGE);
  });

  it('is enabled once a Gemini key is configured', () => {
    availability.value = true;
    const { html, disabled } = generateButton();
    expect(disabled).toBe(false);
    expect(html).not.toContain(CLOUD_AI_OFF_MESSAGE);
  });
});

describe('scrim import wording', () => {
  it('says the manual screenshot reader is cloud AI and explains when it is off', () => {
    vi.stubGlobal('window', {});
    availability.value = false;
    const html = renderToStaticMarkup(<ScrimImport data={emptyData} theme={theme} onClose={vi.fn()} onSaveMatch={vi.fn() as any} />);
    expect(html).not.toContain('reads captured screenshots locally on this PC');
    expect(html).toContain('sends the images you choose to Gemini, a cloud AI service');
    expect(html).toContain('Read selected screenshots with cloud AI');
    expect(html).toContain(CLOUD_AI_OFF_MESSAGE);
  });
});
