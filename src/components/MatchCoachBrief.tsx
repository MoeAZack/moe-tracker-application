import { useState } from 'react';
import { Match } from '../types';
import { apiFetch } from '../utils/api';
import { Check, Sparkles, Send, Copy, Loader2 } from 'lucide-react';
import { notify } from '../utils/appDialogs';
import { CLOUD_AI_OFF_MESSAGE, cloudAiActionBlocked, cloudAiErrorMessage, useCloudAiAvailable } from '../utils/cloudAi';

interface Props {
  selectedMatch: Match & { aiAnalysis?: any };
  setSelectedMatch: (update: any) => void;
  onRefreshDatabase: (() => Promise<void>) | undefined;
}

/** Match Review's AI coach brief and Discord broadcast for one match. */
export default function MatchCoachBrief({ selectedMatch, setSelectedMatch, onRefreshDatabase }: Props) {
  const [analyzingMatch, setAnalyzingMatch] = useState(false);
  const cloudAiAvailable = useCloudAiAvailable();
  const [aiLoadMsg, setAiLoadMsg] = useState('');
  const [discordBroadcasting, setDiscordBroadcasting] = useState(false);
  const [discordCopyPayload, setDiscordCopyPayload] = useState('');
  const [discordStatusMsg, setDiscordStatusMsg] = useState('');
  const [discordStatusType, setDiscordStatusType] = useState<'success' | 'info' | 'error' | null>(null);
  const [copiedStatus, setCopiedStatus] = useState(false);

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Status Banner */}
      {discordStatusMsg && (
        <div className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between gap-3 ${
          discordStatusType === 'success' 
            ? 'bg-green-500/10 border-green-500/20 text-green-400' 
            : discordStatusType === 'error'
            ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
        }`}>
          <span>{discordStatusMsg}</span>
          <button 
            onClick={() => setDiscordStatusMsg('')} 
            className="text-xs font-bold hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Manual Copy Area if Webhook Not Configured */}
      {discordCopyPayload && (
        <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 space-y-2.5">
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-blue-400 uppercase font-black">Copy Discord Payload</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(discordCopyPayload);
                setCopiedStatus(true);
                setTimeout(() => setCopiedStatus(false), 2000);
              }}
              className="px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white font-mono text-xs font-black rounded flex items-center gap-1.5 cursor-pointer"
            >
              {copiedStatus ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copiedStatus ? 'Copied!' : 'Copy markdown'}
            </button>
          </div>
          <p className="text-xs text-gray-400 font-mono leading-normal">The Discord webhook is not set up in Settings. Copy the markdown report below to paste it manually into your team Discord:</p>
          <textarea
            readOnly
            value={discordCopyPayload}
            className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs font-mono text-gray-400 h-24 focus:outline-none"
          />
        </div>
      )}

      {/* Actions Header */}
      <div className="flex justify-between items-center border-b border-white/5 pb-3 gap-2">
        <span className="text-xs text-gray-500 uppercase font-black font-mono">
          AI Coach Tactical Brief
        </span>
        <div className="flex gap-2 shrink-0">
          <button
            disabled={cloudAiActionBlocked(cloudAiAvailable, analyzingMatch)}
            title={cloudAiAvailable === false ? CLOUD_AI_OFF_MESSAGE : undefined}
            onClick={async () => {
              setAnalyzingMatch(true);
              setDiscordCopyPayload('');
              setDiscordStatusMsg('');
              const loadPrompts = [
                'Analyzing entry conversion rates...',
                'Reviewing round-throw vectors...',
                'Evaluating stratbook effectiveness...',
                'Formulating roster alignment reviews...'
              ];
              let idx = 0;
              setAiLoadMsg(loadPrompts[0]);
              const interval = setInterval(() => {
                idx = (idx + 1) % loadPrompts.length;
                setAiLoadMsg(loadPrompts[idx]);
              }, 2000);

              try {
                const res = await apiFetch('/api/gemini/analyze-match', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ matchId: selectedMatch.id })
                });
                if (!res.ok) throw new Error(await cloudAiErrorMessage(res, 'The AI analysis failed. Nothing was saved.'));
                const resJson = await res.json();

                // Trigger full parent refresh
                if (onRefreshDatabase) {
                  await onRefreshDatabase();
                }

                // Update our selectedMatch local state ref
                setSelectedMatch(prev => prev ? { ...prev, aiAnalysis: resJson.aiAnalysis } : null);
              } catch (err: any) {
                notify(err.message || 'Failed to analyze match.', 'error');
              } finally {
                clearInterval(interval);
                setAnalyzingMatch(false);
              }
            }}
            className="px-2.5 py-1 text-xs font-black bg-white/5 border border-white/10 rounded hover:bg-white/10 font-mono flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            {analyzingMatch ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>{selectedMatch.aiAnalysis ? 'REGENERATE' : 'GENERATE ANALYSIS'}</span>
              </>
            )}
          </button>

          {selectedMatch.aiAnalysis && (
            <button
              disabled={discordBroadcasting}
              onClick={async () => {
                setDiscordBroadcasting(true);
                setDiscordStatusMsg('Broadcasting scrim report card to Discord...');
                setDiscordStatusType('info');
                try {
                  const res = await apiFetch('/api/broadcast-discord', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ matchId: selectedMatch.id })
                  });
                  if (!res.ok) throw new Error('Broadcasting failed.');
                  const resJson = await res.json();
                  if (resJson.success) {
                    setDiscordStatusMsg('🏆 Scrim report successfully posted to Discord channel!');
                    setDiscordStatusType('success');
                  } else {
                    setDiscordStatusMsg('⚠️ Webhook not configured. Markdown copy payload generated below.');
                    setDiscordStatusType('info');
                    setDiscordCopyPayload(resJson.markdown || '');
                  }
                } catch (err: any) {
                  setDiscordStatusMsg(`❌ Discord broadcast failed: ${err.message}`);
                  setDiscordStatusType('error');
                } finally {
                  setDiscordBroadcasting(false);
                }
              }}
              className="px-2.5 py-1 text-xs font-black bg-[#ff4655]/10 border border-[#ff4655]/20 hover:bg-[#ff4655] text-white hover:border-[#ff4655] rounded font-mono flex items-center gap-1.5 cursor-pointer"
            >
              {discordBroadcasting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
              <span>Discord</span>
            </button>
          )}
        </div>
      </div>

      {/* Brief View Body */}
      {analyzingMatch ? (
        <div className="py-12 text-center space-y-3.5 border border-dashed border-white/5 rounded-xl bg-black/10">
          <div className="w-8 h-8 mx-auto rounded-full bg-[#ff4655]/10 flex items-center justify-center text-[#ff4655]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold text-white font-mono uppercase tracking-wider">Scrim Analyst Engine Active</p>
            <p className="text-xs text-gray-500 font-mono animate-pulse">{aiLoadMsg}</p>
          </div>
        </div>
      ) : selectedMatch.aiAnalysis ? (
        <div className="p-5 rounded-xl border border-white/5 bg-black/25 text-left max-h-[500px] overflow-y-auto space-y-2 select-text">
          {selectedMatch.aiAnalysis.split('\n').map((line, idx) => {
            const cleanLine = line.trim();
            if (cleanLine.startsWith('###')) {
              return <h5 key={idx} className="text-xs font-black text-violet-400 mt-4 mb-2 uppercase font-mono tracking-wide">{cleanLine.replace('###', '').replace(/[\*#]/g, '').trim()}</h5>;
            }
            if (cleanLine.startsWith('##')) {
              return <h4 key={idx} className="text-xs font-black text-white mt-5 mb-2 uppercase border-b border-white/5 pb-1 tracking-tight font-mono">{cleanLine.replace('##', '').replace(/[\*#]/g, '').trim()}</h4>;
            }
            if (cleanLine.startsWith('#')) {
              return <h3 key={idx} className="text-sm font-black text-[#ff4655] mt-6 mb-3 uppercase tracking-tighter italic font-mono">{cleanLine.replace('#', '').replace(/[\*#]/g, '').trim()}</h3>;
            }
            if (cleanLine.startsWith('-') || cleanLine.startsWith('*')) {
              const content = cleanLine.substring(1).trim();
              const parts = content.split('**');
              return (
                <div key={idx} className="flex items-start gap-2 text-xs font-mono text-gray-300 leading-relaxed my-1.5 pl-2">
                  <span className="text-[#ff4655] select-none font-sans">▪</span>
                  <span>
                    {parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-white font-black">{part}</strong> : part)}
                  </span>
                </div>
              );
            }
            if (cleanLine === '') {
              return <div key={idx} className="h-1.5" />;
            }
            const parts = cleanLine.split('**');
            return (
              <p key={idx} className="text-xs font-mono text-gray-300 leading-relaxed my-1">
                {parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-white font-black">{part}</strong> : part)}
              </p>
            );
          })}
        </div>
      ) : (
        <div className="py-12 text-center space-y-4 border border-dashed border-white/5 bg-black/10 rounded-xl">
          <div className="w-10 h-10 mx-auto rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div className="max-w-xs mx-auto space-y-1">
            <p className="text-xs font-black text-white uppercase tracking-tight">Generate Scrim Report Card</p>
            <p className="text-xs text-gray-500 leading-relaxed font-mono">Dissect round logs, space conversions, economic efficiency, throw triggers, and caller reviews automatically with Gemini.</p>
            {cloudAiAvailable === false && <p className="text-xs text-amber-300 leading-relaxed">{CLOUD_AI_OFF_MESSAGE}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
