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
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6" aria-label="Analytics map scope">
      <div className="liquid-subtle flex flex-col gap-3 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="mb-1 w-full text-[10px] font-bold uppercase tracking-widest text-gray-400 sm:mb-0 sm:mr-2 sm:w-auto">Analytics map scope</legend>
          <label className={`ui-button min-h-11 cursor-pointer px-3 py-2 text-xs font-bold ${scope === 'all' ? 'text-white ring-1 ring-cyan-400/50' : 'text-gray-400'}`}>
            <input className="sr-only" type="radio" name="analytics-map-scope" value="all" checked={scope === 'all'} onChange={() => onChange('all')} />
            All recorded / practice maps
          </label>
          <label className={`ui-button min-h-11 cursor-pointer px-3 py-2 text-xs font-bold ${scope === 'active' ? 'text-white ring-1 ring-cyan-400/50' : 'text-gray-400'}`}>
            <input className="sr-only" type="radio" name="analytics-map-scope" value="active" checked={scope === 'active'} onChange={() => onChange('active')} />
            Configured active map pool
          </label>
        </fieldset>
        <p className="max-w-xl text-xs leading-relaxed text-slate-300" role="status" aria-live="polite">
          {scope === 'all'
            ? `Showing all ${context.sourceMatchCount} matches in this analytics phase. Practice and non-competitive maps are included.`
            : `${activeDetail}${unknownWarning}${conflictWarning}`}
          {' '}Match logs and evidence always keep every recorded map.
        </p>
      </div>
    </section>
  );
}
