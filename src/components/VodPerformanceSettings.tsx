import { Cpu } from 'lucide-react';

type VodPerformance = { ocrWorkers: 'auto' | number; hardwareDecode: boolean; cpus: number; maxOcrWorkers: number };

// VOD import speed. Auto uses up to four cores and only what free memory
// allows; 1 thread is the original one-at-a-time reading.
export default function VodPerformanceSettings({
  value,
  disabled,
  onChange,
}: {
  value?: VodPerformance;
  disabled?: boolean;
  onChange: (input: { ocrWorkers: 'auto' | number; hardwareDecode: boolean }) => void;
}) {
  const ocrWorkers = value?.ocrWorkers ?? 'auto';
  const hardwareDecode = value?.hardwareDecode === true;
  const limit = Math.max(1, Math.min(value?.maxOcrWorkers || 8, value?.cpus || 1));
  const choices = Array.from({ length: limit }, (_, index) => index + 1);
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/10 p-4">
      <div className="flex items-start gap-3">
        <Cpu className="mt-0.5 h-5 w-5 text-cyan-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">VOD import speed</p>
          <p className="mt-1 text-xs text-gray-400">
            More reading threads finish imports sooner but use more memory. Auto picks a safe number for this PC ({value?.cpus || '?'} cores) and never
            starts more than free memory allows. Choose 1 if imports crash or the PC slows down.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-gray-300">Reading threads</span>
              <select
                aria-label="VOD reading threads"
                className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs"
                value={String(ocrWorkers)}
                disabled={disabled || !value}
                onChange={event => onChange({ ocrWorkers: event.target.value === 'auto' ? 'auto' : Number(event.target.value), hardwareDecode })}
              >
                <option value="auto">Auto</option>
                {choices.map(count => (
                  <option key={count} value={String(count)}>
                    {count === 1 ? '1 (slowest, lightest)' : String(count)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                aria-label="Use graphics card to decode VODs"
                checked={hardwareDecode}
                disabled={disabled || !value}
                onChange={event => onChange({ ocrWorkers, hardwareDecode: event.target.checked })}
              />
              <span className="text-gray-300">Use the graphics card to decode video (falls back to normal decoding if it fails)</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
