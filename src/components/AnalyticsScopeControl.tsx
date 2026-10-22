import React from 'react';
import type { AnalyticsMapScope, AnalyticsMapScopeContext } from '../utils/activeMapPool';

export default function AnalyticsScopeControl({ scope, context, onChange }: {
  scope: AnalyticsMapScope;
  context: AnalyticsMapScopeContext;
  onChange: (scope: AnalyticsMapScope) => void;
}) {
  const activeDetail = context.emptyActivePool
    ? 'No usable active maps are configured, so active-pool analytics show 0 matches.'
    : `Showing ${context.includedMatchCount} of ${context.sourceMatchCount} matches across ${context.configuredActiveMapCount} active maps.`;
  const unknownWarning = context.unknownMatchCount > 0
    ? ` ${context.unknownMatchCount} match${context.unknownMatchCount === 1 ? '' : 'es'} had an unknown map and ${context.unknownMatchCount === 1 ? 'was' : 'were'} excluded.`
    : '';
  const conflictWarning = context.contradictoryMaps.length > 0
    ? ` ${context.contradictoryMaps.length} map setting${context.contradictoryMaps.length === 1 ? '' : 's'} conflicted; active status won.`
    : '';

  return (
    <section className="liquid-subtle rounded-xl border border-cyan-400/20 p-4" aria-label="Analytics map scope">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,1.1fr)] lg:items-end">
        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs font-black uppercase tracking-widest text-cyan-300">Analytics map scope</legend>
          <div className="grid gap-2 sm:grid-cols-2">
          <label className={`ui-button flex min-h-11 cursor-pointer items-center justify-center px-3 py-2 text-center text-xs font-bold ${scope === 'all' ? 'text-white ring-1 ring-cyan-400/50' : 'text-gray-400'}`}>
            <input className="sr-only" type="radio" name="analytics-map-scope" value="all" checked={scope === 'all'} onChange={() => onChange('all')} />
            All recorded / practice maps
          </label>
          <label className={`ui-button flex min-h-11 cursor-pointer items-center justify-center px-3 py-2 text-center text-xs font-bold ${scope === 'active' ? 'text-white ring-1 ring-cyan-400/50' : 'text-gray-400'}`}>
            <input className="sr-only" type="radio" name="analytics-map-scope" value="active" checked={scope === 'active'} onChange={() => onChange('active')} />
            Configured active map pool
          </label>
          </div>
        </fieldset>
        <p className="min-h-11 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs leading-relaxed text-slate-300" role="status" aria-live="polite">
          {scope === 'all'
            ? `Showing all ${context.sourceMatchCount} matches in this analytics phase. Practice and non-competitive maps are included.`
            : `${activeDetail}${unknownWarning}${conflictWarning}`}
          {' '}Match logs and evidence always keep every recorded map.
        </p>
      </div>
    </section>
  );
}
