// TripSplit calculation engine. Pure functions, no UI.
// All money is held as whole paise (integers), so sums never drift.

export const FUND = 'fund';
export type Id = string;

export interface Person { id: Id; name: string }
export type SplitType = 'equal' | 'amount' | 'percent';

export interface Expense {
  id: Id;
  title: string;
  amount: number;            // paise
  paidBy: Id;                // a person id, or FUND
  category: string;
  date: string;              // yyyy-mm-dd
  notes: string;
  splitType: SplitType;
  among: Id[];               // who shares this expense
  shares: Record<Id, number>; // paise per person, always sums to amount
  percents?: Record<Id, number>;
}

export interface Contribution { id: Id; personId: Id; amount: number; date: string }
export interface Payment { id: Id; from: Id; to: Id; amount: number; date: string }
export type Method = 'direct' | 'treasurer' | 'fund';

export interface Trip {
  id: Id;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  createdAt: number;
  people: Person[];
  expenses: Expense[];
  contributions: Contribution[];  // money put into the common fund (never an expense)
  fundPerPerson: number;          // agreed contribution, paise (0 = fund not set up)
  payments: Payment[];            // settlement money that has changed hands
  method: Method | null;
  treasurerId: Id | null;
}

export interface Transfer { from: Id; to: Id; amount: number }

// ---------- money parsing and formatting ----------

export const MAX_AMOUNT = 10_00_00_000_00; // ₹10 crore, in paise

/** "1,500.50" -> 150050. Returns null if it is not a valid positive amount. */
export function parseAmount(input: string): number | null {
  const s = String(input ?? '').replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [r, f = ''] = s.split('.');
  const paise = Number(r) * 100 + Number((f + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise > MAX_AMOUNT) return null;
  return paise;
}

export function rupees(paise: number): string {
  const abs = Math.abs(paise);
  const r = Math.floor(abs / 100);
  const p = abs % 100;
  return r.toLocaleString('en-IN') + (p ? '.' + String(p).padStart(2, '0') : '');
}

export function inr(paise: number): string {
  return (paise < 0 ? '−' : '') + '₹' + rupees(paise);
}

export function signedInr(paise: number): string {
  return (paise > 0 ? '+' : paise < 0 ? '−' : '') + '₹' + rupees(paise);
}

/** Plain text for an amount field, e.g. 150050 -> "1500.50". */
export function amountText(paise: number): string {
  const r = Math.floor(paise / 100), p = paise % 100;
  return p ? `${r}.${String(p).padStart(2, '0')}` : String(r);
}

// ---------- splitting ----------

/** Equal split. Leftover paise go one each to the first people in the list. */
export function splitEqual(amount: number, ids: Id[]): Record<Id, number> {
  const out: Record<Id, number> = {};
  if (!ids.length) return out;
  const base = Math.floor(amount / ids.length);
  let extra = amount - base * ids.length;
  for (const id of ids) {
    out[id] = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
  }
  return out;
}

/** Percent split. Percents must add to 100. Rounding is reconciled by largest remainder. */
export function splitPercent(amount: number, ids: Id[], pct: Record<Id, number>): Record<Id, number> | null {
  const bp = ids.map(id => Math.round((pct[id] ?? 0) * 100)); // basis points
  if (bp.some(b => b < 0) || bp.reduce((a, b) => a + b, 0) !== 10000) return null;
  const exact = bp.map(b => (amount * b) / 10000);
  const floor = exact.map(Math.floor);
  let left = amount - floor.reduce((a, b) => a + b, 0);
  const order = ids.map((_, i) => i).sort((a, b) => (exact[b] - floor[b]) - (exact[a] - floor[a]) || a - b);
  for (const i of order) { if (left <= 0) break; floor[i]++; left--; }
  const out: Record<Id, number> = {};
  ids.forEach((id, i) => { out[id] = floor[i]; });
  return out;
}

export type ShareResult =
  | { ok: true; shares: Record<Id, number>; percents?: Record<Id, number> }
  | { ok: false; error: string };

/** Work out each person's share of one expense from what the user typed. */
export function computeShares(amount: number, splitType: SplitType, among: Id[], raw: Record<Id, string>): ShareResult {
  if (!among.length) return { ok: false, error: 'Pick at least one person to share this expense.' };
  if (splitType === 'equal') return { ok: true, shares: splitEqual(amount, among) };
  if (splitType === 'amount') {
    const shares: Record<Id, number> = {};
    let sum = 0;
    for (const id of among) {
      const txt = (raw[id] ?? '').trim();
      const v = txt === '' ? 0 : parseAmount(txt);
      if (v === null) return { ok: false, error: 'Each share must be a number like 250 or 250.50.' };
      shares[id] = v; sum += v;
    }
    if (sum !== amount) {
      const diff = amount - sum;
      return { ok: false, error: diff > 0
        ? `The shares add up to ${inr(sum)}. ${inr(diff)} is still unassigned.`
        : `The shares add up to ${inr(sum)}, which is ${inr(-diff)} more than the expense.` };
    }
    return { ok: true, shares };
  }
  const percents: Record<Id, number> = {};
  let total = 0;
  for (const id of among) {
    const txt = (raw[id] ?? '').trim();
    const v = txt === '' ? 0 : Number(txt);
    if (!/^\d*(\.\d{0,2})?$/.test(txt) || !Number.isFinite(v) || v < 0 || v > 100) {
      return { ok: false, error: 'Each percentage must be between 0 and 100.' };
    }
    percents[id] = v; total += Math.round(v * 100);
  }
  if (total !== 10000) return { ok: false, error: `The percentages add up to ${total / 100}%. They must total 100%.` };
  const shares = splitPercent(amount, among, percents)!;
  return { ok: true, shares, percents };
}

// ---------- balances ----------

export interface PersonSummary {
  id: Id; name: string;
  paid: number;         // expenses paid from own pocket
  share: number;        // their part of the expenses they took part in
  contributed: number;  // money put into the common fund
  net: number;          // paid + contributed - share (before any settlement)
  sent: number;         // settlement payments made
  received: number;     // settlement payments received
  outstanding: number;  // net + sent - received. + gets money, - owes money
}
export interface FundSummary { collected: number; spent: number; paidIn: number; paidOut: number; cash: number; inUse: boolean }
export interface Summary { total: number; people: PersonSummary[]; fund: FundSummary; byId: Record<Id, PersonSummary> }

export function summarize(trip: Trip): Summary {
  const byId: Record<Id, PersonSummary> = {};
  const people = trip.people.map(p => (byId[p.id] = {
    id: p.id, name: p.name, paid: 0, share: 0, contributed: 0, net: 0, sent: 0, received: 0, outstanding: 0,
  }));
  const fund: FundSummary = { collected: 0, spent: 0, paidIn: 0, paidOut: 0, cash: 0, inUse: false };
  let total = 0;
  for (const e of trip.expenses) {
    total += e.amount;
    if (e.paidBy === FUND) fund.spent += e.amount;
    else if (byId[e.paidBy]) byId[e.paidBy].paid += e.amount;
    for (const id of e.among) if (byId[id]) byId[id].share += e.shares[id] ?? 0;
  }
  for (const c of trip.contributions) {
    if (!byId[c.personId]) continue;
    byId[c.personId].contributed += c.amount;
    fund.collected += c.amount;
  }
  for (const p of trip.payments) {
    if (p.from === FUND) fund.paidOut += p.amount; else if (byId[p.from]) byId[p.from].sent += p.amount;
    if (p.to === FUND) fund.paidIn += p.amount; else if (byId[p.to]) byId[p.to].received += p.amount;
  }
  for (const s of people) {
    s.net = s.paid + s.contributed - s.share;
    s.outstanding = s.net + s.sent - s.received;
  }
  fund.cash = fund.collected - fund.spent + fund.paidIn - fund.paidOut;
  fund.inUse = trip.fundPerPerson > 0 || trip.contributions.length > 0 || fund.spent > 0 || fund.cash !== 0;
  return { total, people, fund, byId };
}

/** Outstanding balance of everyone, with the fund's cash as one more party. Always sums to zero. */
export function balanceNodes(s: Summary): [Id, number][] {
  const nodes: [Id, number][] = s.people.map(p => [p.id, p.outstanding]);
  if (s.fund.cash !== 0) nodes.push([FUND, -s.fund.cash]);
  return nodes;
}

// ---------- settlement ----------

function greedy(items: [Id, number][]): Transfer[] {
  const debt = items.filter(x => x[1] < 0).map(x => [x[0], -x[1]] as [Id, number]).sort((a, b) => b[1] - a[1]);
  const cred = items.filter(x => x[1] > 0).map(x => [x[0], x[1]] as [Id, number]).sort((a, b) => b[1] - a[1]);
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const amount = Math.min(debt[i][1], cred[j][1]);
    out.push({ from: debt[i][0], to: cred[j][0], amount });
    debt[i][1] -= amount; cred[j][1] -= amount;
    if (debt[i][1] === 0) i++;
    if (cred[j][1] === 0) j++;
  }
  return out;
}

/**
 * Fewest possible payments that clear every balance.
 * Splits the group into the largest number of sub-groups that each net to zero
 * (exact search, up to 16 open balances), then settles each sub-group with n-1 payments.
 */
export function settleDirect(nodes: [Id, number][]): Transfer[] {
  const nz = nodes.filter(n => n[1] !== 0);
  const n = nz.length;
  if (n === 0) return [];
  if (n > 16) return greedy(nz);
  const size = 1 << n;
  const sum = new Float64Array(size);
  const best = new Int8Array(size);
  const pick = new Int8Array(size);
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    sum[mask] = sum[mask ^ low] + nz[31 - Math.clz32(low)][1];
    let b = -1, p = 0;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const v = best[mask ^ (1 << i)];
      if (v > b) { b = v; p = i; }
    }
    best[mask] = b + (sum[mask] === 0 ? 1 : 0);
    pick[mask] = p;
  }
  const out: Transfer[] = [];
  let mask = size - 1;
  let group: [Id, number][] = [];
  while (mask) {
    const i = pick[mask];
    group.push([nz[i][0], nz[i][1]]);
    mask ^= 1 << i;
    if (sum[mask] === 0) { out.push(...greedy(group)); group = []; }
  }
  return out;
}

/** Everyone who owes pays the hub; the hub pays everyone who is owed. */
export function settleHub(nodes: [Id, number][], hub: Id): Transfer[] {
  const out: Transfer[] = [];
  for (const [id, bal] of nodes) if (id !== hub && bal < 0) out.push({ from: id, to: hub, amount: -bal });
  for (const [id, bal] of nodes) if (id !== hub && bal > 0) out.push({ from: hub, to: id, amount: bal });
  return out;
}

/** The treasurer in use: the chosen one, else whoever is owed the most. */
export function treasurerOf(trip: Trip, s: Summary): Id | null {
  if (trip.treasurerId && s.byId[trip.treasurerId]) return trip.treasurerId;
  if (!s.people.length) return null;
  return s.people.reduce((a, b) => (b.outstanding > a.outstanding ? b : a)).id;
}

export interface Option {
  method: Method;
  hub: Id | null;
  transfers: Transfer[];
  count: number;
  collect: number;      // money paid in by people who owe
  distribute: number;   // money paid out to people who are owed
  payers: Id[];
  receivers: Id[];
}

export function option(trip: Trip, method: Method, s: Summary = summarize(trip)): Option {
  const nodes = balanceNodes(s);
  const hub = method === 'treasurer' ? treasurerOf(trip, s) : method === 'fund' ? FUND : null;
  const transfers = hub ? settleHub(nodes, hub) : settleDirect(nodes);
  const sumOf = (xs: Transfer[]) => xs.reduce((a, t) => a + t.amount, 0);
  const collect = hub ? sumOf(transfers.filter(t => t.to === hub)) : sumOf(transfers);
  const distribute = hub ? sumOf(transfers.filter(t => t.from === hub)) : sumOf(transfers);
  const uniq = (xs: Id[]) => [...new Set(xs)];
  return {
    method, hub, transfers, count: transfers.length, collect, distribute,
    payers: uniq(nodes.filter(n => n[1] < 0 && n[0] !== hub).map(n => n[0])),
    receivers: uniq(nodes.filter(n => n[1] > 0 && n[0] !== hub).map(n => n[0])),
  };
}

export function recommend(trip: Trip, s: Summary = summarize(trip)): { method: Method; reason: string } | null {
  const direct = option(trip, 'direct', s);
  if (direct.count === 0) return null;
  if (s.fund.inUse) {
    return { method: 'fund', reason: s.fund.cash > 0
      ? `Your group already has ${inr(s.fund.cash)} in the common fund, so settling through it is simplest.`
      : 'Your group is already using a common fund, so settling through it is simplest.' };
  }
  if (direct.count <= 3) {
    return { method: 'direct', reason: `Only ${direct.count} payment${direct.count === 1 ? '' : 's'} needed, so paying each other directly is simplest.` };
  }
  return { method: 'treasurer', reason: `${direct.count} payments between different pairs are hard to follow. Sending everything through one person is easier to track.` };
}

export type TripStatus = 'empty' | 'open' | 'settled';
export function tripStatus(trip: Trip, s: Summary = summarize(trip)): TripStatus {
  if (!trip.expenses.length && !trip.contributions.length) return 'empty';
  return s.fund.cash === 0 && s.people.every(p => p.outstanding === 0) ? 'settled' : 'open';
}

// ---------- checks used by the forms ----------

export function findDuplicate(trip: Trip, e: Pick<Expense, 'title' | 'amount' | 'date' | 'paidBy'>, excludeId?: Id): Expense | null {
  const key = e.title.trim().toLowerCase();
  return trip.expenses.find(x => x.id !== excludeId && x.amount === e.amount && x.date === e.date
    && x.paidBy === e.paidBy && x.title.trim().toLowerCase() === key) ?? null;
}

/** How many records mention this person. They can only be removed when this is zero. */
export function personUsage(trip: Trip, id: Id): number {
  return trip.expenses.filter(e => e.paidBy === id || e.among.includes(id)).length
    + trip.contributions.filter(c => c.personId === id).length
    + trip.payments.filter(p => p.from === id || p.to === id).length;
}

export function nameOf(trip: Trip, id: Id): string {
  if (id === FUND) return 'Common fund';
  return trip.people.find(p => p.id === id)?.name ?? 'Someone';
}

export function newId(prefix = ''): string {
  let s = prefix;
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 10; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
