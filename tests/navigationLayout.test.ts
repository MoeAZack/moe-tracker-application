import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace navigation layout', () => {
  it('groups the main workspace into home, matches, team, players, coaching, playbook and settings', () => {
    const app = fs.readFileSync('src/App.tsx', 'utf8');
    const order = "['Home', 'Matches', 'Team', 'Players', 'Coaching', 'Playbook', 'Settings']";
    expect(app).toContain(order);
    expect(app).toContain("{ id: 'calendar', label: 'Schedule & Goals', icon: Calendar, group: 'Coaching' }");
    expect(app).toContain("{ id: 'aitactical', label: 'Coach Workspace', icon: Sparkles, group: 'Coaching' }");
    expect(app).toContain("{ id: 'matches', label: 'Match Review', icon: Swords, group: 'Matches' }");
    expect(app).toContain("{ id: 'replays', label: 'Replay Evidence', icon: FileCheck2, group: 'Matches' }");
    expect(app).toContain("{ id: 'economy', label: 'Economy', icon: Coins, group: 'Team' }");
    expect(app).toContain("{ id: 'settings', label: 'Settings', icon: SettingsIcon, group: 'Settings' }");
    expect(app).toContain("{ id: 'comps', label: 'Compositions', icon: Layers, group: 'Playbook' }");
    expect(app).toContain("{ id: 'playerstats', label: 'Player Stats', icon: Activity, group: 'Players' }");
    expect(app).toContain("{ id: 'comparisons', label: 'Tryout comparisons', icon: GitCompareArrows, group: 'Players' }");
    expect(app).toMatch(/activeTab === 'playerstats'[\s\S]*<PlayerSoloTracker/);
    const rosterRoute = app.slice(app.indexOf("{activeTab === 'roster'"), app.indexOf("{activeTab === 'playerstats'"));
    expect(rosterRoute).not.toContain('<PlayerSoloTracker');
  });

  it('can hide tryout comparisons for the current session from Settings without deleting data', () => {
    const app = fs.readFileSync('src/App.tsx', 'utf8');
    const settings = fs.readFileSync('src/components/SettingsControl.tsx', 'utf8');
    expect(app).toContain('const [showTryoutComparisons, setShowTryoutComparisons] = useState<boolean | null>(null)');
    expect(app).toContain("showTryoutComparisons ?? Boolean((data?.settings as any)?.tryoutsMode)");
    expect(app).toContain("if (!visible && activeTab === 'comparisons') setActiveTab('settings')");
    expect(settings).toContain('role="switch" aria-checked={showTryoutComparisons}');
    expect(settings).toContain('onShowTryoutComparisonsChange(enabled)');
    expect(settings).toContain('only affects this app session and does not delete any tryout data');
  });

  it('uses a readable replay evidence summary instead of exposing raw evidence JSON', () => {
    const vod = fs.readFileSync('src/components/VodReview.tsx', 'utf8');
    expect(vod).toContain('Evidence summary');
    expect(vod).toContain('Technical source details remain in the audit record');
    expect(vod).not.toContain('JSON.stringify({ crossChecks:');
  });

  it('keeps semantic color cues on high-value player numbers', () => {
    const players = fs.readFileSync('src/components/PlayerSoloTracker.tsx', 'utf8');
    expect(players).toContain('<span className="text-emerald-300">{row.kills}</span>');
    expect(players).toContain('<span className="text-rose-300">{row.deaths}</span>');
    expect(players).toContain('tone="cyan"');
    expect(players).toContain('tone="violet"');
    expect(players).toContain('Map performance');
    expect(players).toContain('Agent performance');
    expect(players).toContain('aria-expanded={open}');
  });

  it('keeps player map form descriptive and out of the experimental composite', () => {
    const maps = fs.readFileSync('src/components/MapBestStats.tsx', 'utf8');
    expect(maps).toContain('equal-weight player form');
    expect(maps).not.toContain('playerPerformanceWeight = 15');
    expect(maps).toContain('Experimental best-map score');
  });
});

