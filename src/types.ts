export interface CalendarConfig {
  key: string;
  name: string;
  color: string;
  gcalId: string;
  sync: boolean;
}

export interface RiotIdConfig {
  name: string;
  tag: string;
  region?: string;
  level?: number;
}

export interface StatsConfig {
  shrinkK: number;
  decayEnabled?: boolean;
  halfLifeDays?: number;
  lowSample: number;
  rollingWindow?: number;
  /** Unvalidated composite ratings stay hidden unless a coach explicitly opts in. */
  experimentalCompositeScores?: boolean;
}

export interface RosterPlayer {
  id: string;
  displayName: string;
  createdAt: string;
  rosterStatus?: AppearanceType;
  retiredAt?: string;
  purgeAfter?: string;
}

export interface IdentityCorrectionBatch {
  id: string;
  sourceIdentity: string;
  targetPlayerId: string;
  reason: string;
  affectedRows: Array<{
    rowId: string;
    beforePlayerId: string | null;
    beforePlayer: string;
    beforeDisplayNameSnapshot: string | null;
  }>;
  createdAt: string;
  createdBy: string;
  revertedAt?: string;
  revertedBy?: string;
  revertReason?: string;
}

export interface CoreMembership {
  id: string;
  playerId: string;
  joinedAt: string;
  endedAt?: string;
  sourceTryoutBatchId?: string;
}

export interface TryoutBatch {
  id: string;
  name: string;
  status: 'active' | 'archived';
  candidatePlayerIds: string[];
  aliases?: Array<{ playerId: string; alias: string }>;
  createdAt: string;
  archivedAt?: string;
}

export interface SeasonArchive {
  id: string;
  name: string;
  seasonName: string;
  archivedAt: string;
  schemaVersion: 1;
  rosterPlayers: RosterPlayer[];
  identityCorrectionBatches?: IdentityCorrectionBatch[];
  coreMemberships: CoreMembership[];
  tryoutBatches: TryoutBatch[];
  practiceBlocks?: PracticeBlock[];
  tryoutDecisionNotes?: TryoutDecisionNote[];
  schedule: Schedule[];
  attendanceCredits?: AttendanceCredit[];
  goals: Goal[];
  matches: Match[];
  playerStats: PlayerStats[];
  soloq: SoloQ[];
  rounds: Round[];
  vetos: Veto[];
  stratRuns: StratRun[];
  strats: Strat[];
  vodReviews: VodReview[];
  vodSubmissions?: VodSubmission[];
  riotIds: Record<string, RiotIdConfig>;
  legacyPlayers: string[];
  legacyInactivePlayers: string[];
}

export interface WeightsConfig {
  mapWin: number;
  attWin: number;
  defWin: number;
  pistol: number;
  eco: number;
  bonus: number;
  kd: number;
}

export interface Settings {
  teamName: string;
  season: string;
  theme: string;
  density: string;
  weekStart: number;
  confirmOnSave: boolean;
  confirmOnDelete: boolean;
  attendanceGraceMinutes?: number;
  attendanceCheckInOpenMinutes?: number;
  attendanceCheckInCloseMinutes?: number;
  attendanceStrikesPerRedDot?: number;
  attendanceRedDotCost?: number;
  attendanceCurrency?: string;
  /** Private server-side PRACC feed settings are exposed only through coach integration endpoints. */
  praccCalendarUrl?: string;
  praccCalendarLastAttemptAt?: string;
  praccCalendarLastSyncedAt?: string;
  praccCalendarLastError?: string;
  tryoutsMode?: boolean;
  activeTryoutBatchId?: string | null;
  players: string[];
  maps: string[];
  /** Independently verified replay-world to tactical-map transforms. Draft rows never activate spatial comparisons. */
  mapCalibrations?: import('../lib/mapCalibration').MapCalibration[];
  agents: string[];
  weapons?: string[];
  inactivePlayers?: string[];
  inactiveMaps?: string[];
  inactiveAgents?: string[];
  inactiveWeapons?: string[];
  matchTypes: string[];
  attendanceStates: string[];
  goalStates: string[];
  calendars: CalendarConfig[];
  riotIds: Record<string, RiotIdConfig>;
  vlr: {
    baseUrl: string;
    teamId: string;
    teamName: string;
  };
  ai: {
    model: string;
    ocrFallback?: 'local-only' | 'local-then-cloud';
  };
  weights: WeightsConfig;
  buyTypes: string[];
  winReasons: string[];
  sites: string[];
  vetoActions: string[];
  stats?: StatsConfig;
  coachingThresholds?: {
    minimumSamples?: number;
    fullBuyLosses?: number;
    antiEcoLosses?: number;
    firstDeathCollapseRate?: number;
    maxActiveActionsPerPlayer?: number;
  };
  deletedCoachingSignalFingerprints?: string[];
  /** Staged Moe Tracker 0.2 capabilities. Unknown flags are ignored and every flag defaults off. */
  featureFlags?: Partial<import('../lib/featureFlags').Moe02FeatureFlags>;
}

export interface Schedule {
  id: string;
  date: string;
  kind?: string;
  primary: string;
  secondary?: string;
  notes?: string;
  /** Coach-owned notes remain stable when provider fields refresh. */
  coachNotes?: string;
  attendance: Record<string, string>;
  startTime?: string;
  allDay?: boolean;
  durationMinutes?: number;
  repeatSeriesId?: string;
  repeatIndex?: number;
  repeatCount?: number;
  attendanceEnabled?: boolean;
  requiredPlayerIds?: string[];
  attendanceCheckIns?: AttendanceCheckIn[];
  attendanceAudit?: AttendanceAuditEntry[];
  source?: 'manual' | 'pracc';
  sourceEventId?: string;
  sourceCalendarHash?: string;
  calendarKey?: string;
  gcalEventId?: string;
  practiceBlockId?: string;
  linkedGoalIds?: string[];
  progressLinkedAt?: string;
  progressLinkedBy?: string;
  /** Set when the session was linked from a PRACC slot, so later maps of the same session may join it. */
  progressLinkedAutomatically?: boolean;
  /** Links a Team Talk to its Debrief (or vice versa) without merging their distinct event types. */
  linkedReviewEventId?: string;
}

export interface AttendanceCheckIn {
  id: string;
  playerId: string;
  checkedInAt: string;
  status: 'on-time' | 'late' | 'excused';
  correctionReason?: string;
  correctedAt?: string;
  correctedBy?: string;
}

export interface AttendanceCredit {
  id: string;
  playerId: string;
  kind: 'green';
  reason: string;
  createdAt: string;
  createdBy: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
}

export interface Goal {
  id: string;
  date: string;
  goal: string;
  notes?: string;
  status: string;
  owner?: string;
  ownerPlayerId?: string;
  matchId?: string;
  roundId?: string;
  evidenceClipId?: string;
  sourceSignalId?: string;
  coachingActionId?: string;
  dueBlockId?: string;
}

export interface Match {
  id: string;
  date: string;
  type: string;
  opponent: string;
  opponentCategory?: string;
  map: string;
  attW: number | null;
  attL: number | null;
  defW: number | null;
  defL: number | null;
  ourScore?: number | null;
  theirScore?: number | null;
  pistolAtt?: string;
  pistolDef?: string;
  ecoAtt?: string;
  ecoDef?: string;
  bonusAtt?: string;
  bonusDef?: string;
  vod?: string;
  notes?: string;
  source?: string;
  vlrMatchId?: string;
  rosterContext?: MatchRosterContext;
  sourceMetadata?: EntrySourceMetadata;
  corrections?: EntryCorrectionMetadata[];
  reviewConfirmation?: ScreenshotReviewConfirmation;
  /** Derived website-safe acceptance fact; contains no reviewer identity or raw provenance. */
  comparisonEvidence?: { accepted: boolean };
  /** Team-only round conversion summary synchronized without raw screenshot evidence. */
  roundAnalytics?: Record<string, unknown>;
  vodSubmissionIds?: string[];
  /** Server-owned same-game duplicate state. Quarantined matches are excluded from analytics until a coach decides. */
  duplicateReview?: MatchDuplicateReview;
}

export interface MatchDuplicateReview {
  schema: 'moetracker.duplicate-review/v1';
  status: 'quarantined' | 'kept-distinct';
  fingerprint: string;
  candidateMatchIds: string[];
  detectedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export type EntrySourceMethod = 'manual' | 'screenshot' | 'live-logger' | 'provider-import' | 'vod-submission' | 'unknown';

export interface EntrySourceMetadata {
  method: EntrySourceMethod;
  capturedAt: string;
  provider?: string;
  model?: string;
  externalId?: string;
}

export interface ScreenshotReviewConfirmation {
  alliedSideConfirmed: true;
  confirmedAt: string;
  confirmedBy: string;
}

export interface EntryCorrectionMetadata {
  correctedAt: string;
  correctedBy: string;
  fields: string[];
  /** Required explanation for explicit corrections to accepted identity facts. */
  reason?: string;
}

export type RosterContextKind = 'core' | 'tryout' | 'mixed' | 'unclassified';
export type AppearanceType = 'core' | 'tryout' | 'standIn';

export interface MatchRosterContext {
  kind: RosterContextKind;
  tryoutBatchId?: string;
}

export interface PracticeBlock {
  schema: 'moetracker.practice-block/v1';
  id: string;
  name: string;
  matchIds: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export type CoachingSignalStatus = 'new' | 'reviewing' | 'accepted' | 'dismissed' | 'needs-evidence' | 'converted-to-action';
export interface CoachingSignal {
  schema: 'moetracker.coaching-workflow/v1';
  generatorVersion: 1;
  id: string;
  fingerprint: string;
  blockId: string;
  matchIds: string[];
  type: 'pistol-conversion' | 'full-buy-loss' | 'anti-eco-loss' | 'low-buy-win' | 'first-death-collapse' | 'repeated-player-first-death' | 'advantage-collapse' | 'map-underperformance' | 'evidence-health' | 'failed-trade-spacing' | 'economy-mismatch' | 'post-plant-loss' | 'first-death-review' | 'utility-unused-review';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  explanation: string;
  metric: { value: number; samples: number; unit: string };
  context: { map?: string; side?: string; economy?: string; playerId?: string; player?: string; agent?: string; composition?: string; advantageStates?: string; evidenceDimension?: 'match-acceptance' | 'round-completeness' };
  evidence: { matchIds: string[]; roundIds?: string[]; sourceTypes: string[]; confidence: 'high' | 'medium' | 'low' };
  relatedActionId?: string;
  classificationCorrections?: Array<{ at: string; by: string; reason: string; original: { type: CoachingSignal['type']; context: CoachingSignal['context'] }; corrected: { type: CoachingSignal['type']; context: CoachingSignal['context'] } }>;
  status: CoachingSignalStatus;
  createdAt: string;
  updatedAt: string;
  audit: Array<{ at: string; by: string; from: CoachingSignalStatus | null; to: CoachingSignalStatus; reason?: string }>;
}

export interface CoachingAction {
  schema: 'moetracker.coaching-workflow/v1';
  id: string;
  sourceSignalId: string;
  sourceFingerprint: string;
  goalId?: string;
  evidence: CoachingSignal['evidence'];
  title: string;
  kind: 'player-feedback' | 'team-task' | 'vod-review' | 'strategy-board' | 'map-plan' | 'schedule-objective' | 'next-block-check';
  /** Set on a task the coach made straight from a reviewed round; such tasks have no source signal and no metric check. */
  sourceRound?: { matchId: string; roundNo: number; roundId: string | null; map: string; opponent: string; vodSeconds: number | null };
  ownerIds: string[];
  dueBlockId: string | null;
  dueDate: string | null;
  priority: 'high' | 'normal' | 'low';
  visibility: 'private' | 'staff' | 'team';
  state: 'planned' | 'assigned' | 'acknowledged' | 'in-progress' | 'review-next-block' | 'resolved' | 'cancelled';
  check: null | {
    policyVersion?: number;
    signalType: CoachingSignal['type'];
    baseline: number;
    target: number;
    direction: 'increase' | 'decrease';
    unit?: string;
    minimumSamples?: number;
    sourceBlockId?: string;
    context?: CoachingSignal['context'];
  };
  checkHistory?: Array<{ migratedAt: string; migratedBy: string; reason: string; check: CoachingAction['check']; outcome: CoachingAction['outcome'] }>;
  outcome: null | { status: 'satisfied' | 'regressed' | 'inconclusive'; baseline: number; later: number | null; change: number | null; confidence: 'high' | 'medium' | 'low'; evaluatedAt: string; reason: string };
  createdAt: string;
  updatedAt: string;
  audit: Array<{ at: string; by: string; from: CoachingAction['state'] | null; to: CoachingAction['state']; reason?: string }>;
}

export interface DashboardView {
  schema: 'moetracker.dashboard-view/v1';
  id: string;
  name: string;
  ownerId: string;
  scope: 'personal' | 'team';
  version: 1;
  preset: string;
  cards: Array<{ id: string; size: string; minimized: boolean }>;
  filters: { blockId: string | null; map: string | null; source: string | null; confidence: string | null };
  updatedAt: string;
}

export interface TryoutDecisionNote {
  schema: 'moetracker.tryout-decision-note/v1';
  id: string;
  playerId: string;
  text: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  history?: Array<{ text: string; changedAt: string; changedBy: string }>;
  removedAt?: string;
  removedBy?: string;
}

export interface PlayerStats {
  id: string;
  matchId: string;
  player: string;
  agent: string;
  roleSnapshot?: string;
  kAtt: number | null;
  kDef: number | null;
  dAtt: number | null;
  dDef: number | null;
  aAtt: number | null;
  aDef: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  acs?: number | null;
  adr?: number | null;
  hs?: number | null;
  headshots?: number | null;
  headshotEligibleKills?: number | null;
  orbPoints?: number | null;
  ultimateUses?: number | null;
  kastSuccessful?: number | null;
  kastCovered?: number | null;
  fk?: number | null;
  fd?: number | null;
  /** Set when FD was materialized from complete round evidence, so later round edits may refresh it. */
  fdDerivedFrom?: 'round-evidence';
  rating?: string | number | null;
  performanceScore?: number | null;
  /** Scoreboard TRADES column (competitive layout only). */
  trades?: number | null;
  headToHead?: Array<{ opponent: string | null; kills: number; deaths: number; assists: number }>;
  plants?: number;
  defuses?: number;
  cl?: number;
  clAtt?: number;
  mk3?: number;
  mk4?: number;
  mk5?: number;
  dTraded?: number;
  kTraded?: number;
  playerId?: string;
  displayNameSnapshot?: string;
  appearanceType?: AppearanceType;
  rowOperation?: 'create';
  sourceMetadata?: EntrySourceMetadata;
  /** Derived website-safe opening-stat provenance; contains no actor or provider detail. */
  comparisonEvidence?: { openingAccepted: boolean };
  corrections?: EntryCorrectionMetadata[];
  /** Coach-accepted aggregates derived from round screenshots. Raw images stay local. */
  screenshotMetrics?: PlayerScreenshotMetrics;
  vodEvidence?: {
    submissionIds: string[]; fields: string[]; updatedAt: string;
    timeline?: { submissionId: string; grade: 'video-observation'; coverage: Record<string, 'complete' | 'partial' | 'unsupported'>; metrics: Record<string, number | null> };
  };
}

export type EvidenceConfidence = 'confirmed' | 'high' | 'medium' | 'low';
export type EconomyClass = 'eco' | 'low' | 'half' | 'full' | 'unknown';

export interface ScreenshotKillEvent {
  sequence: number;
  /** Zero-based visual row in the VALORANT event log. */
  sourceRow?: number | null;
  /** Seconds elapsed in the round, when the event clock was legible. */
  occurredAtSeconds?: number | null;
  killerPlayerId?: string | null;
  victimPlayerId?: string | null;
  killerTeam?: 'ours' | 'theirs' | null;
  victimTeam?: 'ours' | 'theirs' | null;
  weapon?: string | null;
  distanceMeters?: number | null;
  tradedWithinSeconds?: number | null;
}

/** A "Planted"/"Defused" row in the round event log. */
export interface ScreenshotObjectiveEvent {
  type: 'plant' | 'defuse' | null;
  sourceRow?: number | null;
  playerId?: string | null;
  team?: 'ours' | 'theirs' | null;
  occurredAtSeconds?: number | null;
}

export interface ScreenshotPlayerRoundEvidence {
  playerId?: string | null;
  displayName: string;
  team: 'ours' | 'theirs';
  equippedWeapon?: string | null;
  armor?: string | null;
  loadoutValue?: number | null;
  bank?: number | null;
  kills?: number | null;
  assists?: number | null;
  survived?: boolean | null;
}

export interface RoundScreenshotEvidence {
  schemaVersion: 1;
  reviewStatus: 'review-required' | 'confirmed';
  confidence: EvidenceConfidence;
  sourceImage?: string;
  displayedRoundNo?: number | null;
  /** OCR confidence retained per crop so the review screen can target weak fields. */
  fieldConfidence?: Record<string, number | null>;
  extractionIssues?: string[];
  ourAverageLoadout?: number | null;
  enemyAverageLoadout?: number | null;
  ourAverageBank?: number | null;
  enemyAverageBank?: number | null;
  players: ScreenshotPlayerRoundEvidence[];
  /** True only when review confirmed that the event list covers the whole round. */
  eventsComplete?: boolean;
  /** True when the earliest kill row is fully identified, even if later kill rows are incomplete. */
  openingEventComplete?: boolean;
  events?: ScreenshotKillEvent[];
  /** Spike plant/defuse rows: actor, time and (implicitly) which side attacked. */
  objectives?: ScreenshotObjectiveEvent[];
}

export interface PlayerScreenshotMetrics {
  schemaVersion: 1;
  /** Immutable aggregate builder identity used for reproducible recomputation. */
  calculationVersion?: string;
  sourceHash?: string;
  unknownReasons?: string[];
  coveredRounds: number;
  wins: number;
  losses: number;
  firstKills: number;
  firstDeaths: number;
  /** Successful five-second trade kills resolved from complete kill-feed evidence. */
  trades?: number;
  multikills: { two: number; three: number; four: number; ace: number };
  lowBudgetWins: number;
  highBudgetLosses: number;
  antiEcoLosses: number;
  kast?: { successful: number; covered: number };
  weapons: Array<{ weapon: string; rounds: number; wins: number; kills: number; deaths: number }>;
}

export interface ScreenshotReviewDraft {
  contractVersion: 1;
  status: 'review-required';
  reviewRequired: true;
  sourceMetadata: EntrySourceMetadata;
  match: {
    opponent: string;
    type: string;
    map: string | null;
    ourScore: number | null;
    theirScore: number | null;
    alliedSideConfirmed: boolean;
    attW: null;
    attL: null;
    defW: null;
    defL: null;
  };
  stats: Array<{
    extractedName: string;
    matchedPlayerId: string | null;
    matchedPlayerName: string | null;
    rosterMatch: {
      status: 'matched' | 'ambiguous' | 'unmatched';
      candidatePlayerIds: string[];
      candidatePlayerNames: string[];
    };
    agent: string | null;
    kAtt: null;
    kDef: null;
    dAtt: null;
    dDef: null;
    aAtt: null;
    aDef: null;
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    acs: number | null;
    adr: number | null;
    hs: number | null;
    fk: number | null;
    fd: number | null;
    plants: number | null;
    defuses: number | null;
    rawMetrics?: Record<string, string>;
    rawConfidence?: Record<string, number | null>;
    performanceScore?: number | null;
    trades?: number | null;
    headToHead?: Array<{ opponent: string | null; kills: number; deaths: number; assists: number }>;
  }>;
  rounds: Array<{ roundNo: number; result: 'W' | 'L'; winBy: string | null }>;
}

export type MatchStatsUpdate =
  | { operation: 'preserve' }
  | { operation: 'replace'; stats: Partial<PlayerStats>[] };

export interface SoloQ {
  id: string;
  date: string;
  player: string;
  wins: number;
  losses: number;
  rank?: string;
  rr?: number | string;
  source?: string;
}

export interface Round {
  id: string;
  matchId: string;
  roundNo: number;
  side: string;
  buy?: string;
  enemyBuy?: string;
  result: string;
  winBy?: string;
  plant?: string;
  site?: string;
  notes?: string;
  isThrow?: string;
  thrownBy?: string;
  throwReason?: string;
  firstKillBy?: string;
  firstDeathBy?: string;
  clutchType?: string; // "1v1", "1v2", "1v3"
  clutchPlayer?: string;
  clutchResult?: string; // "W" or "L"
  iglPlayer?: string;
  iglRole?: string; // "Primary" or "Secondary"
  midRoundIglChange?: boolean | string;
  strategies?: string; // Comma-separated strategies run
  screenshotEvidence?: RoundScreenshotEvidence;
  advantageEvidence?: import('../lib/roundAdvantage').RoundAdvantageEvidence;
  vodEvidence?: { sourceSubmissionIds: string[]; roundNumber: number; observations: unknown[]; updatedAt: string };
  replayEvidence?: { tradeOpportunities: number | null; successfulTrades: number | null; tacticalAssessment: string };
  reviewCockpit?: {
    note?: string;
    classifications?: Array<{
      type: import('../lib/roundReviewCockpit').ReviewClassificationType;
      status: 'confirmed' | 'dismissed';
      player?: string | null;
      reason?: string;
      updatedAt: string;
      updatedBy: string;
    }>;
    classificationHistory?: Array<{
      type: import('../lib/roundReviewCockpit').ReviewClassificationType;
      status: 'confirmed' | 'dismissed';
      player?: string | null;
      reason?: string;
      at: string;
      by: string;
    }>;
    factCorrections?: Array<{
      field: 'side' | 'result' | 'buy' | 'enemyBuy' | 'winBy' | 'plant' | 'site' | 'firstKillBy' | 'firstDeathBy';
      previousValue: string | null;
      value: string | null;
      reason: string;
      at: string;
      by: string;
    }>;
    clips?: Array<{ id: string; fileName: string; label: string; startMs: number; endMs: number; createdAt: string }>;
    updatedAt: string;
  };
}

export interface AttendanceAuditEntry {
  id: string;
  playerId: string;
  action: 'player-check-in' | 'coach-correction' | 'coach-clear';
  fromStatus?: AttendanceCheckIn['status'] | 'automatic';
  toStatus?: AttendanceCheckIn['status'] | 'automatic';
  reason?: string;
  createdAt: string;
  createdBy: string;
}

export interface Veto {
  id: string;
  matchId: string;
  date: string;
  opponent: string;
  seq: number;
  actor: string;
  action: string;
  map: string;
  result?: string;
}

export interface Strat {
  id: string;
  map: string;
  side: string;
  name: string;
  notes?: string;
  active: string | boolean;
}

export interface StratRun {
  id: string;
  stratId: string;
  matchId?: string;
  date: string;
  map: string;
  side: string;
  result: string;
  reason?: string;
}

export interface TrackerData {
  authenticatedViewer?: { playerId: string | null };
  settings: Settings;
  rosterPlayers: RosterPlayer[];
  identityCorrectionBatches?: IdentityCorrectionBatch[];
  coreMemberships: CoreMembership[];
  tryoutBatches: TryoutBatch[];
  practiceBlocks?: PracticeBlock[];
  coachingSignals?: CoachingSignal[];
  coachingActions?: CoachingAction[];
  dashboardViews?: DashboardView[];
  tryoutDecisionNotes?: TryoutDecisionNote[];
  seasonArchives: SeasonArchive[];
  secrets: Record<string, boolean>;
  schedule: Schedule[];
  attendanceCredits?: AttendanceCredit[];
  goals: Goal[];
  matches: Match[];
  playerStats: PlayerStats[];
  soloq: SoloQ[];
  rounds: Round[];
  analyticsBuilds?: Record<string, unknown>;
  evidenceFusionResolutions?: import('../lib/evidenceFusion').EvidenceFusionResolution[];
  calibratedPlayerRatings?: import('../lib/calibratedPlayerRatings').CalibratedPlayerRating[];
  canonicalDataSpine?: import('../lib/canonicalDataSpine').CanonicalDataSpine;
  vetos: Veto[];
  strats: Strat[];
  stratRuns: StratRun[];
  vodReviews?: VodReview[];
  vodSubmissions?: VodSubmission[];
  lineups?: Lineup[];
  serverTime: string;
}

export interface ThreadReply {
  id: string;
  text: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface VodNote {
  id: string;
  seconds: number;
  timeLabel: string;
  text: string;
  name: string;
  role: string;
  createdAt: string;
  roundNo?: number;
  replies: ThreadReply[];
}

export interface VodReview {
  id: string;
  matchId?: string;
  title: string;
  vodUrl: string;
  date?: string;
  createdAt?: string;
  syncOffsetSeconds?: number;
  notes: VodNote[];
}

export interface VodSubmissionPlayer {
  observedName: string;
  rosterPlayerId: string;
  rosterDisplayName: string;
  agent: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  acs: number | null;
  adr: number | null;
  hs: number | null;
  fk: number | null;
  fd: number | null;
  plants: number | null;
  defuses: number | null;
  trades: number | null;
}

export interface VodTimelineEvidence {
  schema: 'moetracker.vod-timeline-evidence/v1' | 'moetracker.vod-timeline-evidence/v2';
  grade: 'video-observation';
  source: { kind: 'youtube' | 'local-file'; videoId?: string | null; sha256: string; width: number; height: number; durationMs: number; analyzedAt: string };
  coverage: { durationMs: number; killFeedSnapshots: number; objectiveSnapshots: number; ultimateSnapshots: number; roundStateSnapshots?: number; scoreboardSnapshots?: number; resolvedEliminations: number; inferredRoundGroups: number; temporalAmbiguities?: number; roundDetection?: { mode: 'authoritative' | 'inferred'; confidence: number; detectedRounds: number }; signals: Record<string, 'complete' | 'partial' | 'unsupported'> };
  observations: Array<{ id: string; kind: string; timestampMs: number; confidence?: number | null; grade: 'video-observation' | 'ocr'; killer?: string; victim?: string; player?: string; rawText?: string; [key: string]: unknown }>;
  rounds: Array<{ roundNumber: number; startedAtMs: number; endedAtMs: number; events: unknown[]; scoreBefore?: number[] | null; winner?: string | null; boundarySource?: string }>;
  playerMetrics: Array<{ playerName: string; team: 'ours' | 'theirs'; kills: number; deaths: number; trades: number; ultimateUses?: number | null; orbCaptures?: number | null; kastSuccessful?: number | null; kastCovered?: number | null; kastRate?: number | null }>;
  throwCandidates: unknown[];
  limitations: string[];
  observerSegments?: Array<{ player: string; startedAtMs: number; endedAtMs: number; confidence: number; source: string }>;
  reconciliation?: { status: 'matched' | 'conflict' | 'partial'; comparedFields: number; conflicts: unknown[]; scoreboardRows: unknown[] };
  sourceSet?: VodTimelineEvidence['source'][];
  fusion?: { sourceCount: number; fusedAt: string; conflicts: unknown[] };
}

export interface VodSubmission {
  schema: 'moetracker.vod-submission/v1';
  id: string;
  submittedByPlayerId: string | null;
  submittedByName: string;
  vodUrl: string;
  imageSha256: string;
  date: string;
  map: string | null;
  opponent: string | null;
  ourScore: number | null;
  theirScore: number | null;
  requestedMatchId: string | null;
  linkedMatchId: string;
  linkMode: 'existing-match' | 'new-match';
  status: 'integrated';
  rosterMatchCount: number;
  players: VodSubmissionPlayer[];
  timelineEvidence?: VodTimelineEvidence | null;
  integration: { createdMatch: boolean; createdStats: number; filledFields: number; preservedFields: number };
  createdAt: string;
  integratedAt: string;
}

export interface Lineup {
  id: string;
  map: string;
  agent: string;
  side: string;
  ability?: string;
  site?: string;
  title: string;
  description?: string;
  imageUrl?: string;
  videoUrl?: string;
  createdAt?: string;
  comments: ThreadReply[];
}
