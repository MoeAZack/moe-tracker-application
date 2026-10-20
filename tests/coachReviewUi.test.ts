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

  it('persists Review before focusing the match and keeps Evidence as the explicit navigation action', () => {
    const source = fs.readFileSync('src/components/CoachWorkflow.tsx', 'utf8');
    expect(source).toContain('const saved = await mutate(signal, "reviewing")');
    expect(source).toContain('if (saved && signal.matchIds[0]) onFocusMatch(signal.matchIds[0])');
    expect(source).toContain('onClick={() => onOpenMatch(signal.matchIds[0])}');
  });

  it('starts dense integrated intelligence minimized', () => {
    const source = fs.readFileSync('src/components/ReviewIntelligencePanels.tsx', 'utf8');
    expect(source).toContain('const [open, setOpen] = useState(false)');
    expect(source).toContain('fusion.players || []');
  });
});
