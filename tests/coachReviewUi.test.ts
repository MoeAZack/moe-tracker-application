import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FusionConflictLedger } from '../src/components/ReviewIntelligencePanels';
import { fusionFieldLabel, fusionValueLabel } from '../lib/evidenceFusion';

describe('coach review inbox actions', () => {
  it('dismisses immediately with an auditable default reason', () => {
    const source = fs.readFileSync('src/components/CoachWorkflow.tsx', 'utf8');
    const start = source.indexOf('const mutateSignal');
    const end = source.indexOf('const deleteSignal', start);
    const mutation = source.slice(start, end);
    expect(mutation).toContain('Dismissed by coach from Review Inbox.');
    expect(mutation).not.toContain('window.prompt');
    expect(mutation).toContain('JSON.stringify({ status, reason })');
  });

  it('starts dense integrated intelligence minimized', () => {
    const source = fs.readFileSync('src/components/ReviewIntelligencePanels.tsx', 'utf8');
    expect(source).toContain('const [open, setOpen] = useState(false)');
    expect(source).toContain('fusion.players || []');
  });
});

describe('evidence fusion conflict ledger', () => {
  const conflicts = [
    { entityId: 'r4', label: 'Round 4', fact: { field: 'advantageStates', value: [{ label: '5v5' }, { label: '5v4' }], source: 'replay', resolved: false, candidates: [{ source: 'replay', value: [{ label: '5v5', oursAlive: 5, theirsAlive: 5 }, { label: '5v4', oursAlive: 5, theirsAlive: 4 }] }, { source: 'screenshot', value: [{ label: '5v5', oursAlive: 5, theirsAlive: 5 }, { label: '4v5', oursAlive: 4, theirsAlive: 5 }] }] } },
    { entityId: 'r4', label: 'Round 4', fact: { field: 'firstKillBy', value: 'Alpha', source: 'manual', resolved: true, candidates: [{ source: 'manual', value: 'Alpha' }, { source: 'vod', value: 'Bravo' }] } },
    { entityId: 'p1', label: 'Alpha', fact: { field: 'clutchDetail', value: { won: 1 }, source: 'replay', resolved: false, candidates: [{ source: 'replay', value: { won: 1, attempts: 2 } }, { source: 'manual', value: null }] } },
  ];
  it('names fields, sources and values in plain language and never prints raw JSON', () => {
    const html = renderToStaticMarkup(React.createElement(FusionConflictLedger, { conflicts, onResolve: async () => {} }));
    expect(html).toContain('Round 4 · Man-advantage sequence');
    expect(html).toContain('Replay: 5v5 → 5v4'); expect(html).toContain('Screenshot: 5v5 → 4v5');
    expect(html).toContain('Round 4 · First kill · resolved'); expect(html).toContain('Manual log: Alpha'); expect(html).toContain('VOD: Bravo');
    expect(html).toContain('Alpha · Clutch detail'); expect(html).toContain('Replay: Structured value (kept in the audit record)'); expect(html).toContain('Manual log: Unknown');
    expect(html).not.toMatch(/[{[]\s*&quot;|oursAlive|advantageStates|firstKillBy/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Manual log: Alpha/);
  });
  it('renders nothing when there are no conflicts', () => {
    expect(renderToStaticMarkup(React.createElement(FusionConflictLedger, { conflicts: [], onResolve: async () => {} }))).toBe('');
  });
  it('summarises long sequences and numbers', () => {
    expect(fusionValueLabel(Array.from({ length: 12 }, (_, i) => ({ label: `${5 - (i % 3)}v${5 - (i % 2)}` })))).toMatch(/^12 states, ending /);
    expect(fusionValueLabel(12.3456)).toBe('12.35'); expect(fusionValueLabel([1, 2])).toBe('2 entries'); expect(fusionValueLabel(true)).toBe('Yes');
    expect(fusionFieldLabel('kastSuccessful')).toBe('KAST rounds'); expect(fusionFieldLabel('someNewField')).toBe('Some new field');
  });
});
