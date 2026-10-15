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
}

export interface RosterPlayer {
  id: string;
  displayName: string;
  createdAt: string;
  rosterStatus?: AppearanceType;
  retiredAt?: string;
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
  tryoutsMode?: boolean;
  activeTryoutBatchId?: string | null;
  players: string[];
  maps: string[];
  agents: string[];
  inactivePlayers?: string[];
  inactiveMaps?: string[];
  inactiveAgents?: string[];
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
  };
  weights: WeightsConfig;
  buyTypes: string[];
  winReasons: string[];
  sites: string[];
  vetoActions: string[];
  stats?: StatsConfig;
}

export interface Schedule {
  id: string;
  date: string;
  kind?: string;
  primary: string;
  secondary?: string;
  notes?: string;
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
  source?: 'manual' | 'pracc';
  sourceEventId?: string;
  calendarKey?: string;
  gcalEventId?: string;
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
}

export type EntrySourceMethod = 'manual' | 'screenshot' | 'live-logger' | 'provider-import' | 'unknown';

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
  fk?: number | null;
  fd?: number | null;
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
  coreMemberships: CoreMembership[];
  tryoutBatches: TryoutBatch[];
  practiceBlocks?: PracticeBlock[];
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
  vetos: Veto[];
  strats: Strat[];
  stratRuns: StratRun[];
  vodReviews?: VodReview[];
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
  replies: ThreadReply[];
}

export interface VodReview {
  id: string;
  matchId?: string;
  title: string;
  vodUrl: string;
  date?: string;
  createdAt?: string;
  notes: VodNote[];
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
