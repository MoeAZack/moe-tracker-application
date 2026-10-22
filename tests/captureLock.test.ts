import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { captureHolder, holdCapture, releaseCapture } from '../src/utils/captureLock';

describe('one capture, one pipeline', () => {
  it('lets only one holder process a capture at a time', () => {
    expect(holdCapture('cap-1', 'review')).toBe(true);
    expect(holdCapture('cap-1', 'automatic')).toBe(false);
    expect(holdCapture('cap-1', 'review')).toBe(true);
    releaseCapture('cap-1', 'automatic');
    expect(captureHolder('cap-1')).toBe('review');
    releaseCapture('cap-1', 'review');
    expect(holdCapture('cap-1', 'automatic')).toBe(true);
    releaseCapture('cap-1', 'automatic');
    expect(captureHolder('cap-1')).toBeNull();
  });

  it('is used by both the background loop and the scrim import modal', () => {
    const loop = fs.readFileSync('src/components/DesktopReplayAutomation.tsx', 'utf8');
    expect(loop).toContain("captureHolder(item.id) !== 'review'");
    expect(loop).toContain("holdCapture(pending.id, 'automatic')");
    expect(loop).toContain("releaseCapture(heldCapture, 'automatic')");
    const modal = fs.readFileSync('src/components/ScrimImport.tsx', 'utf8');
    expect(modal).toContain("holdCapture(record.id, 'review')");
    expect(modal).toContain("releaseCapture(heldCapture.current, 'review')");
  });
});
