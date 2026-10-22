import React, { useState } from 'react';
import { OCR_ENGINE_IDS, OCR_ENGINE_LABELS, type OcrEngineId } from '../../lib/ocrEngines';
import { glyphTemplateCounts } from '../../lib/glyphTemplates';
import { getOcrEngineSetting, loadGlyphTemplates, resetGlyphTemplates, setOcrEngineSetting } from '../utils/ocrEngineSetting';
import { confirmDialog } from '../utils/appDialogs';

/** Settings → OCR health & learning: which engine reads scoreboard numbers on this PC. */
export default function OcrEngineSetting({ isLight }: { isLight: boolean }) {
  const [engine, setEngine] = useState<OcrEngineId>(getOcrEngineSetting);
  const [learned, setLearned] = useState(() => Object.entries(glyphTemplateCounts(loadGlyphTemplates())));
  const card = isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-black/20';
  return (
    <fieldset className={`rounded-xl border p-4 ${card}`}>
      <legend className="px-1 text-xs font-black uppercase tracking-wider">Number reader</legend>
      <p className="text-xs text-slate-400">
        Which engine reads K/D/A, scores and other numbers on this PC. Everything runs offline. Names are always read by Tesseract. Each engine learns its own
        corrections, so a switch starts learning for that engine from zero.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {OCR_ENGINE_IDS.map(id => (
          <label key={id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${engine === id ? 'border-cyan-400/60' : isLight ? 'border-slate-200' : 'border-white/10'}`}>
            <input
              type="radio"
              name="ocr-engine"
              value={id}
              checked={engine === id}
              onChange={() => setEngine(setOcrEngineSetting(id))}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold">{OCR_ENGINE_LABELS[id].label}{id === 'tesseract' ? ' (default)' : ''}</span>
              <span className="block text-slate-400">{OCR_ENGINE_LABELS[id].detail}</span>
            </span>
          </label>
        ))}
      </div>
      {engine === 'ensemble' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            Digit templates learned from your scoreboards:{' '}
            {learned.length ? learned.map(([resolution, digits]) => `${digits}/10 digits at ${resolution}`).join(' · ') : 'none yet. They start voting once each digit has been seen three times.'}
          </span>
          {learned.length > 0 && (
            <button
              type="button"
              className="ui-button min-h-10 px-3 text-xs"
              onClick={async () => {
                if (!(await confirmDialog('Forget the learned digit templates? Ensemble will relearn them from your next scoreboards.', { destructive: true, confirmLabel: 'Forget' }))) return;
                resetGlyphTemplates(); setLearned([]);
              }}
            >
              Forget templates
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}
