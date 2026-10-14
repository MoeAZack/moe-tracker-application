import React, { useEffect, useState } from 'react';
import { CheckCircle, Loader2, Save } from 'lucide-react';

type SecretKey = 'GEMINI_API_KEY' | 'GRID_API_KEY' | 'DISCORD_WEBHOOK_URL';
const rows: Array<{ key: SecretKey; label: string; placeholder: string; help: string }> = [
  { key: 'GEMINI_API_KEY', label: 'Gemini API key', placeholder: 'Paste a new local key', help: 'Used by AI coaching features on this PC.' },
  { key: 'GRID_API_KEY', label: 'Official GRID.gg API key', placeholder: 'Paste a new local key', help: 'Stored now; GRID ingestion remains gated until the team feed and schema are activated.' },
  { key: 'DISCORD_WEBHOOK_URL', label: 'Discord webhook URL', placeholder: 'Paste a new local webhook', help: 'Sends automatic match reports from this PC.' },
];

export default function DesktopIntegrationSecrets() {
  const bridge = window.moeDesktop;
  const [configured, setConfigured] = useState<Record<SecretKey, boolean>>({ GEMINI_API_KEY: false, GRID_API_KEY: false, DISCORD_WEBHOOK_URL: false });
  const [values, setValues] = useState<Record<SecretKey, string>>({ GEMINI_API_KEY: '', GRID_API_KEY: '', DISCORD_WEBHOOK_URL: '' });
  const [busy, setBusy] = useState<SecretKey | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!bridge?.getIntegrationSecretStatus) return;
    void bridge.getIntegrationSecretStatus().then(status => setConfigured(status.configured)).catch(error => setMessage(error.message || 'Could not read integration status.'));
  }, [bridge]);
  if (!bridge) return <div className="rounded-lg border border-white/10 bg-black/15 p-3 text-[10px] leading-relaxed text-gray-400">Website secrets are managed in <strong className="text-gray-200">Cloudflare → Workers & Pages → moe-tracker → Settings → Variables and Secrets</strong>. Add each value as an encrypted secret; never place it in the website database.</div>;
  const save = async (key: SecretKey) => {
    setBusy(key); setMessage('');
    try {
      const result = await bridge.setIntegrationSecret({ key, value: values[key] });
      setConfigured(current => ({ ...current, [key]: result.configured }));
      setValues(current => ({ ...current, [key]: '' }));
      setMessage(result.configured ? 'Saved securely for this Windows user. The local service restarted with the new value.' : 'Local secret removed.');
    } catch (error: any) { setMessage(error.message || 'Could not save this secret.'); }
    finally { setBusy(null); }
  };
  return <div className="space-y-3">{rows.map(row => <div key={row.key} className="rounded-lg border border-white/10 bg-black/10 p-3"><div className="flex items-center justify-between gap-3"><label className="text-[10px] font-black uppercase text-gray-400">{row.label}</label>{configured[row.key] && <span className="inline-flex items-center gap-1 text-[9px] text-emerald-300"><CheckCircle className="h-3 w-3" />Configured locally</span>}</div><div className="mt-2 flex gap-2"><input type="password" autoComplete="off" value={values[row.key]} onChange={event => setValues(current => ({ ...current, [row.key]: event.target.value }))} placeholder={configured[row.key] ? 'Enter a replacement, or save blank to remove' : row.placeholder} className="min-w-0 flex-1 rounded border border-white/10 bg-black/25 p-2.5 text-xs text-white"/><button type="button" disabled={busy !== null} onClick={() => void save(row.key)} className="ui-button min-w-20 justify-center px-3 text-xs">{busy === row.key ? <Loader2 className="h-4 w-4 animate-spin"/> : <><Save className="h-3.5 w-3.5"/>Save</>}</button></div><p className="mt-1.5 text-[9px] leading-relaxed text-gray-500">{row.help} Values are encrypted with Windows and never shown again.</p></div>)}{message && <p className="text-[10px] text-cyan-200">{message}</p>}</div>;
}
