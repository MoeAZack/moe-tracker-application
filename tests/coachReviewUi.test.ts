import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

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
});
