import { STAT_SOURCE_LABELS, type StatSourceKind } from '../../lib/statSource';

const TONE: Record<StatSourceKind, string> = {
  replay: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-200',
  screenshot: 'border-violet-300/30 bg-violet-300/10 text-violet-200',
  vod: 'border-sky-300/30 bg-sky-300/10 text-sky-200',
  live: 'border-rose-300/30 bg-rose-300/10 text-rose-200',
  manual: 'border-slate-300/25 bg-slate-300/10 text-slate-200',
  import: 'border-amber-300/30 bg-amber-300/10 text-amber-200',
  unknown: '',
};

/** Where these numbers came from. Shows nothing when the entry does not say. */
export default function SourceChip({ kind }: { kind: StatSourceKind }) {
  if (kind === 'unknown') return null;
  const { label, detail } = STAT_SOURCE_LABELS[kind];
  return <span title={detail} className={`inline-flex items-center rounded-full border px-2 py-0.5 font-sans text-xs font-semibold normal-case tracking-normal ${TONE[kind]}`}><span className="sr-only">Source: </span>{label}</span>;
}
