import fs from 'fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(file, 'utf8');

// These providers answer 503 by design. The UI must not offer them as if they worked.
describe('disabled integrations are not offered in the UI', () => {
  it('has no GRID or VLR match importer in the match log', () => {
    const source = read('src/components/MatchLogRounds.tsx');
    expect(source).not.toContain('/api/import-grid-match');
    expect(source).not.toContain('/api/import-vlr-match');
    expect(source).not.toContain('API MATCH IMPORTER');
  });

  it('has no Solo Q sync call and names the roster tab plainly', () => {
    const app = read('src/App.tsx');
    expect(app).not.toContain('/api/sync-soloq');
    expect(app).not.toContain('Roster & Solo Q');
    expect(app).toContain("{ id: 'roster', label: 'Roster',");
    expect(read('src/components/PlayerSoloTracker.tsx')).not.toContain('onSyncSoloQ');
  });

  it('drops the VLR fields and the Apps Script suite from Settings but keeps stored VLR settings', () => {
    const settings = read('src/components/SettingsControl.tsx');
    expect(settings).not.toContain('VLR.gg Team Name');
    expect(settings).not.toContain('Google Apps Script');
    expect(settings).toContain('vlr: data.settings.vlr,');
  });

  it('serves no hard-coded calendar list', () => {
    expect(read('lib/routes/integrations.ts')).not.toContain('/api/list-calendars');
  });
});
