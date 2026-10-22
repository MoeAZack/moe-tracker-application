import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { TrackerData, Settings, MatchStatsUpdate, ScreenshotReviewDraft } from './types';
import { correctionSamplesFromAcceptedEdit } from '../lib/ocrLearning';
import { importRecoveredOcrLearning, recordOcrCorrections } from './utils/ocrLearningStore';
import LoginScreen from './components/LoginScreen';
import Logo from './components/Logo';
import TeamSyncIndicator from './components/TeamSyncIndicator';
import { apiFetch, DESKTOP_SESSION } from './utils/api';
import { filterAnalyticsHistory } from './utils/historyFilter';
import { filterTryoutWorkspace, activeTryoutPhase } from './utils/tryoutWorkspace';
import { DEFAULT_ANALYTICS_MAP_SCOPE, projectAnalyticsMapScope, type AnalyticsMapScope } from './utils/activeMapPool';
import { reportDesktopDiagnostic } from './utils/desktopDiagnostics';
import DesktopReplayAutomation from './components/DesktopReplayAutomation';
import ReviewContextBar from './components/ReviewContextBar';
import VodImportStatus from './components/VodImportStatus';
import VodTeamPick from './components/VodTeamPick';
import { projectCurrentPlayerAnalytics } from '../lib/activePlayerAnalytics';
import { projectReviewContext } from '../lib/reviewContext';
import { destinationEntryTab, evidenceReviewTab, focusReviewContext, navWorkspaceTabs, parseWorkspaceRoute, workspaceSectionTab, resolveWorkspaceTab, routableWorkspaceTabs, syncWorkspaceRoute, workspaceDestination, workspaceDestinations, type WorkspaceDestination, type WorkspaceRoute, type WorkspaceTabId } from './utils/workspaceRoute';
import ScreenErrorBoundary from './components/ScreenErrorBoundary';

// Heavy route views are code-split so the initial bundle only loads the shell + login.
const Dashboard = lazy(() => import('./components/Dashboard'));
const CalendarGoals = lazy(() => import('./components/CalendarGoals'));
const MatchLogRounds = lazy(() => import('./components/MatchLogRounds'));
const MapBestStats = lazy(() => import('./components/MapBestStats'));
const PlaybookStrategies = lazy(() => import('./components/PlaybookStrategies'));
const TeamCompositions = lazy(() => import('./components/TeamCompositions'));
const PlayerSoloTracker = lazy(() => import('./components/PlayerSoloTracker'));
const SettingsControl = lazy(() => import('./components/SettingsControl'));
const RosterManager = lazy(() => import('./components/RosterManager'));
const LiveLogger = lazy(() => import('./components/LiveLogger'));
const AITacticalHub = lazy(() => import('./components/AITacticalHub'));
const IntegrationStatus = lazy(() => import('./components/IntegrationStatus'));
const VodReview = lazy(() => import('./components/VodReview'));
const VodSubmission = lazy(() => import('./components/VodSubmission'));
const LineupLibrary = lazy(() => import('./components/LineupLibrary'));
const EconomyAnalytics = lazy(() => import('./components/EconomyAnalytics'));
const ScrimImport = lazy(() => import('./components/ScrimImport'));
const ReplayWorkspace = lazy(() => import('./components/ReplayWorkspace'));
const WebsiteMatchLog = lazy(() => import('./components/WebsiteMatchLog'));
const WebsiteMapSummary = lazy(() => import('./components/WebsiteMapSummary'));
const TryoutComparisons = lazy(() => import('./components/TryoutComparisons'));
const CoachWorkflow = lazy(() => import('./components/CoachWorkflow'));
const SystemReadinessPanel = lazy(() => import('./components/SystemReadinessPanel'));

import {
  ShieldAlert, RefreshCw, Trophy, Calendar, Swords, Compass,
  Layers, Users, Settings as SettingsIcon, Image, Activity, Sparkles,
  Film, Crosshair, Coins, FileCheck2, GitCompareArrows, Upload, X, Bot, BookOpen,
} from 'lucide-react';
import { notify } from './utils/appDialogs';
import AppDialogHost from './components/AppDialogHost';
import WorkspaceRecovery from './components/WorkspaceRecovery';

const DESTINATION_ICONS: Record<WorkspaceDestination, typeof Trophy> = {
  Home: Trophy, Matches: Swords, Team: Compass, Players: Users, Coaching: Sparkles, Playbook: Layers, Settings: SettingsIcon,
};

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
  // Set when the local workspace file is missing or damaged: the app offers recovery instead of an empty workspace.
  const [workspaceUnavailable, setWorkspaceUnavailable] = useState(false);
  
  // Navigation
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>(() => parseWorkspaceRoute(window.location.hash).tab);
  const [reviewMatchId, setReviewMatchId] = useState<string | null>(() => parseWorkspaceRoute(window.location.hash).matchId || sessionStorage.getItem('moetracker-review-match'));
  const [reviewRoundNo, setReviewRoundNo] = useState<number | null>(() => { const routeRound = parseWorkspaceRoute(window.location.hash).roundNo; if (routeRound) return routeRound; const value = Number(sessionStorage.getItem('moetracker-review-round')); return Number.isSafeInteger(value) && value > 0 ? value : null; });
  const [summaryScheduleId, setSummaryScheduleId] = useState<string | null>(null);
  const [manualReplayDraft, setManualReplayDraft] = useState<ScreenshotReviewDraft | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showTryoutComparisons, setShowTryoutComparisons] = useState<boolean | null>(null);
  const syncedRoute = useRef<WorkspaceRoute | null>(null);

  useEffect(() => {
    if (desktopMode) void importRecoveredOcrLearning().catch(error => console.warn(`[ocr-learning-recovery] ${error?.message || error}`));
  }, [desktopMode]);
  useEffect(() => {
    if (reviewMatchId) sessionStorage.setItem('moetracker-review-match', reviewMatchId); else sessionStorage.removeItem('moetracker-review-match');
    if (reviewRoundNo) sessionStorage.setItem('moetracker-review-round', String(reviewRoundNo)); else sessionStorage.removeItem('moetracker-review-round');
    const route = { tab: activeTab, matchId: reviewMatchId, roundNo: reviewRoundNo };
    syncWorkspaceRoute(route, syncedRoute.current);
    syncedRoute.current = route;
  }, [activeTab, reviewMatchId, reviewRoundNo]);
  useEffect(() => {
    // Back/Forward and typed links: adopt the URL without writing a new entry.
    const applyRoute = () => {
      const route = parseWorkspaceRoute(window.location.hash);
      syncedRoute.current = route;
      setActiveTab(route.tab);
      setReviewMatchId(route.matchId);
      setReviewRoundNo(route.roundNo);
    };
    window.addEventListener('popstate', applyRoute);
    window.addEventListener('hashchange', applyRoute);
    return () => { window.removeEventListener('popstate', applyRoute); window.removeEventListener('hashchange', applyRoute); };
  }, []);
  const focusReview = (matchId: string | null, roundNo?: number | null) => {
    const next = focusReviewContext({ matchId: reviewMatchId, roundNo: reviewRoundNo }, matchId, roundNo);
    setReviewMatchId(next.matchId); setReviewRoundNo(next.roundNo);
  };
  useEffect(() => {
    if (data && reviewMatchId && !(data.matches || []).some(match => match.id === reviewMatchId)) { setReviewMatchId(null); setReviewRoundNo(null); }
  }, [data, reviewMatchId]);

  // Scrim auto-import modal
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
      // The desktop session token lives in the main process; drop any copy an
      // older build left in page storage.
      localStorage.removeItem('team_tracker_key');
      localStorage.setItem('team_tracker_role', session.role);
      localStorage.setItem('team_tracker_username', session.username);
      setRole(session.role);
      setUsername(session.username);
      setKey(DESKTOP_SESSION);
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
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        if (body.code === 'WORKSPACE_DATABASE_MISSING' || body.code === 'WORKSPACE_DATABASE_UNREADABLE') { setWorkspaceUnavailable(true); setError(null); return; }
      }
      if (!res.ok) throw new Error('Failed to retrieve tracker state.');
      const json = await res.json();
      setData(json);
      setWorkspaceUnavailable(false);
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
      primaryBg: 'bg-[#d12a3a] hover:bg-[#b91c2e]',
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
  const analyticsBaseData = useMemo(() => {
    if (!data) return null;
    const selected = filterAnalyticsHistory(filterTryoutWorkspace(data, historicalTryoutId), 'all', !!historicalTryoutId);
    return historicalTryoutId ? selected : projectCurrentPlayerAnalytics(selected);
  }, [data, historicalTryoutId]);
  const analyticsProjection = useMemo(() => analyticsBaseData ? projectAnalyticsMapScope(analyticsBaseData, analyticsMapScope) : null, [analyticsBaseData, analyticsMapScope]);
  const analyticsData = analyticsProjection?.data || null;
  const coachReviewData = useMemo(() => analyticsData ? projectReviewContext(analyticsData, reviewMatchId, reviewRoundNo) : null, [analyticsData, reviewMatchId, reviewRoundNo]);

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
      notify(err.message || 'Error occurred during upsert.', 'error');
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
      notify(err.message || 'Error deleting row.', 'error');
    }
  };

  /** Server errors carry the reason (and the existing match on a conflict); never replace them with a generic message. */
  const saveError = async (res: Response, fallback: string) => {
    const body = await res.json().catch(() => null);
    return Object.assign(new Error(body?.error || fallback), { status: res.status, details: body });
  };

  const mergeRoundsResult = (prev: TrackerData, matchId: string, resJson: any): TrackerData => {
    const savedRows: any[] = resJson.rows || [];
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
  };

  const handleSaveMatch = async (match: any, statsUpdate: MatchStatsUpdate = { operation: 'preserve' }, rounds?: any[]) => {
    try {
      const priorMatch = data?.matches?.find(item => item.id === match?.id);
      const priorStats = priorMatch ? (data?.playerStats || []).filter(item => item.matchId === priorMatch.id) : [];
      const learningSamples = statsUpdate.operation === 'replace' && priorMatch
        ? correctionSamplesFromAcceptedEdit({ beforeMatch: priorMatch, beforeStats: priorStats, nextMatch: match, nextStats: statsUpdate.stats })
        : [];
      const res = await apiFetch('/api/save-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match, statsUpdate, ...(rounds ? { rounds } : {}) })
      });
      if (!res.ok) throw await saveError(res, 'Save Match failed.');
      const resJson = await res.json();
      const savedMatch = resJson.match || resJson;
      if (learningSamples.length) await recordOcrCorrections(learningSamples);
      if (resJson.roundsUpdate?.screenshotSummary && window.moeDesktop) await window.moeDesktop.queueScreenshotSummary(resJson.roundsUpdate.screenshotSummary);
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
        const next = { ...prev, matches, playerStats };
        return resJson.roundsUpdate ? mergeRoundsResult(next, savedMatch.id, resJson.roundsUpdate) : next;
      });
      if (resJson.duplicateReview?.status === 'quarantined') notify('This match looks like a second capture of a game that is already saved. It was kept but is excluded from analytics until a coach keeps or discards it in Match Log.');
      return resJson;
    } catch (err: any) {
      notify(err.message || 'Error saving match details.', 'error');
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
      if (!res.ok) throw await saveError(res, 'Failed to update round log sheets.');
      const resJson = await res.json();
      if (resJson.screenshotSummary && window.moeDesktop) await window.moeDesktop.queueScreenshotSummary(resJson.screenshotSummary);
      setData((prev) => {
        if (!prev) return prev;
        const next = mergeRoundsResult(prev, matchId, resJson);
        return { ...next, matches: (next.matches || []).map(item => item.id === matchId ? { ...item, duplicateReview: resJson.duplicateReview || undefined } : item) };
      });
      if (resJson.duplicateReview?.status === 'quarantined') notify('These rounds match a game that is already saved. The match is excluded from analytics until a coach keeps or discards it in Match Log.');
    } catch (err: any) {
      notify(err.message || 'Error saving rounds.', 'error');
      throw err;
    }
  };

  const handleAcceptRoundEvidence = async (matchId: string, roundNo: number) => {
    try {
      const res = await apiFetch('/api/round-evidence-accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId, roundNo }) });
      if (!res.ok) throw await saveError(res, 'Failed to accept round evidence.');
      const resJson = await res.json();
      if (resJson.screenshotSummary && window.moeDesktop) await window.moeDesktop.queueScreenshotSummary(resJson.screenshotSummary);
      setData(prev => prev ? mergeRoundsResult(prev, matchId, resJson) : prev);
    } catch (err: any) {
      notify(err.message || 'Error accepting round evidence.', 'error');
      throw err;
    }
  };

  const handleDuplicateReview = async (matchId: string, decision: 'keep-both' | 'discard-this') => {
    try {
      const res = await apiFetch('/api/match-duplicate-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, decision })
      });
      if (!res.ok) throw await saveError(res, 'Duplicate review failed.');
      await fetchDatabase();
    } catch (err: any) {
      notify(err.message || 'Error saving duplicate review.', 'error');
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
      notify(err.message || 'Error saving veto draft.', 'error');
      throw err;
    }
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
      notify(err.message || 'Error saving settings.', 'error');
      throw err;
    }
  };

  const tabsList = [
    { id: 'dashboard', label: 'Home', icon: Trophy },
    { id: 'matches', label: 'Match Review', icon: Swords },
    { id: 'replays', label: 'Replay Evidence', icon: FileCheck2 },
    { id: 'vod', label: 'VOD Review', icon: Film },
    { id: 'vodsubmit', label: 'VOD Submission', icon: Upload },
    { id: 'livelogger', label: 'Live logging', icon: Activity },
    { id: 'economy', label: 'Economy', icon: Coins },
    { id: 'maps', label: 'Map Analysis', icon: Compass },
    { id: 'roster', label: 'Roster', icon: Users },
    { id: 'playerstats', label: 'Player Stats', icon: Activity },
    { id: 'comparisons', label: 'Tryout comparisons', icon: GitCompareArrows },
    { id: 'calendar', label: 'Schedule & Goals', icon: Calendar },
    { id: 'aitactical', label: 'Coach Workspace', icon: Sparkles },
    { id: 'strats', label: 'Strategies', icon: BookOpen },
    { id: 'comps', label: 'Compositions', icon: Layers },
    { id: 'lineups', label: 'Lineup Library', icon: Crosshair },
    { id: 'aihub', label: 'AI tools', icon: Bot },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ] as const;

  const tryoutComparisonsVisible = showTryoutComparisons ?? Boolean((data?.settings as any)?.tryoutsMode);
  const routableTabs = useMemo(() => routableWorkspaceTabs({ desktopMode, role }), [desktopMode, role]);
  const visibleTabs = useMemo(() => {
    const ids = navWorkspaceTabs({ desktopMode, role, showTryoutComparisons: tryoutComparisonsVisible, activeTab });
    return tabsList.filter(tab => ids.includes(tab.id));
  }, [desktopMode, role, tryoutComparisonsVisible, activeTab]);
  // Seven destinations in the sidebar; a destination with several screens
  // shows them as sections above the screen.
  const destinations = useMemo(() => workspaceDestinations(visibleTabs.map(tab => tab.id)).map(entry => ({
    ...entry, icon: DESTINATION_ICONS[entry.destination], sections: entry.tabs.map(id => visibleTabs.find(tab => tab.id === id)!),
  })), [visibleTabs]);
  const activeDestination = workspaceDestination(activeTab);
  const activeSections = destinations.find(entry => entry.destination === activeDestination)?.sections || [];
  const lastSectionByDestination = useRef<Partial<Record<WorkspaceDestination, WorkspaceTabId>>>({});
  useEffect(() => { lastSectionByDestination.current[workspaceDestination(activeTab)] = activeTab; }, [activeTab]);
  const openDestination = (destination: WorkspaceDestination) => {
    const target = destinationEntryTab(destinations.find(entry => entry.destination === destination)?.tabs || [], lastSectionByDestination.current[destination]);
    if (target) setActiveTab(target);
  };
  useEffect(() => {
    const resolved = resolveWorkspaceTab(activeTab, routableTabs);
    if (resolved !== activeTab) setActiveTab(resolved);
  }, [activeTab, routableTabs]);

  const appTitle = data?.settings?.teamName || 'Moe Tracker';
  const themeMode = data?.settings?.theme || 'slate';

  if (!key) {
    return <><LoginScreen onLoginSuccess={handleLoginSuccess} /><AppDialogHost /></>;
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
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <AppDialogHost />
      {/* Background flares */}
      <div className="ambient-orb top-[-12rem] left-[-10rem] h-[28rem] w-[28rem] bg-[#46d8c7]/10"></div>
      <div className="ambient-orb bottom-[-12rem] right-[-10rem] h-[30rem] w-[30rem] bg-[#ff5361]/8"></div>

      {/* Sidebar Navigation */}
      <aside className="liquid-chrome app-sidebar hidden lg:flex w-72 flex-col p-6 shrink-0 min-h-screen justify-between">
        <div className="space-y-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo size={52} className="shrink-0 drop-shadow-[0_0_12px_rgba(92,232,244,0.28)]" />
            <div className="min-w-0 flex-1">
              <span className="block whitespace-nowrap text-[18px] font-black uppercase italic leading-tight tracking-[-0.045em]">Moe Tracker</span>
              <span title={`Build ${__APP_REVISION__}`} className="text-xs font-mono text-gray-500 tracking-widest uppercase block -mt-1">SCRIM ENGINE · v{__APP_VERSION__}</span>
            </div>
          </div>
          
          <nav aria-label="Main" className="space-y-1">
            {destinations.map(({ destination, icon: IconComp }) => {
              const isActive = activeDestination === destination;
              return (
                <button
                  key={destination}
                  onClick={() => openDestination(destination)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`nav-item w-full flex items-center gap-4 px-3 py-2.5 text-left text-xs tracking-wider font-bold font-mono ${
                    isActive
                      ? theme.navActive
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <IconComp className="w-4.5 h-4.5 shrink-0" />
                  <span>{destination}</span>
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
                <span className="text-xs uppercase font-bold tracking-widest text-gray-500 block leading-none mb-1">Authenticated</span>
                <span className="text-xs font-mono font-bold text-white block uppercase truncate">{username}</span>
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
              className="ui-button w-full min-h-9 px-3 py-1.5 hover:text-rose-300 text-gray-400 text-xs font-bold font-mono tracking-widest cursor-pointer flex items-center justify-center gap-1.5"
            >
              Sign out / lock
            </button>
          </div>

          {/* Vision AI Import Module Button (Only Coach can use this) */}
          {desktopMode && role === 'coach' && (
            <div className="liquid-subtle p-4 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 text-[#ff4655] font-black text-xs tracking-widest uppercase font-mono">
                <Image className="w-4 h-4" /> SCOREBOARD IMPORT
              </div>
              <p className="text-sm text-gray-300 leading-normal">Read names and scores on your device for free, then review before saving.</p>
              <button
                onClick={openReplayImport}
                className="ui-button w-full min-h-10 px-3 py-2 text-xs font-bold text-[#ff6975] font-mono cursor-pointer"
              >
                Import scoreboard
              </button>
              <button
                onClick={() => setScrimOpen(true)}
                className="ui-button w-full min-h-10 px-3 py-2 text-xs font-bold text-gray-300 font-mono cursor-pointer"
              >
                Scrim auto-import
              </button>
            </div>
          )}

          {role === 'coach' && (
            <Suspense fallback={null}>
              <IntegrationStatus role={role} />
            </Suspense>
          )}

          <footer className="text-xs font-mono text-gray-500 leading-relaxed">
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
              <span className="block whitespace-nowrap text-base font-black uppercase italic leading-tight tracking-[-0.04em]">Moe Tracker</span>
              <span title={`Build ${__APP_REVISION__}`} className="text-xs font-mono text-gray-500 tracking-widest block -mt-1 font-bold">SCRIM ENGINE · v{__APP_VERSION__}</span>
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
            {destinations.map(({ destination, icon: IconComp }) => {
              const isActive = activeDestination === destination;
              return (
                <button
                  key={destination}
                  onClick={() => {
                    openDestination(destination);
                    setMobileMenuOpen(false);
                  }}
                  className={`nav-item w-full min-h-11 flex items-center gap-3.5 px-3 py-2.5 text-left text-xs tracking-wider font-bold font-mono ${
                    isActive
                      ? theme.navActive
                      : 'text-gray-400 hover:text-white'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <IconComp className="w-4.5 h-4.5" />
                  <span>{destination}</span>
                </button>
              );
            })}

            {/* Mobile Session Status and Sign Out */}
            <div className="pt-3 border-t border-white/5 mt-2 space-y-2 text-left">
              <div className="flex justify-between items-center px-3 py-2 rounded bg-white/[0.02]">
                <span className="text-xs uppercase tracking-widest font-mono text-gray-400">
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
                className="ui-button w-full min-h-11 px-3 py-2 text-rose-300 text-xs font-bold font-mono tracking-widest cursor-pointer text-center"
              >
                Sign out / lock
              </button>
            </div>
          </nav>
        )}

        {data && desktopMode && <DesktopReplayAutomation data={data} role={role} onProcessed={fetchDatabase} onSaveMatch={handleSaveMatch} />}
        <div className="aurora-utility-bar"><div className="aurora-utility-context"><span className="aurora-eyebrow">{data && activeTryoutPhase(data) ? `Tryouts · ${activeTryoutPhase(data)?.name}` : 'Team workspace'}</span><span className="aurora-version-badge" title="Installed Moe Tracker version">v{__APP_VERSION__}</span></div>{data && <TeamSyncIndicator teamName={data.settings.teamName || 'Moe Tracker team'} role={role} desktopMode={desktopMode} />}</div>
        {data && ['dashboard', 'economy', 'maps', 'comps', 'roster', 'playerstats', 'comparisons'].includes(activeTab) && (data.tryoutBatches || []).some(batch => batch.status === 'archived') && <label className="mx-auto flex max-w-7xl w-full flex-wrap items-center gap-2 px-6 text-sm text-slate-300">Analytics history<select aria-label="Analytics phase" className="ui-field min-h-11 px-3" value={historicalTryoutId} onChange={event => setHistoricalTryoutId(event.target.value)}><option value="">Current workspace</option>{data.tryoutBatches.filter(batch => batch.status === 'archived').map(batch => <option key={batch.id} value={batch.id}>Archived tryouts · {batch.name}</option>)}</select>{historicalTryoutId && <span className="text-xs text-cyan-300">Viewing archived results only; new entries still use the current workspace.</span>}</label>}

        {/* Main Workspace Frame */}
        <main id="main-content" tabIndex={-1} className="flex-grow p-4 sm:p-6 lg:p-8 overflow-hidden max-w-7xl w-full mx-auto flex flex-col gap-6">
          {workspaceUnavailable && desktopMode && role === 'coach' && <WorkspaceRecovery onRecovered={fetchDatabase} />}
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg font-mono text-center flex items-center justify-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              Error: {error}
            </div>
          )}

          {/* Tab Router Switch */}
          {desktopMode && <VodImportStatus hidden={activeTab === 'vodsubmit'} onOpen={() => setActiveTab('vodsubmit')} />}
          {desktopMode && <VodTeamPick />}
          {desktopMode && data && ['matches', 'replays', 'vod', 'economy', 'aitactical'].includes(activeTab) && <ReviewContextBar data={workspaceData || data} value={{ matchId: reviewMatchId, roundNo: reviewRoundNo }} onChange={value => { setReviewMatchId(value.matchId); setReviewRoundNo(value.roundNo); }} onNavigate={tab => setActiveTab(tab)} />}
          {activeSections.length > 1 && <nav aria-label={`${activeDestination} sections`} className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
            {activeSections.map(section => {
              const SectionIcon = section.icon; const isActive = section.id === workspaceSectionTab(activeTab);
              return <button key={section.id} type="button" onClick={() => setActiveTab(section.id)} aria-current={isActive ? 'page' : undefined} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${isActive ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}><SectionIcon className="h-4 w-4 shrink-0" aria-hidden="true" />{section.label}</button>;
            })}
          </nav>}
          <div key={activeTab} className="route-stage flex-grow">
            <ScreenErrorBoundary screen={tabsList.find(tab => tab.id === activeTab)?.label.replace(/[^\p{L}\p{N}&' -]/gu, '').trim() || 'This screen'}>
            <Suspense fallback={
              <div className="flex items-center justify-center py-24 text-gray-500 font-mono text-sm gap-3">
                <RefreshCw className="w-5 h-5 animate-spin text-[#ff4655]" />
                Loading module…
              </div>
            }>
            {activeTab === 'dashboard' && analyticsData && (
              <Dashboard data={analyticsData} theme={theme} role={role} username={username} summaryMode={!desktopMode} onOpenMatch={(matchId) => { setReviewMatchId(matchId); setActiveTab(evidenceReviewTab(routableTabs)); }} onOpenReplay={() => setActiveTab('replays')} onOpenCapture={() => setScrimOpen(true)} onOpenSchedule={() => setActiveTab('calendar')} onOpenCoachWorkspace={() => setActiveTab('aitactical')} inboxData={data || undefined} onOpenInboxItem={target => {
                if (target.surface === 'capture') setScrimOpen(true);
                else if (target.surface === 'replays') setActiveTab('replays');
                else if (target.surface === 'coaching') setActiveTab('aitactical');
                else if (target.surface === 'practice-summary') { setSummaryScheduleId(target.scheduleId); setActiveTab('calendar'); }
                else { setReviewMatchId(target.matchId); setReviewRoundNo(target.roundNo ?? null); setActiveTab('matches'); }
              }} />
            )}
            {activeTab === 'calendar' && data && (
              <CalendarGoals data={data} theme={theme} role={role || 'player'} onUpsert={handleUpsert} onRemove={handleRemove} onRefresh={fetchDatabase} openSummaryId={summaryScheduleId} onSummaryOpened={() => setSummaryScheduleId(null)} />
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
                reviewMatchId={reviewMatchId}
                reviewRoundNo={reviewRoundNo}
                onReviewContextChange={(matchId, roundNo) => { setReviewMatchId(matchId); setReviewRoundNo(roundNo || null); }}
                onDuplicateReview={handleDuplicateReview}
                onAcceptRoundEvidence={role === 'coach' ? handleAcceptRoundEvidence : undefined}
                onRecordLive={routableTabs.includes('livelogger') ? () => setActiveTab('livelogger') : undefined}
              />
            )}
            {activeTab === 'matches' && workspaceData && !desktopMode && <WebsiteMatchLog data={workspaceData} theme={theme} focusMatchId={reviewMatchId} />}
            {activeTab === 'replays' && data && (
              <ReplayWorkspace data={workspaceData || data} role={role} preferredMatchId={reviewMatchId} preferredRoundNo={reviewRoundNo} onAccepted={fetchDatabase} onManualFallback={(item) => { setManualReplayDraft(item.draft as ScreenshotReviewDraft); setActiveTab('matches'); }} />
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
              <VodReview data={workspaceData || data} theme={theme} role={role} onRefresh={fetchDatabase} initialMatchId={reviewMatchId} selectedRoundNo={reviewRoundNo} onReviewContextChange={(matchId, roundNo) => { setReviewMatchId(matchId); setReviewRoundNo(roundNo); }} />
            )}
            {activeTab === 'vodsubmit' && data && (
              <VodSubmission data={workspaceData || data} role={role} onRefresh={fetchDatabase} />
            )}
            {activeTab === 'lineups' && workspaceData && (
              <LineupLibrary data={workspaceData} theme={theme} role={role} onRefresh={fetchDatabase} />
            )}
            {activeTab === 'economy' && analyticsData && (
              <EconomyAnalytics data={analyticsData} theme={theme} focusedMatchId={reviewMatchId} focusedRoundNo={reviewRoundNo} />
            )}
            {activeTab === 'comparisons' && analyticsData && (
              <TryoutComparisons data={analyticsData} role={role} theme={theme} onRefresh={fetchDatabase} mapScope={analyticsProjection!.context} />
            )}
            {activeTab === 'aitactical' && analyticsData && (
              <div className="space-y-8">
                <CoachWorkflow data={analyticsData} role={role} preferredMatchId={reviewMatchId} onRefresh={fetchDatabase} onFocusMatch={focusReview} onOpenMatch={(matchId, roundNo) => { focusReview(matchId, roundNo); setActiveTab(evidenceReviewTab(routableTabs)); }} />
              </div>
            )}
            {activeTab === 'aihub' && analyticsData && (
              <AITacticalHub data={coachReviewData || analyticsData} theme={theme} onUpsert={handleUpsert} onRemove={handleRemove} />
            )}
            {activeTab === 'maps' && analyticsData && desktopMode && (
              <MapBestStats data={analyticsData} theme={theme} />
            )}
            {activeTab === 'maps' && analyticsData && !desktopMode && <WebsiteMapSummary data={analyticsData} theme={theme} />}
            {activeTab === 'strats' && workspaceData && (
              <PlaybookStrategies data={workspaceData} theme={theme} onUpsert={handleUpsert} onRemove={handleRemove} />
            )}
            {activeTab === 'comps' && analyticsData && (
              <TeamCompositions data={analyticsData} theme={theme} />
            )}
            {activeTab === 'roster' && analyticsData && data && (
              <div className="space-y-6">
                {role === 'coach' && <RosterManager data={data} theme={theme} onRefresh={fetchDatabase} />}
              </div>
            )}
            {activeTab === 'playerstats' && analyticsData && (
              <PlayerSoloTracker data={analyticsData} theme={theme} role={role} onRefresh={fetchDatabase} onOpenEvidence={(matchId, roundNo) => { setReviewMatchId(matchId); setReviewRoundNo(roundNo); setActiveTab(evidenceReviewTab(routableTabs)); }} />
            )}
            {activeTab === 'settings' && data && (
              <div className="space-y-6">
                <SystemReadinessPanel theme={theme} />
                <SettingsControl data={data} theme={theme} onSaveSettings={handleSaveSettings} onRefresh={fetchDatabase} analyticsMapScope={analyticsMapScope} analyticsMapScopeContext={analyticsProjection!.context} onAnalyticsMapScopeChange={setAnalyticsMapScope} showTryoutComparisons={tryoutComparisonsVisible} onShowTryoutComparisonsChange={(visible) => { setShowTryoutComparisons(visible); if (!visible && activeTab === 'comparisons') setActiveTab('settings'); }} />
              </div>
            )}
            </Suspense>
            </ScreenErrorBoundary>
          </div>
        </main>
      </div>

      {/* --- SCRIM AUTO-IMPORT MODAL --- */}
      {desktopMode && scrimOpen && data && (
        <ScreenErrorBoundary screen="Scoreboard import">
        <Suspense fallback={null}>
          <ScrimImport
            data={data}
            theme={theme}
            onSaveMatch={handleSaveMatch}
            onClose={() => setScrimOpen(false)}
          />
        </Suspense>
        </ScreenErrorBoundary>
      )}

    </div>
  );
}
