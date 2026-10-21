import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppDialogView } from '../src/components/AppDialogHost';
import { createDialogStore, promptValueAccepted } from '../src/utils/appDialogs';

describe('in-app dialog store', () => {
  it('resolves a confirmation only on an explicit choice, in request order', async () => {
    const store = createDialogStore();
    const first = store.confirm('Delete this goal?', { destructive: true, confirmLabel: 'Delete' });
    const second = store.confirm('Save this match data?');
    const [a, b] = store.getState().dialogs;
    expect(a.message).toBe('Delete this goal?');
    store.settle(a.id, false);
    expect(store.getState().dialogs.map(item => item.id)).toEqual([b.id]);
    store.settle(b.id, true);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(store.getState().dialogs).toEqual([]);
  });

  it('settles a request once; a second settle is ignored', async () => {
    const store = createDialogStore();
    const answer = store.confirm('Disconnect this PC?');
    const id = store.getState().dialogs[0].id;
    store.settle(id, true); store.settle(id, false);
    await expect(answer).resolves.toBe(true);
  });

  it('returns prompt text, or null when cancelled', async () => {
    const store = createDialogStore();
    const named = store.prompt('Block name', { defaultValue: 'Week 3' });
    const cancelled = store.prompt('Merged block name');
    const [a, b] = store.getState().dialogs;
    store.settle(a.id, 'Week 4'); store.settle(b.id, null);
    await expect(named).resolves.toBe('Week 4');
    await expect(cancelled).resolves.toBeNull();
    expect(promptValueAccepted('   ', {})).toBe(false);
    expect(promptValueAccepted('typo', { minLength: 5 })).toBe(false);
    expect(promptValueAccepted('wrong player', { minLength: 5 })).toBe(true);
  });

  it('keeps notices non-blocking and dismissible, capped to the latest four', () => {
    const store = createDialogStore();
    const ids = ['one', 'two', 'three', 'four', 'five'].map(message => store.notify(message));
    store.notify('', 'error');
    expect(store.getState().notices.map(item => item.message)).toEqual(['three', 'four', 'five', 'Action completed.']);
    store.dismissNotice(ids[3]);
    expect(store.getState().notices.map(item => item.message)).toEqual(['three', 'five', 'Action completed.']);
    expect(store.getState().dialogs).toEqual([]);
  });
});

describe('in-app dialog rendering', () => {
  const render = (store: ReturnType<typeof createDialogStore>) => renderToStaticMarkup(<AppDialogView state={store.getState()} onSettle={store.settle} onDismiss={store.dismissNotice} />);

  it('renders a destructive confirmation as a labelled modal alertdialog that starts on Cancel', () => {
    const store = createDialogStore();
    void store.confirm('Delete this match, round logs, player metrics, and vetoes?', { destructive: true, confirmLabel: 'Delete' });
    const html = render(store);
    expect(html).toMatch(/role="alertdialog"[^>]*aria-modal="true"[^>]*aria-labelledby="app-dialog-title-1"[^>]*aria-describedby="app-dialog-message-1"/);
    expect(html).toContain('id="app-dialog-message-1"');
    expect(html).toContain('Delete this match, round logs, player metrics, and vetoes?');
    expect(html).toMatch(/<button type="button" data-autofocus=""[^>]*>Cancel<\/button>/);
    expect(html).toMatch(/<button type="submit"[^>]*>Delete<\/button>/);
    expect(html).not.toMatch(/type="submit"[^>]*data-autofocus/);
  });

  it('shows only the first queued dialog, and notices with dismiss buttons', () => {
    const store = createDialogStore();
    void store.confirm('First question?'); void store.confirm('Second question?');
    store.notify('Strategy saved.'); store.notify('Key creation failed.', 'error');
    const html = render(store);
    expect(html).toContain('First question?'); expect(html).not.toContain('Second question?');
    expect(html).toMatch(/role="status"[^>]*><span[^>]*>Strategy saved\./);
    expect(html).toMatch(/role="alert"[^>]*><span[^>]*>Key creation failed\./);
    expect(html.match(/aria-label="Dismiss notification"/g)).toHaveLength(2);
  });

  it('disables a prompt submit until the required reason is long enough', () => {
    const store = createDialogStore();
    void store.prompt('Why are you reversing this identity link?', { minLength: 5, confirmLabel: 'Reverse link' });
    const html = render(store);
    expect(html).toMatch(/role="dialog"/);
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>Reverse link<\/button>/);
    expect(html).toContain('At least 5 characters.');
  });
});
