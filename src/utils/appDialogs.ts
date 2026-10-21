/**
 * In-app replacements for window.alert / confirm / prompt. Calls queue a
 * request; <AppDialogHost> renders the head of the queue and resolves it.
 * Notices never block; confirmations and prompts resolve once, on the
 * coach's explicit choice (Escape or Cancel resolves false / null).
 */
export type NoticeTone = 'info' | 'error';
export interface AppNotice { id: number; message: string; tone: NoticeTone }
export interface ConfirmOptions { title?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean }
export interface PromptOptions { title?: string; defaultValue?: string; confirmLabel?: string; minLength?: number }

export type DialogRequest =
  | { id: number; kind: 'confirm'; message: string; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { id: number; kind: 'prompt'; message: string; options: PromptOptions; resolve: (value: string | null) => void };

export interface DialogState { notices: AppNotice[]; dialogs: DialogRequest[] }

const MAX_NOTICES = 4;

export function createDialogStore() {
  let state: DialogState = { notices: [], dialogs: [] };
  let nextId = 1;
  const listeners = new Set<(state: DialogState) => void>();
  const set = (next: DialogState) => { state = next; for (const listener of listeners) listener(state); };
  const settle = (id: number, value: boolean | string | null) => {
    const request = state.dialogs.find(item => item.id === id);
    if (!request) return;
    set({ ...state, dialogs: state.dialogs.filter(item => item.id !== id) });
    if (request.kind === 'confirm') request.resolve(value === true);
    else request.resolve(typeof value === 'string' ? value : null);
  };
  return {
    getState: () => state,
    subscribe(listener: (state: DialogState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    notify(message: unknown, tone: NoticeTone = 'info') {
      const text = String(message ?? '').trim() || 'Action completed.';
      const id = nextId++;
      set({ ...state, notices: [...state.notices, { id, message: text, tone }].slice(-MAX_NOTICES) });
      return id;
    },
    dismissNotice(id: number) { set({ ...state, notices: state.notices.filter(item => item.id !== id) }); },
    confirm(message: string, options: ConfirmOptions = {}) {
      return new Promise<boolean>(resolve => { set({ ...state, dialogs: [...state.dialogs, { id: nextId++, kind: 'confirm', message, options, resolve }] }); });
    },
    prompt(message: string, options: PromptOptions = {}) {
      return new Promise<string | null>(resolve => { set({ ...state, dialogs: [...state.dialogs, { id: nextId++, kind: 'prompt', message, options, resolve }] }); });
    },
    /** Confirm (true / the entered text) or cancel (false / null) the dialog with this id. */
    settle,
  };
}

export type DialogStore = ReturnType<typeof createDialogStore>;

/** The app-wide store the host renders. */
export const appDialogs = createDialogStore();

/** A dismissible in-app notice; replaces window.alert. */
export const notify = (message: unknown, tone: NoticeTone = 'info') => appDialogs.notify(message, tone);
/** An in-app confirmation; resolves true only when the coach confirms. Replaces window.confirm. */
export const confirmDialog = (message: string, options?: ConfirmOptions) => appDialogs.confirm(message, options);
/** An in-app text prompt; resolves the trimmed text, or null when cancelled. Replaces window.prompt. */
export const promptDialog = (message: string, options?: PromptOptions) => appDialogs.prompt(message, options).then(value => value === null ? null : value.trim());

/** Whether a prompt's current text may be submitted. */
export const promptValueAccepted = (value: string, options: PromptOptions) => value.trim().length >= Math.max(1, options.minLength ?? 1);
