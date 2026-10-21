import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { appDialogs, promptValueAccepted, type DialogRequest, type DialogState, type DialogStore } from '../utils/appDialogs';

/** Notices and the first queued confirmation or prompt, rendered from a store snapshot. */
export function AppDialogView({ state, onSettle, onDismiss }: { state: DialogState; onSettle: (id: number, value: boolean | string | null) => void; onDismiss: (id: number) => void }) {
  const request = state.dialogs[0];
  return <>
    {state.notices.length > 0 && <div className="fixed right-4 top-4 z-[110] flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2" aria-label="Notifications">
      {state.notices.map(notice => <div key={notice.id} role={notice.tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-xl border bg-slate-950/95 px-4 py-3 text-sm text-slate-200 shadow-2xl ${notice.tone === 'error' ? 'border-rose-300/30' : 'border-cyan-300/20'}`}>
        <span className="flex-1">{notice.message}</span>
        <button type="button" aria-label="Dismiss notification" onClick={() => onDismiss(notice.id)} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
      </div>)}
    </div>}
    {request && <React.Fragment key={request.id}><DialogBox request={request} onSettle={onSettle} /></React.Fragment>}
  </>;
}

function DialogBox({ request, onSettle }: { request: DialogRequest; onSettle: (id: number, value: boolean | string | null) => void }) {
  const box = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(request.kind === 'prompt' ? request.options.defaultValue ?? '' : '');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Destructive confirmations start on Cancel so Enter never deletes by accident.
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => previous?.focus?.();
  }, []);
  const cancel = () => onSettle(request.id, request.kind === 'confirm' ? false : null);
  const destructive = request.kind === 'confirm' && request.options.destructive === true;
  const accepted = request.kind === 'confirm' || promptValueAccepted(value, request.options);
  const title = request.options.title || (request.kind === 'prompt' ? 'Add a note' : destructive ? 'Please confirm' : 'Confirm');
  const minLength = request.kind === 'prompt' ? request.options.minLength : undefined;
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
    <form
      ref={box}
      role={request.kind === 'confirm' ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby={`app-dialog-title-${request.id}`}
      aria-describedby={`app-dialog-message-${request.id}`}
      className="liquid-panel w-full max-w-md space-y-4 rounded-2xl p-5 text-slate-100"
      onSubmit={event => { event.preventDefault(); if (accepted) onSettle(request.id, request.kind === 'confirm' ? true : value); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (event.key === 'Tab') {
          const items: HTMLElement[] = box.current ? Array.from(box.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')) : [];
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
    >
      <h2 id={`app-dialog-title-${request.id}`} className="flex items-center gap-2 text-base font-semibold">{destructive && <AlertTriangle aria-hidden="true" className="h-4 w-4 text-rose-300" />}{title}</h2>
      <p id={`app-dialog-message-${request.id}`} className="text-sm text-slate-300">{request.message}</p>
      {request.kind === 'prompt' && <label className="block text-xs text-slate-400">
        <span className="sr-only">{request.message}</span>
        <input data-autofocus value={value} onChange={event => setValue(event.target.value)} className="ui-field mt-1 min-h-11 w-full px-3 text-sm" aria-invalid={!accepted} />
        {minLength && minLength > 1 && <span className="mt-1 block">At least {minLength} characters.</span>}
      </label>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={cancel} data-autofocus={destructive ? '' : undefined} className="ui-button min-h-11 px-4">{(request.kind === 'confirm' && request.options.cancelLabel) || 'Cancel'}</button>
        <button type="submit" disabled={!accepted} data-autofocus={request.kind === 'confirm' && !destructive ? '' : undefined} className={`ui-button min-h-11 px-4 disabled:opacity-50 ${destructive ? 'border-rose-400/40 bg-rose-500/20 text-rose-100' : 'ui-button-primary'}`}>{request.options.confirmLabel || (request.kind === 'prompt' ? 'Save' : 'Confirm')}</button>
      </div>
    </form>
  </div>;
}

/** Mount once at the app root. */
export default function AppDialogHost({ store = appDialogs }: { store?: DialogStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return <AppDialogView state={state} onSettle={store.settle} onDismiss={store.dismissNotice} />;
}
