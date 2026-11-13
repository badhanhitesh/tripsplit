// Where trips are kept. On an ordinary website they are saved in this browser (localStorage).
// When the page runs inside Claude as an artifact, they are saved in that artifact's database instead.
import { useSyncExternalStore } from 'react';
import { Trip } from './engine';
import { demoTrips } from './demo';

export type Mode = 'loading' | 'cloud' | 'local';
export interface State {
  trips: Record<string, Trip>;
  mode: Mode;
  notice: string;       // a standing message about saving, shown under the header
  readOnly: boolean;
  canDownload: boolean;
}

const LOCAL_KEY = 'tripsplit.v1';
let state: State = { trips: {}, mode: 'loading', notice: '', readOnly: false, canDownload: false };
const listeners = new Set<() => void>();
const toastListeners = new Set<(msg: string, bad: boolean) => void>();

function set(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach(l => l()); }
export function useStore(): State {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}
export function onToast(fn: (msg: string, bad: boolean) => void) { toastListeners.add(fn); return () => { toastListeners.delete(fn); }; }
export function toast(msg: string, bad = false) { toastListeners.forEach(l => l(msg, bad)); }

const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Stored data may be old or edited by someone else, so rebuild every trip into a safe shape. */
function normalize(id: string, d: any): Trip | null {
  if (!d || typeof d !== 'object') return null;
  const people = arr(d.people).filter((p: any) => p && typeof p.id === 'string').map((p: any) => ({ id: p.id, name: str(p.name) || 'Someone' }));
  const ids = new Set(people.map(p => p.id));
  return {
    id, name: str(d.name) || 'Untitled trip', destination: str(d.destination), startDate: str(d.startDate), endDate: str(d.endDate),
    createdAt: num(d.createdAt), people,
    expenses: arr(d.expenses).filter((e: any) => e && typeof e.id === 'string').map((e: any) => {
      const among = arr(e.among).filter((x: any) => ids.has(x));
      const shares: Record<string, number> = {};
      for (const x of among) shares[x] = num(e.shares?.[x]);
      return {
        id: e.id, title: str(e.title) || 'Expense', amount: num(e.amount), paidBy: str(e.paidBy), category: str(e.category) || 'Other',
        date: str(e.date), notes: str(e.notes), splitType: e.splitType === 'amount' || e.splitType === 'percent' ? e.splitType : 'equal',
        among, shares, ...(e.percents && typeof e.percents === 'object' ? { percents: { ...e.percents } } : {}),
      };
    }),
    contributions: arr(d.contributions).filter((c: any) => c && ids.has(c.personId)).map((c: any) => ({ id: str(c.id), personId: c.personId, amount: num(c.amount), date: str(c.date) })),
    fundPerPerson: num(d.fundPerPerson),
    payments: arr(d.payments).filter((p: any) => p && typeof p.from === 'string' && typeof p.to === 'string').map((p: any) => ({ id: str(p.id), from: p.from, to: p.to, amount: num(p.amount), date: str(p.date) })),
    method: d.method === 'direct' || d.method === 'treasurer' || d.method === 'fund' ? d.method : null,
    treasurerId: ids.has(d.treasurerId) ? d.treasurerId : null,
  };
}

const plain = (t: Trip) => JSON.parse(JSON.stringify(t));

// ---------- this browser ----------

function readLocal(): Record<string, Trip> | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const out: Record<string, Trip> = {};
    for (const [id, d] of Object.entries(JSON.parse(raw).trips ?? {})) { const t = normalize(id, d); if (t) out[id] = t; }
    return out;
  } catch { return null; }
}
function writeLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ trips: state.trips })); }
  catch { set({ notice: 'This browser is not saving data, so trips will be lost when you close the page.' }); }
}
function startLocal() {
  let trips = readLocal();
  if (!trips) { trips = {}; for (const t of demoTrips()) trips[t.id] = t; }
  set({ trips, mode: 'local', notice: state.notice });
  writeLocal();
}

// ---------- the artifact's database ----------

let db: any = null;
let downloads: any = null;
let browserDownloads = false;
const inflight = new Set<string>();
const dirty = new Set<string>();

function fromDocs(docs: any[]): Record<string, Trip> {
  const out: Record<string, Trip> = {};
  for (const d of docs) { if (!d.exists) continue; const t = normalize(d.id, d.data()); if (t) out[d.id] = t; }
  return out;
}

async function refetch() {
  try { const snap = await db.collection('trips').get(); set({ trips: fromDocs(snap.docs) }); } catch { /* keep what we have */ }
}

async function push(id: string, retried = false): Promise<void> {
  if (inflight.has(id)) { dirty.add(id); return; }
  inflight.add(id);
  const t = state.trips[id];
  const ref = db.doc('trips/' + id);
  try {
    if (t) await ref.set(plain(t)); else await ref.delete();
  } catch (e: any) {
    const code = e?.code;
    inflight.delete(id);
    if (code === 'unavailable' && !retried) { await new Promise(r => setTimeout(r, 600 + Math.random() * 600)); return push(id, true); }
    dirty.delete(id);
    if (code === 'invalid_argument') set({ readOnly: true, notice: 'You can view these trips, but only the owner and contributors can change them.' });
    else if (code === 'quota_exceeded') toast('Storage is full. Delete an old trip to make room.', true);
    else toast('That change could not be saved. Check your connection and try again.', true);
    await refetch();
    return;
  }
  inflight.delete(id);
  if (dirty.delete(id)) return push(id);
}

async function startCloud(use: (n: string) => Promise<any>) {
  db = await use('db').catch(() => null);
  if (!db) { startLocal(); return; }
  use('downloads').then(d => { downloads = d; set({ canDownload: !!d }); }).catch(() => {});
  use('user').then(async u => {
    const can = await u?.can?.('data.write');
    if (can === false) set({ readOnly: true, notice: 'You can view these trips, but only the owner and contributors can change them.' });
  }).catch(() => {});

  const slow = setTimeout(() => {
    if (state.mode === 'loading') set({ mode: 'cloud', notice: 'Saved trips cannot be reached yet. They will appear when the connection is back.' });
  }, 10000);
  db.collection('trips').onSnapshot((snap: any) => {
    const next = fromDocs(snap.docs);
    // Keep our own copy of any trip that still has a write on its way.
    for (const id of new Set([...inflight, ...dirty])) { if (state.trips[id]) next[id] = state.trips[id]; else delete next[id]; }
    if (!snap.metadata?.fromCache) clearTimeout(slow);
    const stale = state.notice.startsWith('Saved trips cannot be reached');
    set({ trips: next, mode: 'cloud', notice: stale && !snap.metadata?.fromCache ? '' : state.notice });
  }, (e: any) => {
    clearTimeout(slow);
    set({ mode: 'cloud', notice: e?.code === 'revoked' ? 'Saved trips are no longer available in this view.' : 'Saved trips could not be loaded. Reopen the page to try again.' });
  });
}

export function init() {
  const use = (window as any).claude?.use;
  // On an ordinary website (GitHub Pages, localhost) the browser saves files itself.
  if (typeof use !== 'function') { browserDownloads = true; set({ canDownload: true }); startLocal(); return; }
  startCloud((n: string) => (window as any).claude.use(n)).catch(() => startLocal());
}

// ---------- changes ----------

function blocked(): boolean {
  if (state.readOnly) { toast('You can view this trip but not change it.', true); return true; }
  return false;
}

export function saveTrip(trip: Trip): boolean {
  if (blocked()) return false;
  set({ trips: { ...state.trips, [trip.id]: trip } });
  if (state.mode === 'cloud' && db) void push(trip.id); else writeLocal();
  return true;
}

export function deleteTrip(id: string): boolean {
  if (blocked()) return false;
  const trips = { ...state.trips }; delete trips[id];
  set({ trips });
  if (state.mode === 'cloud' && db) void push(id); else writeLocal();
  return true;
}

export function loadDemo(): boolean {
  if (blocked()) return false;
  for (const t of demoTrips()) saveTrip(t);
  return true;
}

/** Offer a generated file to the viewer. Resolves true if it was saved. */
export async function saveFile(filename: string, data: Blob | Uint8Array | string): Promise<boolean> {
  if (browserDownloads) {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart]));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }
  if (!downloads) return false;
  try { await downloads.save({ filename, data }); return true; }
  catch (e: any) {
    if (e?.code !== 'declined') toast('The file could not be saved here.', true);
    return false;
  }
}
