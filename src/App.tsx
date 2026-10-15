import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { TrackerData, Settings, MatchStatsUpdate, ScreenshotReviewDraft } from './types';
import LoginScreen from './components/LoginScreen';
import Logo from './components/Logo';
import TeamSyncIndicator from './components/TeamSyncIndicator';
import { apiFetch } from './utils/api';
import { filterAnalyticsHistory } from './utils/historyFilter';
import { filterTryoutWorkspace, activeTryoutPhase } from './utils/tryoutWorkspace';
import { DEFAULT_ANALYTICS_MAP_SCOPE, projectAnalyticsMapScope, type AnalyticsMapScope } from './utils/activeMapPool';
import { reportDesktopDiagnostic } from './utils/desktopDiagnostics';

// Heavy route views are code-split so the initial bundle only loads the shell + login.
const Dashboard = lazy(() => import('./components/Dashboard'));
const CalendarGoals = lazy(() => import('./components/CalendarGoals'));
const MatchLogRounds = lazy(() => import('./components/MatchLogRounds'));
const MapBestStats = lazy(() => import('./components/MapBestStats'));
const TeamCompositions = lazy(() => import('./components/TeamCompositions'));
const PlayerSoloTracker = lazy(() => import('./components/PlayerSoloTracker'));
const SettingsControl = lazy(() => import('./components/SettingsControl'));
const RosterManager = lazy(() => import('./components/RosterManager'));
const LiveLogger = lazy(() => import('./components/LiveLogger'));
const AITacticalHub = lazy(() => import('./components/AITacticalHub'));
const IntegrationStatus = lazy(() => import('./components/IntegrationStatus'));
const VodReview = lazy(() => import('./components/VodReview'));
const LineupLibrary = lazy(() => import('./components/LineupLibrary'));
const EconomyAnalytics = lazy(() => import('./components/EconomyAnalytics'));
const ScrimImport = lazy(() => import('./components/ScrimImport'));
const ReplayWorkspace = lazy(() => import('./components/ReplayWorkspace'));
const WebsiteMatchLog = lazy(() => import('./components/WebsiteMatchLog'));
const WebsiteMapSummary = lazy(() => import('./components/WebsiteMapSummary'));
const TryoutComparisons = lazy(() => import('./components/TryoutComparisons'));

import {
  ShieldAlert, RefreshCw, Trophy, Calendar, Swords, Compass,
  Layers, Users, Settings as SettingsIcon, Image, Activity, Sparkles,
  Film, Crosshair, Coins, FileCheck2, GitCompareArrows
} from 'lucide-react';

export default function App() {
  useEffect(() => {
    if (!window.moeDesktop) return;
    const onError = (event: ErrorEvent) => { void reportDesktopDiagnostic('renderer-error', event.error || event.message); };
    const onRejection = (event: PromiseRejectionEvent) => { void reportDesktopDiagnostic('renderer-unhandled-rejection', event.reason); };
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
  const desktopMode = Boolean(window.moeDesktop);
  const [key, setKey] = useState<string | null>(desktopMode ? null : localStorage.getItem('team_tracker_key'));
  const [role, setRole] = useState<string | null>(desktopMode ? null : localStorage.getItem('team_tracker_role'));
  const [username, setUsername] = useState<string | null>(desktopMode ? null : localStorage.getItem('team_tracker_username'));

  const [data, setData] = useState<TrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Navigation
  const [activeTab, setActiveTab] = useState<'dashboard' | 'calendar' | 'matches' | 'replays' | 'maps' | 'comps' | 'roster' | 'settings' | 'livelogger' | 'aitactical' | 'vod' | 'lineups' | 'economy' | 'comparisons'>('dashboard');
  const [reviewMatchId, setReviewMatchId] = useState<string | null>(null);
  const [manualReplayDraft, setManualReplayDraft] = useState<ScreenshotReviewDraft | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Scrim Auto-Import modal
  const [scrimOpen, setScrimOpen] = useState(false);

  useEffect(() => {
    if (!window.moeDesktop?.onCaptureReady) return;
    return window.moeDesktop.onCaptureReady(() => {
      setActiveTab('dashboard');
      setMobileMenuOpen(false);
      setScrimOpen(true);
    });
  }, []);

  useEffect(() => {
    if (!window.moeDesktop) return;
    let live = true;
    window.moeDesktop.bootstrapSession().then(session => {
      if (!live) return;
      localStorage.setItem('team_tracker_key', session.key);
      localStorage.setItem('team_tracker_role', session.role);
      localStorage.setItem('team_tracker_username', session.username);
      setRole(session.role);
      setUsername(session.username);
      setKey(session.key);
      setLoading(true);
    }).catch(error => {
      if (live) { setError(error.message || 'Desktop session failed.'); setLoading(false); }
    });
    return () => { live = false; };
  }, []);

  const openReplayImport = () => {
    setActiveTab('replays');
    setMobileMenuOpen(false);
  };

  // Load Database State
  const fetchDatabase = async () => {
    try {
      const res = await apiFetch(desktopMode ? '/api/data' : '/api/website-summary');
      if (!res.ok) throw new Error('Failed to retrieve tracker state.');
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Database fetch error.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (key) {
      fetchDatabase();
    } else {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const validateSession = () => { void apiFetch('/api/session').catch(() => {}); };
    const validateVisibleSession = () => { if (document.visibilityState === 'visible') validateSession(); };
    const timer = window.setInterval(validateSession, 10_000);
    window.addEventListener('focus', validateSession);
    document.addEventListener('visibilitychange', validateVisibleSession);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', validateSession);
      document.removeEventListener('visibilitychange', validateVisibleSession);
    };
  }, [key]);

  const handleLoginSuccess = (newKey: string, newRole: string, newUsername: string) => {
    setKey(newKey);
    setRole(newRole);
    setUsername(newUsername);
    setLoading(true);
  };


  // Theme configuration computed from data settings
  const theme = useMemo(() => {
    const mode = data?.settings?.theme || 'slate';
    if (mode === 'cosmic') {
      return {
        bg: 'bg-[#040814] text-white',
        border: 'border-violet-500/15',
        text: 'text-violet-400',
        textMuted: 'text-violet-300',
        primaryBg: 'bg-violet-600 hover:bg-violet-500',
        primaryHover: 'hover:bg-violet-600/10 shadow-violet-500/20',
        accent: '#9333ea',
        cardBg: 'surface-card',
        navActive: 'nav-item-active font-bold'
      };
    }
    if (mode === 'daylight') {
      return {
        bg: 'bg-[#f8fafc] text-slate-800',
        border: 'border-slate-200',
        text: 'text-slate-800',
        textMuted: 'text-slate-500',
        primaryBg: 'bg-slate-900 hover:bg-slate-800',
        primaryHover: 'hover:bg-slate-100 shadow-slate-200/10',
        accent: '#0f172a',
        cardBg: 'surface-card',
        navActive: 'nav-item-active font-bold'
      };
    }
    // Default 'slate'
    return {
      bg: 'bg-[#0F1923] text-white',
      border: 'border-white/10',
      text: 'text-[#ff4655]',
      textMuted: 'text-gray-400',
      primaryBg: 'bg-[#ff4655] hover:bg-[#ff5e6a]',
      primaryHover: 'hover:bg-white/5 shadow-red-500/10',
      accent: '#ff4655',
      cardBg: 'surface-card',
      navActive: 'nav-item-active font-bold'
    };
  }, [data]);

  // Editing views keep complete history. Read-only analytics hide only history
  // explicitly linked to an archived tryout batch by default.
  const [historicalTryoutId, setHistoricalTryoutId] = useState('');
  const [analyticsMapScope, setAnalyticsMapScope] = useState<AnalyticsMapScope>(DEFAULT_ANALYTICS_MAP_SCOPE);
  const workspaceData = useMemo(() => data ? filterTryoutWorkspace(data) : null, [data]);
  const analyticsBaseData = useMemo(() => data ? filterAnalyticsHistory(filterTryoutWorkspace(data, historicalTryoutId), 'all', !!historicalTryoutId) : null, [data, historicalTryoutId]);
  const analyticsProjection = useMemo(() => analyticsBaseData ? projectAnalyticsMapScope(analyticsBaseData, analyticsMapScope) : null, [analyticsBaseData, analyticsMapScope]);
  const analyticsData = analyticsProjection?.data || null;

  // --- MUTATION HELPERS ---
  // Client-side mirror of the server's sheet -> collection map.
  const SHEET_KEYS: Record<string, keyof TrackerData> = {
    Schedule: 'schedule', Goals: 'goals', Matches: 'matches',
    SoloQ: 'soloq', Strats: 'strats', StratRuns: 'stratRuns'
  };

  // Upsert a row into a collection in local state (no full refetch).
  const upsertLocal = (key: keyof TrackerData, row: any) => {
    setData((prev) => {
      if (!prev) return prev;
      const arr = [...((prev[key] as any[]) || [])];
      const idx = arr.findIndex((x) => x.id === row.id);
      if (idx >= 0) arr[idx] = row; else arr.push(row);
      return { ...prev, [key]: arr };
    });
  };

  const handleUpsert = async (sheet: string, row: any) => {
    try {
      const res = await apiFetch('/api/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet, row })
      });
      if (!res.ok) throw new Error('Upsert action failed on server.');
      const resJson = await res.json();
      const key = SHEET_KEYS[sheet];
      if (key) upsertLocal(key, resJson);
      return resJson;
    } catch (err: any) {
      alert(err.message || 'Error occurred during upsert.');
      throw err;
    }
  };

  const handleRemove = async (sheet: string, id: string) => {
    try {
      const res = await apiFetch('/api/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet, id })
      });
      if (!res.ok) throw new Error('Deletion request rejected.');
      const key = SHEET_KEYS[sheet];
      setData((prev) => {
        if (!prev) return prev;
        const next: any = { ...prev };
        if (key) next[key] = ((prev[key] as any[]) || []).filter((x) => x.id !== id);
        // Mirror the server's cascading deletes.
        if (sheet === 'Matches') {
          next.playerStats = (prev.playerStats || []).filter((p) => p.matchId !== id);
          next.rounds = (prev.rounds || []).filter((r) => r.matchId !== id);
          next.vetos = (prev.vetos || []).filter((v) => v.matchId !== id);
          next.stratRuns = (prev.stratRuns || []).filter((sr) => sr.matchId !== id);
        }
        if (sheet === 'Strats') {
          next.stratRuns = (prev.stratRuns || []).filter((sr) => sr.stratId !== id);
        }
        return next;
      });
    } catch (err: any) {
      alert(err.message || 'Error deleting row.');
    }
  };

  const handleSaveMatch = async (match: any, statsUpdate: MatchStatsUpdate = { operation: 'preserve' }) => {
    try {
      const res = await apiFetch('/api/save-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match, statsUpdate })
      });
      if (!res.ok) throw new Error('Save Match failed.');
      const resJson = await res.json();
      const savedMatch = resJson.match || resJson;
      const appliedStatsUpdate: MatchStatsUpdate = resJson.statsUpdate || { operation: 'preserve' };
      setData((prev) => {
        if (!prev) return prev;
        const matches = [...(prev.matches || [])];
        const idx = matches.findIndex((m) => m.id === savedMatch.id);
        if (idx >= 0) matches[idx] = savedMatch; else matches.push(savedMatch);
        const playerStats = appliedStatsUpdate.operation === 'replace'
          ? [
              ...(prev.playerStats || []).filter((ps) => ps.matchId !== savedMatch.id),
              ...appliedStatsUpdate.stats,
            ] as any[]
          : prev.playerStats;
        return { ...prev, matches, playerStats };
      });
      return resJson;
    } catch (err: any) {
      alert(err.message || 'Error saving match details.');
      throw err;
    }
  };

  const handleSaveRounds = async (matchId: string, rows: any[]) => {
    try {
      const res = await apiFetch('/api/save-rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, rows })
      });
      if (!res.ok) throw new Error('Failed to update round log sheets.');
      const resJson = await res.json();
      const savedRows: any[] = resJson.rows || [];
      if (resJson.screenshotSummary && window.moeDesktop) await window.moeDesktop.queueScreenshotSummary(resJson.screenshotSummary);
      setData((prev) => {
        if (!prev) return prev;
        const completeMatchStats: any[] = resJson.playerStats || [];
        const summarizedStats: any[] = resJson.screenshotSummary?.playerStats || [];
        return {
          ...prev,
          rounds: [...(prev.rounds || []).filter((r) => r.matchId !== matchId), ...savedRows],
          playerStats: completeMatchStats.length
            ? [...(prev.playerStats || []).filter((stat) => stat.matchId !== matchId), ...completeMatchStats]
            : summarizedStats.length
              ? (prev.playerStats || []).map(stat => {
                  if (stat.matchId !== matchId) return stat;
                  const summary = summarizedStats.find(item => item.id === stat.id);
                  return summary ? { ...stat, ...summary } : stat;
                })
              : prev.playerStats,
        };
      });
    } catch (err: any) {
      alert(err.message || 'Error saving rounds.');
      throw err;
    }
  };

  const handleSaveVeto = async (matchId: string, meta: any, actions: any[]) => {
    try {
      const res = await apiFetch('/api/save-veto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, meta, actions })
      });
      if (!res.ok) throw new Error('Veto record write failed.');
      const resJson = await res.json();
      const savedVetos: any[] = resJson.vetos || [];
      setData((prev) => prev ? {
        ...prev,
        vetos: [...(prev.vetos || []).filter((v) => v.matchId !== matchId), ...savedVetos]
      } : prev);
    } catch (err: any) {
      alert(err.message || 'Error saving veto draft.');
      throw err;
    }
  };

  const handleSyncSoloQ = async (player: string) => {
    const res = await apiFetch('/api/sync-soloq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player })
    });
    if (!res.ok) {
      const errJson = await res.json();
      throw new Error(errJson.error || 'Solo Queue syncing failed.');
    }
    // Solo Q sync is a rare, deliberate action; a targeted refetch keeps it simple.
    await fetchDatabase();
  };

  const handleSaveSettings = async (settings: Settings) => {
    try {
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to save settings.');
      }
      const resJson = await res.json();
      setData((prev) => prev ? { ...prev, settings: resJson } : prev);
      return resJson;
    } catch (err: any) {
      alert(err.message || 'Error saving settings.');
      throw err;
    }
  };

  const tabsList = [
    { id: 'dashboard', label: 'Dashboard', icon: Trophy },
    { id: 'calendar', label: 'Schedule & Goals', icon: Calendar },
    { id: 'matches', label: 'Matches Log', icon: Swords },
    { id: 'replays', label: 'Replay Evidence', icon: FileCheck2 },
    { id: 'vod', label: 'VOD Review', icon: Film },
    { id: 'lineups', label: 'Lineup Library', icon: Crosshair },
    { id: 'economy', label: 'Economy', icon: Coins },
    { id: 'comparisons', label: 'Tryout comparisons', icon: GitCompareArrows },
    { id: 'aitactical', label: 'AI Coach Hub', icon: Sparkles },
    { id: 'livelogger', label: 'Live Logger 🔴', icon: Activity },
    { id: 'maps', label: 'Map Analysis', icon: Compass },
    { id: 'comps', label: 'Compositions', icon: Layers },
    { id: 'roster', label: 'Roster & Solo Q', icon: Users },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ] as const;

  const visibleTabs = useMemo(() => {
    const surfaceTabs = desktopMode ? tabsList : tabsList.filter(tab => ['dashboard', 'calendar', 'matches', 'economy', 'maps', 'roster', 'comparisons'].includes(tab.id));
    if (role === 'player') return surfaceTabs.filter(tab => !['settings', 'livelogger', 'vod'].includes(tab.id));
    return surfaceTabs;
  }, [desktopMode, role]);

  const appTitle = data?.settings?.teamName || 'MoeAZack Valorant Tracker';
  const themeMode = data?.settings?.theme || 'slate';

  if (!key) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F1923] flex flex-col items-center justify-center text-white font-mono space-y-3">
        <RefreshCw className="w-10 h-10 animate-spin text-[#ff4655]" />
        <span className="text-sm tracking-widest text-gray-400">LOADING ESPORTS SCRIM TRACKER...</span>
      </div>
    );
  }

  return (
    <div data-theme={themeMode} className={`app-shell min-h-screen ${theme.bg} flex flex-col lg:flex-row font-sans relative overflow-x-hidden selection:bg-[#ff4655]/30 selection:text-[#ff4655]`}>
      {/* Background flares */}
      <div className="ambient-orb top-[-12rem] left-[-10rem] h-[28rem] w-[28rem] bg-[#46d8c7]/10"></div>
      <div className="ambient-orb bottom-[-12rem] right-[-10rem] h-[30rem] w-[30rem] bg-[#ff5361]/8"></div>

      {/* Sidebar Navigation */}
      <aside className="liquid-chrome app-sidebar hidden lg:flex w-72 flex-col p-6 shrink-0 min-h-screen justify-between">
        <div className="space-y-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo size={52} className="shrink-0 drop-shadow-[0_0_12px_rgba(92,232,244,0.28)]" />
            <div className="min-w-0 flex-1">
              <span className="block whitespace-nowrap text-[18px] font-black uppercase italic leading-tight tracking-[-0.045em]">MOE TRACKER</span>
              <span className="text-[9px] font-mono text-gray-500 tracking-widest uppercase block -mt-1">SCRIM ENGINE · v{__APP_VERSION__}</span>
            </div>
          </div>
          
          <nav className="space-y-1">
            {visibleTabs.map((tab) => {
              const IconComp = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`nav-item w-full flex items-center gap-4 px-3 py-2.5 text-left uppercase text-xs tracking-wider font-bold font-mono ${
                    isActive
                      ? theme.navActive
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <IconComp className="w-4.5 h-4.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Actions / Footer */}
        <div className="space-y-4">
          {/* Access Key Session Status Panel */}
          <div className="liquid-subtle p-3.5 rounded-xl flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full ${role === 'coach' ? 'bg-[#ff4655]/10 text-[#ff4655]' : 'bg-[#3aa0ff]/10 text-[#3aa0ff]'} flex items-center justify-center font-mono font-bold text-xs shrink-0 border border-current/10`}>
                {role === 'coach' ? 'C' : 'P'}
              </div>
              <div className="min-w-0">
                <span className="text-[9px] uppercase font-bold tracking-widest text-gray-500 block leading-none mb-1">Authenticated</span>
                <span className="text-[11px] font-mono font-bold text-white block uppercase truncate">{username}</span>
              </div>
            </div>
            
            <button
              onClick={() => {
                localStorage.removeItem('team_tracker_key');
                localStorage.removeItem('team_tracker_role');
                localStorage.removeItem('team_tracker_username');
                setKey(null);
                setRole(null);
                setUsername(null);
                setActiveTab('dashboard');
              }}
              className="ui-button w-full min-h-9 px-3 py-1.5 hover:text-rose-300 text-gray-400 text-[9px] font-bold font-mono uppercase tracking-widest cursor-pointer flex items-center justify-center gap-1.5"
            >
              Sign Out / Lock
            </button>
          </div>

          {/* Vision AI Import Module Button (Only Coach can use this) */}
          {desktopMode && role === 'coach' && (
            <div className="liquid-subtle p-4 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 text-[#ff4655] font-black text-[10px] tracking-widest uppercase font-mono">
                <Image className="w-4 h-4" /> SCOREBOARD IMPORT
              </div>
              <p className="text-sm text-gray-300 leading-normal">Read names and scores on your device for free, then review before saving.</p>
              <button
                onClick={openReplayImport}
                className="ui-button w-full min-h-10 px-3 py-2 text-xs font-bold text-[#ff6975] font-mono uppercase cursor-pointer"
              >
                IMPORT SCOREBOARD
              </button>
              <button
                onClick={() => setScrimOpen(true)}
                className="ui-button w-full min-h-10 px-3 py-2 text-xs font-bold text-gray-300 font-mono uppercase cursor-pointer"
              >
                Scrim Auto-Import
              </button>
            </div>
          )}

          {role === 'coach' && (
            <Suspense fallback={null}>
              <IntegrationStatus role={role} />
            </Suspense>
          )}

          <footer className="text-[10px] font-mono text-gray-500 leading-relaxed">
            <p>© {new Date().getFullYear()} {appTitle} Scrim Tracker.</p>
            <p className="mt-0.5 text-gray-600">Built for tournament-tier analysis.</p>
          </footer>
        </div>
      </aside>

      {/* Header for Mobile */}
      <div className="flex-1 flex flex-col min-h-screen overflow-x-hidden">
        <header className="liquid-chrome lg:hidden sticky top-0 z-50 px-4 py-3 flex justify-between items-center border-x-0 border-t-0 rounded-none">
          <div className="flex min-w-0 items-center gap-2">
            <Logo size={40} className="shrink-0" />
            <div className="min-w-0">
              <span className="block whitespace-nowrap text-base font-black uppercase italic leading-tight tracking-[-0.04em]">MOE TRACKER</span>
              <span className="text-[8px] font-mono text-gray-500 tracking-widest block -mt-1 font-bold">SCRIM ENGINE · v{__APP_VERSION__}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {desktopMode && <button
              onClick={openReplayImport}
              className="w-11 h-11 inline-flex items-center justify-center ui-button text-[#ff6975]"
              title="Import scoreboard"
              aria-label="Import scoreboard"
            >
              <Image className="w-4 h-4" />
            </button>}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="w-11 h-11 inline-flex items-center justify-center ui-button text-white"
              aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={mobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
              </svg>
            </button>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <nav id="mobile-navigation" className="liquid-chrome lg:hidden border-x-0 border-t-0 rounded-none px-4 py-4 space-y-2 relative z-40 animate-fadeIn">
            {visibleTabs.map((tab) => {
              const IconComp = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`nav-item w-full min-h-11 flex items-center gap-3.5 px-3 py-2.5 text-left uppercase text-xs tracking-wider font-bold font-mono ${
                    isActive
                      ? theme.navActive
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <IconComp className="w-4.5 h-4.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}

            {/* Mobile Session Status and Sign Out */}
            <div className="pt-3 border-t border-white/5 mt-2 space-y-2 text-left">
              <div className="flex justify-between items-center px-3 py-2 rounded bg-white/[0.02]">
                <span className="text-[10px] uppercase tracking-widest font-mono text-gray-400">
                  User: <strong className="text-white font-mono">{username} ({role})</strong>
                </span>
              </div>
              <button
                onClick={() => {
                  localStorage.removeItem('team_tracker_key');
                  localStorage.removeItem('team_tracker_role');
                  localStorage.removeItem('team_tracker_username');
                  setKey(null);
                  setRole(null);
                  setUsername(null);
                  setMobileMenuOpen(false);
                  setActiveTab('dashboard');
                }}
                className="ui-button w-full min-h-11 px-3 py-2 text-rose-300 text-xs font-bold font-mono uppercase tracking-widest cursor-pointer text-center"
              >
                Sign Out / Lock
              </button>
            </div>
          </nav>
        )}

        <div className="aurora-utility-bar"><div className="aurora-utility-context"><span className="aurora-eyebrow">{data && activeTryoutPhase(data) ? `Tryouts · ${activeTryoutPhase(data)?.name}` : 'Team workspace'}</span><span className="aurora-version-badge" title="Installed MoeTracker version">v{__APP_VERSION__}</span></div>{data && <TeamSyncIndicator teamName={data.settings.teamName || 'MoeTracker team'} role={role} desktopMode={desktopMode} />}</div>
        {data && ['dashboard', 'economy', 'maps', 'comps', 'roster', 'comparisons'].includes(activeTab) && (data.tryoutBatches || []).some(batch => batch.status === 'archived') && <label className="mx-auto flex max-w-7xl w-full flex-wrap items-center gap-2 px-6 text-sm text-slate-300">Analytics history<select aria-label="Analytics phase" className="ui-field min-h-11 px-3" value={historicalTryoutId} onChange={event => setHistoricalTryoutId(event.target.value)}><option value="">Current workspace</option>{data.tryoutBatches.filter(batch => batch.status === 'archived').map(batch => <option key={batch.id} value={batch.id}>Archived tryouts · {batch.name}</option>)}</select>{historicalTryoutId && <span className="text-xs text-cyan-300">Viewing archived results only; new entries still use the current workspace.</span>}</label>}

        {/* Main Workspace Frame */}
        <main className="flex-grow p-4 sm:p-6 lg:p-8 overflow-hidden max-w-7xl w-full mx-auto flex flex-col gap-6">
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg font-mono text-center flex items-center justify-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              Error: {error}
            </div>
          )}

          {/* Tab Router Switch */}
          <div key={activeTab} className="route-stage flex-grow">
            <Suspense fallback={
              <div className="flex items-center justify-center py-24 text-gray-500 font-mono text-sm gap-3">
                <RefreshCw className="w-5 h-5 animate-spin text-[#ff4655]" />
                Loading module…
              </div>
            }>
            {activeTab === 'dashboard' && analyticsData && (
              <Dashboard data={analyticsData} theme={theme} role={role} username={username} summaryMode={!desktopMode} onOpenMatch={(matchId) => { setReviewMatchId(matchId); setActiveTab('vod'); }} onOpenReplay={() => setActiveTab('replays')} onOpenCapture={() => setScrimOpen(true)} />
            )}
            {activeTab === 'calendar' && data && (
              <CalendarGoals data={data} theme={theme} onUpsert={handleUpsert} onRemove={handleRemove} />
            )}
            {activeTab === 'matches' && data && desktopMode && (
              <MatchLogRounds 
                data={workspaceData || data}
                theme={theme} 
                onSaveMatch={handleSaveMatch} 
                onRemove={handleRemove} 
                onSaveRounds={handleSaveRounds}
                onSaveVeto={handleSaveVeto}
                onRefreshDatabase={fetchDatabase}
                manualReplayDraft={manualReplayDraft}
                onManualReplayDraftConsumed={() => setManualReplayDraft(null)}
              />
            )}
            {activeTab === 'matches' && workspaceData && !desktopMode && <WebsiteMatchLog data={workspaceData} theme={theme} />}
            {activeTab === 'replays' && data && (
              <ReplayWorkspace data={workspaceData || data} role={role} onAccepted={fetchDatabase} onManualFallback={(item) => { setManualReplayDraft(item.draft as ScreenshotReviewDraft); setActiveTab('matches'); }} />
            )}
            {activeTab === 'livelogger' && data && (
              <LiveLogger
                data={data}
                theme={theme}
                onSaveMatch={handleSaveMatch}
                onSaveRounds={handleSaveRounds}
                onRefreshDatabase={fetchDatabase}
                setActiveTab={setActiveTab}
                onUpsert={handleUpsert}
              />
            )}
            {activeTab === 'vod' && data && (
              <VodReview data={workspaceData || data} theme={theme} role={role} onRefresh={fetchDatabase} initialMatchId={reviewMatchId} />
            )}
            {activeTab === 'lineups' && workspaceData && (
              <LineupLibrary data={workspaceData} theme={theme} role={role} onRefresh={fetchDatabase} />
            )}
            {activeTab === 'economy' && analyticsData && (
              <EconomyAnalytics data={analyticsData} theme={theme} />
            )}
            {activeTab === 'comparisons' && analyticsData && (
              <TryoutComparisons data={analyticsData} role={role} theme={theme} onRefresh={fetchDatabase} mapScope={analyticsProjection!.context} />
            )}
            {activeTab === 'aitactical' && analyticsData && (
              <AITacticalHub data={analyticsData} theme={theme} onUpsert={handleUpsert} onRemove={handleRemove} />
            )}
            {activeTab === 'maps' && analyticsData && desktopMode && (
              <MapBestStats data={analyticsData} evidenceData={workspaceData || data} theme={theme} onUpsert={handleUpsert} onRemove={handleRemove} />
            )}
            {activeTab === 'maps' && analyticsData && !desktopMode && <WebsiteMapSummary data={analyticsData} theme={theme} />}
            {activeTab === 'comps' && analyticsData && (
              <TeamCompositions data={analyticsData} theme={theme} />
            )}
            {activeTab === 'roster' && analyticsData && data && (
              <div className="space-y-6">
                {role === 'coach' && <RosterManager data={data} theme={theme} onRefresh={fetchDatabase} />}
                <PlayerSoloTracker data={analyticsData} theme={theme} role={role} onSyncSoloQ={handleSyncSoloQ} onRefresh={fetchDatabase} />
              </div>
            )}
            {activeTab === 'settings' && data && (
              <div className="space-y-6">
                <SettingsControl data={data} theme={theme} onSaveSettings={handleSaveSettings} onRefresh={fetchDatabase} analyticsMapScope={analyticsMapScope} analyticsMapScopeContext={analyticsProjection!.context} onAnalyticsMapScopeChange={setAnalyticsMapScope} />
              </div>
            )}
            </Suspense>
          </div>
        </main>
      </div>

      {/* --- SCRIM AUTO-IMPORT MODAL --- */}
      {desktopMode && scrimOpen && data && (
        <Suspense fallback={null}>
          <ScrimImport
            data={data}
            theme={theme}
            onSaveMatch={handleSaveMatch}
            onSaveRounds={handleSaveRounds}
            onClose={() => setScrimOpen(false)}
          />
        </Suspense>
      )}

    </div>
  );
}
