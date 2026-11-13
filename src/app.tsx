import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LuPlus, LuArrowLeft, LuArrowRight, LuCheck, LuTrash2, LuPencil, LuX, LuCopy, LuUsers, LuBedDouble, LuUtensils,
  LuShoppingBag, LuTicket, LuReceipt, LuCircleCheck, LuChevronRight, LuChevronDown, LuPiggyBank, LuCar,
  LuFileSpreadsheet, LuFileText, LuStar, LuUndo2, LuWallet,
} from 'react-icons/lu';
import {
  FUND, Trip, Expense, Method, Transfer, SplitType, Summary, PersonSummary, Option,
  summarize, option, recommend, tripStatus, treasurerOf, computeShares, splitEqual, findDuplicate, personUsage,
  parseAmount, amountText, inr, signedInr, nameOf, newId,
} from './engine';
import { useStore, init, saveTrip, deleteTrip, loadDemo, toast, onToast, saveFile } from './store';
import { buildPdf, buildXlsx, reportText, fmtDate, dateRange, METHOD_NAME } from './export';

// ---------- small helpers ----------

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const shortDate = (d: string) => fmtDate(d).replace(/ \d{4}$/, '');
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const go = (hash: string) => { location.hash = hash; };

const CATEGORIES = [
  { id: 'Stay', icon: LuBedDouble, words: /hotel|stay|room|villa|hostel|cottage|resort|airbnb/i },
  { id: 'Travel', icon: LuCar, words: /petrol|fuel|diesel|cab|taxi|auto|train|flight|bus|toll|parking|scooter|rental/i },
  { id: 'Food', icon: LuUtensils, words: /food|dinner|lunch|breakfast|snack|chai|tea|coffee|restaurant|meal|drinks|groceries/i },
  { id: 'Shopping', icon: LuShoppingBag, words: /shop|gift|souvenir/i },
  { id: 'Activities', icon: LuTicket, words: /ticket|entry|ride|sport|trek|tour|movie|boat/i },
  { id: 'Other', icon: LuReceipt, words: /^$/ },
];
const QUICK = ['Hotel', 'Petrol', 'Food', 'Dinner', 'Shopping', 'Cab', 'Tickets'];
const guessCategory = (title: string) => CATEGORIES.find(c => c.words.test(title))?.id ?? 'Other';
const iconFor = (cat: string) => CATEGORIES.find(c => c.id === cat)?.icon ?? LuReceipt;

type Tone = 'pos' | 'neg' | 'zero';
const toneOf = (v: number): Tone => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero');
const TONE_TEXT: Record<Tone, string> = { pos: 'text-pos', neg: 'text-neg', zero: 'text-zero' };
const TONE_PILL: Record<Tone, string> = { pos: 'bg-pos-bg text-pos', neg: 'bg-neg-bg text-neg', zero: 'bg-zero-bg text-zero' };
const TONE_LABEL: Record<Tone, string> = { pos: 'Gets back', neg: 'Needs to pay', zero: 'Settled' };

// ---------- shared UI ----------

type Modal =
  | { kind: 'trip'; tripId?: string }
  | { kind: 'expense'; tripId: string; expenseId?: string }
  | { kind: 'pay'; tripId: string; transfer: Transfer }
  | { kind: 'fundSetup'; tripId: string }
  | { kind: 'contribution'; tripId: string; personId: string; due: number }
  | null;
interface Confirm { title: string; body: string; action: string; resolve: (ok: boolean) => void }
const Ui = createContext<{ open: (m: Modal) => void; confirm: (c: Omit<Confirm, 'resolve'>) => Promise<boolean> }>(null as any);

const BTN: Record<string, string> = {
  primary: 'bg-btn text-btn-ink hover:opacity-90',
  soft: 'bg-mint text-ink hover:bg-mint-deep',
  ghost: 'border border-line text-ink hover:bg-zero-bg',
  danger: 'text-neg hover:bg-neg-bg',
  red: 'bg-neg text-surface hover:opacity-90',
};
function Btn({ kind = 'primary', className = '', children, ...rest }: { kind?: keyof typeof BTN; className?: string; children: ReactNode } & Record<string, any>) {
  return (
    <button type="button" {...rest} className={`inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl font-semibold text-[15px] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-default ${BTN[kind]} ${className}`}>
      {children}
    </button>
  );
}
const INPUT = 'w-full h-11 px-3 rounded-xl border border-line bg-bg text-ink text-base placeholder:text-muted';
const CARD = 'rounded-2xl bg-surface border border-line';

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
function Pill({ tone, children }: { tone: Tone | 'mint'; children: ReactNode }) {
  const cls = tone === 'mint' ? 'bg-mint text-ink' : TONE_PILL[tone];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cls}`}>{children}</span>;
}
function Avatar({ name, fund }: { name: string; fund?: boolean }) {
  return (
    <span className="grid place-items-center shrink-0 w-10 h-10 rounded-full bg-mint text-ink font-display font-semibold" aria-hidden="true">
      {fund ? <LuPiggyBank /> : name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="px-3 py-2 rounded-xl bg-neg-bg text-neg text-sm font-medium">{children}</p>;
}
function Empty({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className={`${CARD} p-6 flex flex-col items-center text-center gap-2`}>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="text-muted text-sm max-w-sm">{body}</p>
      {children && <div className="flex flex-wrap justify-center gap-2 mt-2">{children}</div>}
    </div>
  );
}

function Sheet({ title, onClose, onSubmit, children, footer }: { title: string; onClose: () => void; onSubmit: () => void; children: ReactNode; footer: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(); };
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/45" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} noValidate role="dialog" aria-modal="true" aria-label={title}
        className="w-full sm:max-w-lg max-h-[94%] flex flex-col bg-surface rounded-t-3xl sm:rounded-3xl shadow-xl">
        <div className="flex items-center justify-between gap-3 pl-5 pr-3 pt-4 pb-3 border-b border-line">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid place-items-center w-10 h-10 rounded-xl cursor-pointer hover:bg-zero-bg"><LuX /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex flex-col gap-4">{children}</div>
        <div className="px-5 py-3 border-t border-line flex flex-wrap gap-2 justify-end">{footer}</div>
      </form>
    </div>
  );
}

// ---------- dashboard ----------

function StatusPill({ trip, s }: { trip: Trip; s: Summary }) {
  const st = tripStatus(trip, s);
  if (st === 'settled') return <Pill tone="pos"><LuCheck /> Settled</Pill>;
  if (st === 'empty') return <Pill tone="zero">New</Pill>;
  return <Pill tone="mint">Active</Pill>;
}

function Dashboard({ trips }: { trips: Trip[] }) {
  const { open } = useContext(Ui);
  const rows = useMemo(() => trips.map(t => ({ t, s: summarize(t) })).sort((a, b) => b.t.createdAt - a.t.createdAt), [trips]);
  const active = rows.filter(r => tripStatus(r.t, r.s) !== 'settled').length;
  const total = rows.reduce((a, r) => a + r.s.total, 0);
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Your trips</h1>
          <p className="text-muted">Record who paid, split it fairly, settle up.</p>
        </div>
        <Btn onClick={() => open({ kind: 'trip' })}><LuPlus /> Create new trip</Btn>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[['Total trips', String(rows.length), ''], ['Active trips', String(active), ''], ['Total expenses', inr(total), 'col-span-2 sm:col-span-1']].map(([label, value, span]) => (
          <div key={label} className={`${CARD} p-4 ${span}`}>
            <div className="text-sm text-muted">{label}</div>
            <div className="font-display text-2xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      <h2 className="font-display text-xl font-semibold -mb-2">Recent trips</h2>
      {rows.length === 0 && (
        <Empty title="No trips yet" body="Create your first trip, or load three example trips to see how splitting and settling work.">
          <Btn onClick={() => open({ kind: 'trip' })}><LuPlus /> Create new trip</Btn>
          <Btn kind="ghost" onClick={() => { if (loadDemo()) toast('Example trips added.'); }}>Load example trips</Btn>
        </Empty>
      )}
      <div className="flex flex-col gap-3">
        {rows.map(({ t, s }) => (
          <a key={t.id} href={`#trip-${t.id}`} className={`${CARD} flex items-center gap-3 p-4 hover:border-muted`}>
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display text-lg font-semibold leading-tight">{t.name}</span>
                <StatusPill trip={t} s={s} />
              </div>
              <div className="text-sm text-muted">{[t.destination, dateRange(t.startDate, t.endDate)].filter(Boolean).join(' · ')}</div>
              <div className="text-sm text-muted">{plural(t.people.length, 'person', 'people')} · {plural(t.expenses.length, 'expense')}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-display text-lg font-semibold tabular-nums">{inr(s.total)}</div>
              <div className="text-xs text-muted">spent</div>
            </div>
            <LuChevronRight className="text-muted shrink-0" />
          </a>
        ))}
      </div>
    </section>
  );
}

// ---------- trip page ----------

type Tab = 'balances' | 'expenses' | 'settle' | 'fund' | 'report';
const TABS: [Tab, string][] = [['balances', 'Balances'], ['expenses', 'Expenses'], ['settle', 'Settle up'], ['fund', 'Fund'], ['report', 'Report']];

function TripPage({ trip }: { trip: Trip }) {
  const { open } = useContext(Ui);
  const [tab, setTab] = useState<Tab>('balances');
  const s = useMemo(() => summarize(trip), [trip]);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <a href="#home" aria-label="Back to all trips" className="grid place-items-center shrink-0 w-10 h-10 rounded-xl border border-line hover:bg-zero-bg"><LuArrowLeft /></a>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-2xl font-bold tracking-tight leading-tight">{trip.name}</h1>
            <StatusPill trip={trip} s={s} />
          </div>
          <p className="text-sm text-muted">{[trip.destination, dateRange(trip.startDate, trip.endDate), plural(trip.people.length, 'person', 'people')].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" aria-label="Edit trip details and people" onClick={() => open({ kind: 'trip', tripId: trip.id })} className="grid place-items-center shrink-0 w-10 h-10 rounded-xl border border-line cursor-pointer hover:bg-zero-bg"><LuPencil /></button>
      </div>
      <div>
        <div role="tablist" className="flex gap-0.5 p-1 rounded-2xl bg-zero-bg">
          {TABS.map(([id, label]) => (
            <button key={id} id={`tab-${id}`} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`flex-1 min-w-0 whitespace-nowrap px-1 h-10 rounded-xl text-[13px] sm:text-sm font-semibold cursor-pointer ${tab === id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'balances' && <Balances trip={trip} s={s} onSettle={() => setTab('settle')} />}
      {tab === 'expenses' && <Expenses trip={trip} />}
      {tab === 'settle' && <Settle trip={trip} s={s} />}
      {tab === 'fund' && <Fund trip={trip} s={s} />}
      {tab === 'report' && <Report trip={trip} s={s} />}
      {(tab === 'balances' || tab === 'expenses') && (
        <div className="fixed bottom-4 inset-x-0 z-30 flex justify-center pointer-events-none">
          <Btn onClick={() => open({ kind: 'expense', tripId: trip.id })} className="pointer-events-auto h-12 px-6 rounded-full shadow-lg"><LuPlus /> Add expense</Btn>
        </div>
      )}
    </section>
  );
}

function SettledBanner() {
  return (
    <div role="status" className="flex items-center gap-3 p-4 rounded-2xl bg-pos-bg text-pos">
      <LuCircleCheck className="text-2xl shrink-0" />
      <p className="font-display text-lg font-semibold">All Expenses Settled Successfully!</p>
    </div>
  );
}

// ---------- balances ----------

function PersonRow({ trip, p }: { trip: Trip; p: PersonSummary }) {
  const [openRow, setOpenRow] = useState(false);
  const tone = toneOf(p.outstanding);
  const mine = trip.expenses.filter(e => e.paidBy === p.id || e.among.includes(p.id));
  const moved = p.sent - p.received;
  return (
    <div className={CARD}>
      <button type="button" aria-expanded={openRow} onClick={() => setOpenRow(!openRow)} className="w-full flex items-center gap-3 p-3 text-left cursor-pointer">
        <Avatar name={p.name} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{p.name}</div>
          <div className="text-sm text-muted tabular-nums flex flex-wrap gap-x-3">
            <span className="whitespace-nowrap">Paid {inr(p.paid)}</span>
            <span className="whitespace-nowrap">Share {inr(p.share)}</span>
            {p.contributed > 0 && <span className="whitespace-nowrap">Fund {inr(p.contributed)}</span>}
          </div>
          {moved !== 0 && <div className="text-xs text-muted tabular-nums">Balance was {signedInr(p.net)}, {moved > 0 ? `paid ${inr(moved)}` : `received ${inr(-moved)}`} since</div>}
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <span className={`font-display text-lg font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{signedInr(p.outstanding)}</span>
          <Pill tone={tone}>{TONE_LABEL[tone]}</Pill>
        </div>
        <LuChevronDown className={`text-muted shrink-0 transition-transform ${openRow ? 'rotate-180' : ''}`} />
      </button>
      {openRow && (
        <div className="px-3 pb-3">
          <div className="rounded-xl bg-bg p-3 text-sm flex flex-col gap-1.5">
            {mine.length === 0 && <p className="text-muted">{p.name} is not part of any expense yet.</p>}
            {mine.map(e => (
              <div key={e.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{e.title} <span className="text-muted">· {shortDate(e.date)}</span></span>
                <span className="tabular-nums whitespace-nowrap text-muted">
                  {e.paidBy === p.id && <span className="text-ink">paid {inr(e.amount)} · </span>}
                  share {inr(e.among.includes(p.id) ? e.shares[p.id] ?? 0 : 0)}
                </span>
              </div>
            ))}
            <div className="flex justify-between gap-3 pt-1.5 mt-1 border-t border-line font-semibold tabular-nums">
              <span>Paid {inr(p.paid + p.contributed)} − share {inr(p.share)}</span>
              <span className={TONE_TEXT[toneOf(p.net)]}>{signedInr(p.net)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Balances({ trip, s, onSettle }: { trip: Trip; s: Summary; onSettle: () => void }) {
  const { open } = useContext(Ui);
  const st = tripStatus(trip, s);
  return (
    <div className="flex flex-col gap-3">
      {st === 'settled' && <SettledBanner />}
      <div className={`${CARD} p-4 flex items-center justify-between gap-3 flex-wrap`}>
        <div>
          <div className="text-sm text-muted">Total trip expenses</div>
          <div className="font-display text-3xl font-bold tabular-nums tracking-tight">{inr(s.total)}</div>
          <div className="text-sm text-muted">{plural(trip.expenses.length, 'expense')}{s.fund.inUse ? ` · ${inr(s.fund.cash)} in the common fund` : ''}</div>
        </div>
        {st === 'open' && <Btn kind="soft" onClick={onSettle}>Settle up <LuArrowRight /></Btn>}
      </div>
      {st === 'empty' && (
        <Empty title="Add the first expense" body="Enter what was spent and who paid. Shares and balances update on their own.">
          <Btn onClick={() => open({ kind: 'expense', tripId: trip.id })}><LuPlus /> Add expense</Btn>
        </Empty>
      )}
      <div className="flex items-baseline justify-between gap-3 mt-1">
        <h2 className="font-display text-xl font-semibold">Who stands where</h2>
        <span className="text-xs text-muted">Balance = paid − share</span>
      </div>
      {s.people.map(p => <PersonRow key={p.id} trip={trip} p={p} />)}
    </div>
  );
}

// ---------- expenses ----------

function Expenses({ trip }: { trip: Trip }) {
  const { open, confirm } = useContext(Ui);
  const [who, setWho] = useState('');
  const [cat, setCat] = useState('');
  const [day, setDay] = useState('');
  const list = trip.expenses
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (!who || e.paidBy === who || e.among.includes(who)) && (!cat || e.category === cat) && (!day || e.date === day))
    .sort((a, b) => b.e.date.localeCompare(a.e.date) || b.i - a.i);
  const shown = list.reduce((a, x) => a + x.e.amount, 0);
  const filtered = !!(who || cat || day);
  const remove = async (e: Expense) => {
    if (!(await confirm({ title: 'Delete this expense?', body: `${e.title}, ${inr(e.amount)}. Everyone's balance will be recalculated.`, action: 'Delete expense' }))) return;
    if (saveTrip({ ...trip, expenses: trip.expenses.filter(x => x.id !== e.id) })) toast('Expense deleted.');
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Expense history</h2>
        <span className="text-sm text-muted tabular-nums">{filtered ? `${list.length} of ${trip.expenses.length} · ` : ''}{inr(shown)}</span>
      </div>
      {trip.expenses.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select id="filter-person" aria-label="Filter by person" value={who} onChange={e => setWho(e.target.value)} className={INPUT}>
            <option value="">Everyone</option>
            {trip.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            {trip.expenses.some(e => e.paidBy === FUND) && <option value={FUND}>Common fund</option>}
          </select>
          <select id="filter-category" aria-label="Filter by category" value={cat} onChange={e => setCat(e.target.value)} className={INPUT}>
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
          </select>
          <input id="filter-date" aria-label="Filter by date" type="date" value={day} onChange={e => setDay(e.target.value)} className={INPUT} />
          <Btn kind="ghost" disabled={!filtered} onClick={() => { setWho(''); setCat(''); setDay(''); }}>Clear filters</Btn>
        </div>
      )}
      {trip.expenses.length === 0 && (
        <Empty title="No expenses yet" body="Add what was spent and who paid. It takes a few seconds.">
          <Btn onClick={() => open({ kind: 'expense', tripId: trip.id })}><LuPlus /> Add expense</Btn>
        </Empty>
      )}
      {trip.expenses.length > 0 && list.length === 0 && <Empty title="Nothing matches these filters" body="Change or clear the filters to see more expenses." />}
      {list.map(({ e }) => {
        const Icon = iconFor(e.category);
        const everyone = e.among.length === trip.people.length;
        return (
          <div key={e.id} className={`${CARD} flex items-start gap-3 p-3`}>
            <span className="grid place-items-center shrink-0 w-10 h-10 rounded-xl bg-mint text-ink text-lg" aria-hidden="true"><Icon /></span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold min-w-0 break-words">{e.title}</span>
                <span className="font-display text-lg font-semibold tabular-nums whitespace-nowrap">{inr(e.amount)}</span>
              </div>
              <div className="text-sm text-muted">{nameOf(trip, e.paidBy)} paid · {shortDate(e.date)} · {e.category}</div>
              <div className="text-sm text-muted">
                Shared by {everyone ? 'everyone' : e.among.map(id => nameOf(trip, id)).join(', ')}
                {e.splitType === 'equal' ? ', equally' : e.splitType === 'percent' ? ', by percent' : ', custom amounts'}
              </div>
              {e.notes && <div className="text-sm text-muted italic">{e.notes}</div>}
              <div className="flex gap-1 mt-1 -ml-2">
                <Btn kind="ghost" className="h-9 px-2 border-0 text-sm" onClick={() => open({ kind: 'expense', tripId: trip.id, expenseId: e.id })}><LuPencil /> Edit</Btn>
                <Btn kind="danger" className="h-9 px-2 text-sm" onClick={() => remove(e)}><LuTrash2 /> Delete</Btn>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- settle up ----------

const OPTION_COPY: Record<Method, { title: string; best: string; pros: string[]; icon: typeof LuUsers }> = {
  direct: { title: 'Pay each other', best: 'Best for small groups happy to transfer directly.', pros: ['Fewest payments possible', 'Nobody holds other people’s money'], icon: LuUsers },
  treasurer: { title: 'Trip Treasurer', best: 'Best for family trips where one person handles the money.', pros: ['Everyone deals with just one person', 'Easy to see who has paid'], icon: LuWallet },
  fund: { title: 'Common trip fund', best: 'Best when money is pooled before or during the trip.', pros: ['Nobody fronts big bills', 'Refunds come from one pot'], icon: LuPiggyBank },
};

function TransferLine({ trip, t }: { trip: Trip; t: Transfer }) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-sm">
      <span className="min-w-0">{nameOf(trip, t.from)} <span className="text-muted">pays</span> {nameOf(trip, t.to)}</span>
      <span className="tabular-nums font-semibold whitespace-nowrap">{inr(t.amount)}</span>
    </li>
  );
}

function OptionCard({ trip, s, o, recommended }: { trip: Trip; s: Summary; o: Option; recommended: boolean }) {
  const copy = OPTION_COPY[o.method];
  const selected = trip.method === o.method;
  const Icon = copy.icon;
  const hubBal = o.method === 'treasurer' && o.hub ? s.byId[o.hub]?.outstanding ?? 0 : 0;
  const choose = () => {
    const next: Trip = { ...trip, method: o.method, treasurerId: o.method === 'treasurer' ? o.hub : trip.treasurerId };
    if (saveTrip(next)) toast(`Settling with: ${copy.title}.`);
  };
  return (
    <div className={`${CARD} p-4 flex flex-col gap-3 ${selected ? 'border-ink ring-2 ring-mint-deep' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-mint text-ink text-lg" aria-hidden="true"><Icon /></span>
          <h3 className="font-display text-lg font-semibold leading-tight">{copy.title}</h3>
        </div>
        {recommended && <Pill tone="mint"><LuStar /> Simplest</Pill>}
      </div>
      <p className="text-sm text-muted">{copy.best}</p>
      <div className="font-display text-2xl font-bold tabular-nums">{plural(o.count, 'payment')}</div>
      {o.method === 'treasurer' && (
        <Field label="Treasurer" htmlFor="treasurer-pick">
          <select id="treasurer-pick" className={INPUT} value={o.hub ?? ''} onChange={e => { saveTrip({ ...trip, treasurerId: e.target.value }); }}>
            {trip.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      <ul className="flex flex-col gap-1.5 rounded-xl bg-bg p-3">
        {o.transfers.slice(0, 7).map((t, i) => <TransferLine key={i} trip={trip} t={t} />)}
        {o.transfers.length > 7 && <li className="text-sm text-muted">and {o.transfers.length - 7} more</li>}
      </ul>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums">
        <dt className="text-muted">Who pays</dt><dd className="text-right">{o.payers.map(id => nameOf(trip, id)).join(', ') || 'Nobody'}</dd>
        <dt className="text-muted">Who receives</dt><dd className="text-right">{o.receivers.map(id => nameOf(trip, id)).join(', ') || 'Nobody'}</dd>
        <dt className="text-muted">To collect</dt><dd className="text-right font-semibold">{inr(o.collect)}</dd>
        <dt className="text-muted">To distribute</dt><dd className="text-right font-semibold">{inr(o.distribute)}</dd>
        <dt className="text-muted">Left over after</dt><dd className="text-right font-semibold">{inr(0)}</dd>
      </dl>
      {o.method === 'treasurer' && hubBal !== 0 && (
        <p className="text-sm text-muted">{nameOf(trip, o.hub!)} {hubBal > 0 ? `keeps ${inr(hubBal)} of what is collected as their own refund.` : `adds ${inr(-hubBal)} of their own money to what is collected.`}</p>
      )}
      {o.method === 'fund' && (
        <p className="text-sm text-muted">{s.fund.cash > 0 ? `${inr(s.fund.cash)} is in the fund now and goes back as refunds.` : s.fund.inUse ? 'The fund is empty, so people who owe top it up first.' : 'No fund was collected for this trip, so people who owe pay into a pot first.'}</p>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {copy.pros.map(p => <li key={p} className="flex items-start gap-2"><LuCheck className="text-pos mt-0.5 shrink-0" /> {p}</li>)}
      </ul>
      <Btn kind={selected ? 'soft' : 'primary'} className="mt-auto" onClick={choose} disabled={selected}>
        {selected ? <><LuCheck /> Using this method</> : 'Use this method'}
      </Btn>
    </div>
  );
}

function PendingRow({ trip, t }: { trip: Trip; t: Transfer }) {
  const { open } = useContext(Ui);
  const pay = () => {
    const next: Trip = { ...trip, payments: [...trip.payments, { id: newId('p'), from: t.from, to: t.to, amount: t.amount, date: today() }] };
    if (saveTrip(next)) toast(`Recorded: ${nameOf(trip, t.from)} paid ${nameOf(trip, t.to)} ${inr(t.amount)}.`);
  };
  return (
    <div className={`${CARD} flex items-center gap-x-3 gap-y-2 p-3 flex-wrap`}>
      <Avatar name={nameOf(trip, t.from)} fund={t.from === FUND} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold flex items-center gap-1.5 flex-wrap">{nameOf(trip, t.from)} <LuArrowRight className="text-muted" aria-label="pays" /> {nameOf(trip, t.to)}</div>
        <Pill tone="neg">Pending</Pill>
      </div>
      <span className="font-display text-lg font-semibold tabular-nums">{inr(t.amount)}</span>
      <div className="flex gap-2 w-full sm:w-auto">
        <Btn kind="soft" className="h-10 flex-1" onClick={pay}><LuCheck /> Mark as paid</Btn>
        <Btn kind="ghost" className="h-10" onClick={() => open({ kind: 'pay', tripId: trip.id, transfer: t })}>Part paid</Btn>
      </div>
    </div>
  );
}

function Settle({ trip, s }: { trip: Trip; s: Summary }) {
  const st = tripStatus(trip, s);
  const opts = useMemo(() => (['direct', 'treasurer', 'fund'] as Method[]).map(m => option(trip, m, s)), [trip, s]);
  const rec = useMemo(() => recommend(trip, s), [trip, s]);
  const chosen = opts.find(o => o.method === trip.method) ?? null;
  const undo = (id: string) => { if (saveTrip({ ...trip, payments: trip.payments.filter(p => p.id !== id) })) toast('Payment removed. Balances updated.'); };
  const groups: [string, Transfer[]][] = !chosen ? [] : chosen.hub
    ? [[`Step 1. Collect: pay ${nameOf(trip, chosen.hub)}`, chosen.transfers.filter(t => t.to === chosen.hub)],
       [`Step 2. Distribute: ${nameOf(trip, chosen.hub)} pays out`, chosen.transfers.filter(t => t.from === chosen.hub)]]
    : [['Payments to make', chosen.transfers]];

  if (st === 'empty') return <Empty title="Nothing to settle yet" body="Add expenses first. Then this page shows who pays whom, three ways." />;
  return (
    <div className="flex flex-col gap-4">
      {st === 'settled' && <SettledBanner />}
      {st === 'open' && (
        <>
          <div>
            <h2 className="font-display text-xl font-semibold">Choose how to settle</h2>
            {rec && <p className="text-sm text-muted">{rec.reason} The choice is yours.</p>}
          </div>
          <div className="grid md:grid-cols-3 gap-3 items-stretch">
            {opts.map(o => <OptionCard key={o.method} trip={trip} s={s} o={o} recommended={rec?.method === o.method} />)}
          </div>
          <div className="flex items-baseline justify-between gap-3 flex-wrap mt-1">
            <h2 className="font-display text-xl font-semibold">Payment checklist</h2>
            {chosen && <span className="text-sm text-muted">{trip.payments.length} paid · {chosen.count} pending</span>}
          </div>
          {!chosen && <p className={`${CARD} p-4 text-sm text-muted`}>Pick a method above and the payments to make will appear here.</p>}
          {groups.filter(g => g[1].length).map(([label, ts]) => (
            <div key={label} className="flex flex-col gap-2">
              {chosen?.hub && <h3 className="text-sm font-semibold text-muted">{label}</h3>}
              {ts.map((t, i) => <PendingRow key={`${t.from}-${t.to}-${i}`} trip={trip} t={t} />)}
            </div>
          ))}
        </>
      )}
      {trip.payments.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted">Paid</h3>
          {trip.payments.map(p => (
            <div key={p.id} className={`${CARD} flex items-center gap-3 p-3`}>
              <LuCircleCheck className="text-pos text-xl shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{nameOf(trip, p.from)} paid {nameOf(trip, p.to)}</div>
                <div className="text-sm text-muted">{fmtDate(p.date)}</div>
              </div>
              <span className="font-display text-lg font-semibold tabular-nums">{inr(p.amount)}</span>
              <Btn kind="ghost" className="h-9 px-2 border-0 text-sm" onClick={() => undo(p.id)}><LuUndo2 /> Undo</Btn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- common fund ----------

function Fund({ trip, s }: { trip: Trip; s: Summary }) {
  const { open, confirm } = useContext(Ui);
  const target = trip.fundPerPerson;
  const plan = useMemo(() => option(trip, 'fund', s), [trip, s]);
  if (!s.fund.inUse) {
    return (
      <Empty title="Common trip fund" body="Everyone puts in an agreed amount before or during the trip, and shared bills are paid from that pot. At the end, whatever is left is refunded according to what each person actually used.">
        <Btn onClick={() => open({ kind: 'fundSetup', tripId: trip.id })}><LuPiggyBank /> Set up a common fund</Btn>
      </Empty>
    );
  }
  const addFull = (personId: string, amount: number) => {
    const next: Trip = { ...trip, contributions: [...trip.contributions, { id: newId('c'), personId, amount, date: today() }] };
    if (saveTrip(next)) toast(`${nameOf(trip, personId)} put ${inr(amount)} into the fund.`);
  };
  const remove = async (id: string) => {
    const c = trip.contributions.find(x => x.id === id)!;
    if (s.fund.cash - c.amount < 0) { toast('The fund has already spent that money. Change a fund expense first.', true); return; }
    if (!(await confirm({ title: 'Remove this contribution?', body: `${nameOf(trip, c.personId)}, ${inr(c.amount)} on ${fmtDate(c.date)}.`, action: 'Remove' }))) return;
    if (saveTrip({ ...trip, contributions: trip.contributions.filter(x => x.id !== id) })) toast('Contribution removed.');
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {[['Collected', s.fund.collected + s.fund.paidIn], ['Spent', s.fund.spent], ['In the fund', s.fund.cash]].map(([label, v]) => (
          <div key={label as string} className={`${CARD} p-3`}>
            <div className="text-xs text-muted">{label}</div>
            <div className="font-display text-lg sm:text-2xl font-semibold tabular-nums break-words">{inr(v as number)}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted">Money put into the fund is not an expense. Only what the fund actually pays for counts as trip spending. To pay a bill from the fund, choose Common fund under Who paid when you add the expense.</p>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-1">
        <h2 className="font-display text-xl font-semibold">Contributions</h2>
        <Btn kind="ghost" className="h-9 text-sm" onClick={() => open({ kind: 'fundSetup', tripId: trip.id })}><LuPencil /> {target ? `${inr(target)} per person` : 'Set amount per person'}</Btn>
      </div>
      {s.people.map(p => {
        const due = Math.max(target - p.contributed, 0);
        return (
          <div key={p.id} className={`${CARD} flex items-center gap-x-3 gap-y-2 p-3 flex-wrap`}>
            <Avatar name={p.name} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{p.name}</div>
              <div className="text-sm text-muted tabular-nums">{inr(p.contributed)}{target ? ` of ${inr(target)}` : ''}</div>
            </div>
            {target > 0 && (due === 0 ? <Pill tone="pos"><LuCheck /> {p.contributed > target ? 'Paid extra' : 'Paid'}</Pill> : <Pill tone="neg">{p.contributed ? `${inr(due)} short` : 'Not paid'}</Pill>)}
            <div className={`flex gap-2 ${due > 0 ? 'w-full sm:w-auto' : ''}`}>
              {due > 0 && <Btn kind="soft" className="h-10 flex-1" onClick={() => addFull(p.id, due)}><LuCheck /> Got {inr(due)}</Btn>}
              <Btn kind="ghost" className="h-10" onClick={() => open({ kind: 'contribution', tripId: trip.id, personId: p.id, due })}>{due > 0 ? 'Other amount' : 'Top up'}</Btn>
            </div>
          </div>
        );
      })}
      <h2 className="font-display text-xl font-semibold mt-1">If the trip ended now</h2>
      <div className={`${CARD} p-4`}>
        {plan.count === 0 ? <p className="text-sm text-muted">Nothing to refund or top up.</p> : (
          <ul className="flex flex-col gap-1.5">
            {plan.transfers.map((t, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 text-sm">
                <span>{t.from === FUND ? `Refund to ${nameOf(trip, t.to)}` : `${nameOf(trip, t.from)} tops up the fund`}</span>
                <span className={`tabular-nums font-semibold ${t.from === FUND ? 'text-pos' : 'text-neg'}`}>{inr(t.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {plan.count > 0 && <p className="text-xs text-muted mt-2">Each refund is what that person put in, minus their share of the expenses they took part in. Use the Settle up tab to record these.</p>}
      </div>
      {trip.contributions.length > 0 && (
        <>
          <h2 className="font-display text-xl font-semibold mt-1">Fund log</h2>
          <div className={`${CARD} divide-y divide-line`}>
            {trip.contributions.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 min-w-0">{nameOf(trip, c.personId)} <span className="text-muted">· {fmtDate(c.date)}</span></span>
                <span className="tabular-nums font-semibold">{inr(c.amount)}</span>
                <button type="button" aria-label={`Remove contribution by ${nameOf(trip, c.personId)}`} onClick={() => remove(c.id)} className="grid place-items-center w-9 h-9 rounded-lg text-neg cursor-pointer hover:bg-neg-bg"><LuTrash2 /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- report ----------

function Report({ trip, s }: { trip: Trip; s: Summary }) {
  const { canDownload } = useStore();
  const [busy, setBusy] = useState('');
  const st = tripStatus(trip, s);
  const pending = option(trip, trip.method ?? 'direct', s).transfers;
  const file = trip.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trip';
  const download = async (kind: 'xlsx' | 'pdf') => {
    setBusy(kind);
    try {
      const data = kind === 'xlsx' ? await buildXlsx(trip) : await buildPdf(trip);
      if (await saveFile(`${file}-expenses.${kind}`, data)) toast('Report saved.');
    } catch {
      toast(kind === 'xlsx' ? 'The Excel exporter could not be loaded. Check your connection and try again.' : 'The PDF could not be created.', true);
    } finally { setBusy(''); }
  };
  const copy = () => {
    navigator.clipboard.writeText(reportText(trip)).then(() => toast('Summary copied. Paste it into your group chat.'), () => toast('Copying is blocked in this view.', true));
  };
  const facts: [string, string][] = [
    ['Destination', trip.destination || 'Not set'],
    ['Dates', dateRange(trip.startDate, trip.endDate) || 'Not set'],
    ['Participants', String(trip.people.length)],
    ['Total expenses', inr(s.total)],
    ['Settlement method', trip.method ? METHOD_NAME[trip.method] + (trip.method === 'treasurer' ? ` (${nameOf(trip, treasurerOf(trip, s) ?? '')})` : '') : 'Not chosen yet'],
    ['Settlement status', st === 'settled' ? 'Settled' : st === 'empty' ? 'No expenses yet' : `${trip.payments.length} paid, ${pending.length} pending`],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className={`${CARD} p-4`}>
        <h2 className="font-display text-xl font-semibold">{trip.name}</h2>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2 text-sm">
          {facts.map(([k, v]) => [<dt key={k} className="text-muted">{k}</dt>, <dd key={k + 'v'} className="text-right font-semibold tabular-nums">{v}</dd>])}
        </dl>
      </div>
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-muted">
              <th className="font-semibold p-3">Person</th><th className="font-semibold p-3 text-right">Paid</th>
              {s.fund.inUse && <th className="font-semibold p-3 text-right">Fund</th>}
              <th className="font-semibold p-3 text-right">Share</th><th className="font-semibold p-3 text-right">Balance</th><th className="font-semibold p-3 text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {s.people.map(p => (
              <tr key={p.id} className="border-t border-line">
                <td className="p-3 font-semibold">{p.name}</td><td className="p-3 text-right">{inr(p.paid)}</td>
                {s.fund.inUse && <td className="p-3 text-right">{inr(p.contributed)}</td>}
                <td className="p-3 text-right">{inr(p.share)}</td>
                <td className={`p-3 text-right font-semibold whitespace-nowrap ${TONE_TEXT[toneOf(p.net)]}`}>{signedInr(p.net)}</td>
                <td className={`p-3 text-right font-semibold whitespace-nowrap ${TONE_TEXT[toneOf(p.outstanding)]}`}>{signedInr(p.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={`${CARD} p-4 flex flex-col gap-2 text-sm`}>
        <h3 className="font-display text-lg font-semibold">Payments</h3>
        {trip.payments.length === 0 && pending.length === 0 && <p className="text-muted">No payments needed.</p>}
        {trip.payments.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><Pill tone="pos">Paid</Pill> {nameOf(trip, p.from)} to {nameOf(trip, p.to)}</span>
            <span className="tabular-nums font-semibold">{inr(p.amount)}</span>
          </div>
        ))}
        {pending.map((t, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><Pill tone="neg">Pending</Pill> {nameOf(trip, t.from)} to {nameOf(trip, t.to)}</span>
            <span className="tabular-nums font-semibold">{inr(t.amount)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {canDownload && <Btn onClick={() => download('xlsx')} disabled={!!busy}><LuFileSpreadsheet /> {busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</Btn>}
        {canDownload && <Btn kind="soft" onClick={() => download('pdf')} disabled={!!busy}><LuFileText /> {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</Btn>}
        <Btn kind="ghost" onClick={copy}><LuCopy /> Copy summary</Btn>
      </div>
      {!canDownload && <p className="text-sm text-muted">File downloads are not available in this view. Copy the summary instead.</p>}
    </div>
  );
}

// ---------- forms ----------

function TripForm({ trip, onClose }: { trip?: Trip; onClose: () => void }) {
  const { confirm } = useContext(Ui);
  const [name, setName] = useState(trip?.name ?? '');
  const [destination, setDestination] = useState(trip?.destination ?? '');
  const [startDate, setStart] = useState(trip?.startDate ?? '');
  const [endDate, setEnd] = useState(trip?.endDate ?? '');
  const [people, setPeople] = useState(trip?.people.map(p => ({ ...p })) ?? []);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');

  const addPerson = () => {
    const n = adding.trim();
    if (!n) return;
    if (people.some(p => p.name.trim().toLowerCase() === n.toLowerCase())) { setError(`${n} is already on the list. Use a different name, like ${n} K.`); return; }
    setPeople([...people, { id: newId('u'), name: n }]); setAdding(''); setError('');
  };
  const removePerson = (id: string) => {
    const used = trip ? personUsage(trip, id) : 0;
    const who = people.find(p => p.id === id)?.name ?? 'This person';
    if (used) { setError(`${who} is part of ${plural(used, 'expense or payment', 'expenses or payments')}. Remove or change those first.`); return; }
    setPeople(people.filter(p => p.id !== id)); setError('');
  };
  const save = () => {
    const list = people.map(p => ({ ...p, name: p.name.trim() }));
    const extra = adding.trim();
    if (extra && !list.some(p => p.name.toLowerCase() === extra.toLowerCase())) list.push({ id: newId('u'), name: extra });
    if (!name.trim()) return setError('Give the trip a name, like Goa Trip 2026.');
    if (list.some(p => !p.name)) return setError('Every person needs a name.');
    if (new Set(list.map(p => p.name.toLowerCase())).size !== list.length) return setError('Two people have the same name. Change one so you can tell them apart.');
    if (list.length < 2) return setError('Add at least two people to split expenses between.');
    if (startDate && endDate && endDate < startDate) return setError('The end date is before the start date.');
    const base: Trip = trip ?? { id: newId('t'), name: '', destination: '', startDate: '', endDate: '', createdAt: Date.now(), people: [], expenses: [], contributions: [], fundPerPerson: 0, payments: [], method: null, treasurerId: null };
    const next: Trip = { ...base, name: name.trim(), destination: destination.trim(), startDate, endDate, people: list };
    if (!saveTrip(next)) return;
    toast(trip ? 'Trip updated.' : 'Trip created. Add your first expense.');
    onClose();
    if (!trip) go('trip-' + next.id);
  };
  const remove = async () => {
    if (!trip) return;
    if (!(await confirm({ title: 'Delete this trip?', body: `${trip.name} and its ${plural(trip.expenses.length, 'expense')} will be removed for good.`, action: 'Delete trip' }))) return;
    if (deleteTrip(trip.id)) { toast('Trip deleted.'); onClose(); go('home'); }
  };
  return (
    <Sheet title={trip ? 'Edit trip' : 'Create new trip'} onClose={onClose} onSubmit={save} footer={<>
      {trip && <Btn kind="danger" className="mr-auto" onClick={remove}><LuTrash2 /> Delete trip</Btn>}
      <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
      <Btn type="submit">{trip ? 'Save changes' : 'Create trip'}</Btn>
    </>}>
      <Field label="Trip name" htmlFor="trip-name"><input id="trip-name" className={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="Goa Trip 2026" autoFocus={!trip} maxLength={60} /></Field>
      <Field label="Destination" htmlFor="trip-destination"><input id="trip-destination" className={INPUT} value={destination} onChange={e => setDestination(e.target.value)} placeholder="Goa" maxLength={60} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" htmlFor="trip-start"><input id="trip-start" type="date" className={INPUT} value={startDate} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="End date" htmlFor="trip-end"><input id="trip-end" type="date" className={INPUT} value={endDate} min={startDate || undefined} onChange={e => setEnd(e.target.value)} /></Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">People on the trip</span>
        {people.map((p, i) => (
          <div key={p.id} className="flex gap-2">
            <input id={`person-${p.id}`} aria-label={`Person ${i + 1}`} className={INPUT} value={p.name} maxLength={30} onChange={e => setPeople(people.map(x => (x.id === p.id ? { ...x, name: e.target.value } : x)))} />
            <button type="button" aria-label={`Remove ${p.name}`} onClick={() => removePerson(p.id)} className="grid place-items-center shrink-0 w-11 h-11 rounded-xl border border-line text-neg cursor-pointer hover:bg-neg-bg"><LuX /></button>
          </div>
        ))}
        <div className="flex gap-2">
          <input id="person-new" aria-label="Name of a person to add" className={INPUT} value={adding} maxLength={30} placeholder="Type a name" onChange={e => setAdding(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } }} />
          <Btn kind="soft" onClick={addPerson}><LuPlus /> Add</Btn>
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Sheet>
  );
}

function defaultDate(trip: Trip): string {
  const t = today();
  if (trip.endDate && t > trip.endDate) return trip.endDate;
  if (trip.startDate && t < trip.startDate) return trip.startDate;
  return t;
}

function ExpenseForm({ trip, expense, onClose }: { trip: Trip; expense?: Expense; onClose: () => void }) {
  const { confirm } = useContext(Ui);
  const s = useMemo(() => summarize(trip), [trip]);
  const last = trip.expenses[trip.expenses.length - 1];
  const firstPayer = last && (last.paidBy === FUND ? s.fund.cash > 0 : s.byId[last.paidBy]) ? last.paidBy : trip.people[0].id;
  const [title, setTitle] = useState(expense?.title ?? '');
  const [amount, setAmount] = useState(expense ? amountText(expense.amount) : '');
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? firstPayer);
  const [category, setCategory] = useState(expense?.category ?? 'Other');
  const [catTouched, setCatTouched] = useState(!!expense);
  const [date, setDate] = useState(expense?.date ?? defaultDate(trip));
  const [among, setAmong] = useState<string[]>(expense?.among ?? trip.people.map(p => p.id));
  const [splitType, setSplitType] = useState<SplitType>(expense?.splitType ?? 'equal');
  const [raw, setRaw] = useState<Record<string, string>>(() => {
    const r: Record<string, string> = {};
    if (expense?.splitType === 'amount') for (const id of expense.among) r[id] = amountText(expense.shares[id] ?? 0);
    if (expense?.splitType === 'percent') for (const id of expense.among) r[id] = String(expense.percents?.[id] ?? 0);
    return r;
  });
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [error, setError] = useState('');
  const [dup, setDup] = useState<Expense | null>(null);

  const paise = parseAmount(amount);
  const ordered = trip.people.filter(p => among.includes(p.id)).map(p => p.id);
  const live = paise && paise > 0 ? computeShares(paise, splitType, ordered, raw) : null;

  const changeTitle = (v: string) => { setTitle(v); if (!catTouched) setCategory(guessCategory(v)); };
  const prefill = (type: SplitType, ids: string[]) => {
    const r: Record<string, string> = {};
    if (type === 'amount' && paise) { const eq = splitEqual(paise, ids); for (const id of ids) r[id] = amountText(eq[id]); }
    if (type === 'percent') { const eq = splitEqual(10000, ids); for (const id of ids) r[id] = String(eq[id] / 100); }
    return r;
  };
  const changeSplit = (type: SplitType) => { setSplitType(type); setRaw(prefill(type, ordered)); setError(''); };
  const toggle = (id: string) => {
    const next = among.includes(id) ? among.filter(x => x !== id) : [...among, id];
    setAmong(next);
    if (splitType !== 'equal') setRaw(prefill(splitType, trip.people.filter(p => next.includes(p.id)).map(p => p.id)));
  };

  const save = (force = false) => {
    const t = title.trim();
    if (!t) return setError('Give the expense a name, like Hotel or Dinner.');
    if (paise === null || paise <= 0) return setError('Enter an amount above zero, like 1500 or 1500.50.');
    if (!date) return setError('Pick the date of the expense.');
    const res = computeShares(paise, splitType, ordered, raw);
    if (!res.ok) return setError(res.error);
    if (paidBy === FUND) {
      const available = s.fund.cash + (expense?.paidBy === FUND ? expense.amount : 0);
      if (paise > available) return setError(`The common fund has only ${inr(Math.max(available, 0))} left. Record a top-up in the Fund tab first, or choose the person who paid from their own pocket.`);
    }
    const next: Expense = {
      id: expense?.id ?? newId('e'), title: t, amount: paise, paidBy, category, date, notes: notes.trim(),
      splitType, among: ordered, shares: res.shares, ...(res.percents ? { percents: res.percents } : {}),
    };
    const twin = findDuplicate(trip, next, expense?.id);
    if (twin && !force) { setError(''); setDup(twin); return; }
    const expenses = expense ? trip.expenses.map(x => (x.id === expense.id ? next : x)) : [...trip.expenses, next];
    if (!saveTrip({ ...trip, expenses })) return;
    toast(expense ? 'Expense updated. Balances recalculated.' : `Added ${t}, ${inr(paise)}.`);
    onClose();
  };
  const remove = async () => {
    if (!expense) return;
    if (!(await confirm({ title: 'Delete this expense?', body: `${expense.title}, ${inr(expense.amount)}. Everyone's balance will be recalculated.`, action: 'Delete expense' }))) return;
    if (saveTrip({ ...trip, expenses: trip.expenses.filter(x => x.id !== expense.id) })) { toast('Expense deleted.'); onClose(); }
  };

  let equalNote = '';
  if (splitType === 'equal' && live?.ok) {
    const vals = Object.values(live.shares);
    const hi = Math.max(...vals), lo = Math.min(...vals);
    equalNote = hi === lo ? `${inr(hi)} each` : `${inr(hi)} or ${inr(lo)} each, so the paise add up exactly`;
  }

  return (
    <Sheet title={expense ? 'Edit expense' : 'Add expense'} onClose={onClose} onSubmit={() => save(false)} footer={dup ? <>
      <Btn kind="ghost" onClick={() => setDup(null)}>Go back</Btn>
      <Btn onClick={() => save(true)}>Save anyway</Btn>
    </> : <>
      {expense && <Btn kind="danger" className="mr-auto" onClick={remove}><LuTrash2 /> Delete</Btn>}
      <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
      <Btn type="submit">{expense ? 'Save changes' : 'Add expense'}</Btn>
    </>}>
      {dup && <ErrorNote>This looks like a duplicate. {dup.title}, {inr(dup.amount)}, paid by {nameOf(trip, dup.paidBy)} on {fmtDate(dup.date)} is already recorded.</ErrorNote>}
      <Field label="What was it for?" htmlFor="expense-title">
        <input id="expense-title" className={INPUT} value={title} onChange={e => changeTitle(e.target.value)} placeholder="Hotel, Petrol, Dinner" autoFocus={!expense} maxLength={60} />
        {!expense && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map(q => <button key={q} type="button" onClick={() => changeTitle(q)} className={`px-3 h-8 rounded-full text-sm font-medium cursor-pointer ${title === q ? 'bg-btn text-btn-ink' : 'bg-zero-bg text-ink hover:bg-mint'}`}>{q}</button>)}
          </div>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)" htmlFor="expense-amount"><input id="expense-amount" className={`${INPUT} tabular-nums`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" /></Field>
        <Field label="Who paid?" htmlFor="expense-payer">
          <select id="expense-payer" className={INPUT} value={paidBy} onChange={e => setPaidBy(e.target.value)}>
            {trip.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            {(s.fund.inUse || paidBy === FUND) && <option value={FUND}>Common fund ({inr(s.fund.cash)} left)</option>}
          </select>
        </Field>
        <Field label="Category" htmlFor="expense-category">
          <select id="expense-category" className={INPUT} value={category} onChange={e => { setCategory(e.target.value); setCatTouched(true); }}>
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
          </select>
        </Field>
        <Field label="Date" htmlFor="expense-date"><input id="expense-date" type="date" className={INPUT} value={date} onChange={e => setDate(e.target.value)} /></Field>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">Split between</span>
          <button type="button" className="text-sm font-semibold underline cursor-pointer" onClick={() => { const all = among.length === trip.people.length ? [] : trip.people.map(p => p.id); setAmong(all); if (splitType !== 'equal') setRaw(prefill(splitType, all)); }}>
            {among.length === trip.people.length ? 'Clear all' : 'Select everyone'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {trip.people.map(p => {
            const on = among.includes(p.id);
            return (
              <button key={p.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(p.id)}
                className={`inline-flex items-center gap-1 px-3 h-9 rounded-full text-sm font-semibold cursor-pointer border ${on ? 'bg-mint border-mint-deep text-ink' : 'bg-surface border-line text-muted'}`}>
                {on && <LuCheck />} {p.name}
              </button>
            );
          })}
        </div>
        <div role="radiogroup" aria-label="How to split" className="grid grid-cols-3 gap-0.5 p-1 rounded-xl bg-zero-bg">
          {([['equal', 'Equally'], ['amount', 'By amount'], ['percent', 'By percent']] as [SplitType, string][]).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={splitType === id} onClick={() => changeSplit(id)}
              className={`h-9 rounded-lg text-sm font-semibold cursor-pointer ${splitType === id ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>{label}</button>
          ))}
        </div>
        {splitType === 'equal' && equalNote && <p className="text-sm text-muted tabular-nums">{equalNote}</p>}
        {splitType !== 'equal' && (
          <div className="flex flex-col gap-2">
            {ordered.map(id => (
              <div key={id} className="flex items-center gap-2">
                <label htmlFor={`share-${id}`} className="flex-1 text-sm">{nameOf(trip, id)}</label>
                <input id={`share-${id}`} inputMode="decimal" className={`${INPUT} w-32 text-right tabular-nums`} value={raw[id] ?? ''} placeholder="0" onChange={e => setRaw({ ...raw, [id]: e.target.value })} />
                <span className="w-4 text-muted">{splitType === 'percent' ? '%' : '₹'}</span>
              </div>
            ))}
            {live && (live.ok
              ? <p className="text-sm font-medium text-pos flex items-center gap-1"><LuCheck /> Adds up to {inr(paise!)}.</p>
              : <p className="text-sm font-medium text-neg">{live.error}</p>)}
          </div>
        )}
      </div>
      <Field label="Notes (optional)" htmlFor="expense-notes"><input id="expense-notes" className={INPUT} value={notes} onChange={e => setNotes(e.target.value)} maxLength={120} /></Field>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Sheet>
  );
}

function PayForm({ trip, transfer, onClose }: { trip: Trip; transfer: Transfer; onClose: () => void }) {
  const [amount, setAmount] = useState(amountText(transfer.amount));
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const save = () => {
    const paise = parseAmount(amount);
    if (paise === null || paise <= 0) return setError('Enter the amount that was paid, like 500 or 500.50.');
    if (paise > transfer.amount) return setError(`That is more than the ${inr(transfer.amount)} due.`);
    if (!date) return setError('Pick the date of the payment.');
    if (!saveTrip({ ...trip, payments: [...trip.payments, { id: newId('p'), from: transfer.from, to: transfer.to, amount: paise, date }] })) return;
    toast(paise < transfer.amount ? `Recorded ${inr(paise)}. ${inr(transfer.amount - paise)} still to pay.` : 'Payment recorded.');
    onClose();
  };
  return (
    <Sheet title="Record a payment" onClose={onClose} onSubmit={save} footer={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit">Record payment</Btn></>}>
      <p className="text-sm">{nameOf(trip, transfer.from)} owes {nameOf(trip, transfer.to)} <strong className="tabular-nums">{inr(transfer.amount)}</strong>. Enter how much has been paid so far.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount paid (₹)" htmlFor="pay-amount"><input id="pay-amount" className={`${INPUT} tabular-nums`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></Field>
        <Field label="Date" htmlFor="pay-date"><input id="pay-date" type="date" className={INPUT} value={date} onChange={e => setDate(e.target.value)} /></Field>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Sheet>
  );
}

function FundSetupForm({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [amount, setAmount] = useState(trip.fundPerPerson ? amountText(trip.fundPerPerson) : '');
  const [error, setError] = useState('');
  const paise = parseAmount(amount);
  const save = () => {
    if (paise === null || paise <= 0) return setError('Enter the amount each person should put in, like 5000.');
    if (!saveTrip({ ...trip, fundPerPerson: paise })) return;
    toast(`Common fund set to ${inr(paise)} per person.`);
    onClose();
  };
  return (
    <Sheet title="Common trip fund" onClose={onClose} onSubmit={save} footer={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit">Save</Btn></>}>
      <Field label="Amount per person (₹)" htmlFor="fund-amount" hint={paise ? `${trip.people.length} people × ${inr(paise)} = ${inr(paise * trip.people.length)} in the fund` : 'You can collect extra later if money runs short.'}>
        <input id="fund-amount" className={`${INPUT} tabular-nums`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="5000" autoFocus />
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Sheet>
  );
}

function ContributionForm({ trip, personId, due, onClose }: { trip: Trip; personId: string; due: number; onClose: () => void }) {
  const [who, setWho] = useState(personId);
  const [amount, setAmount] = useState(due ? amountText(due) : '');
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const save = () => {
    const paise = parseAmount(amount);
    if (paise === null || paise <= 0) return setError('Enter the amount put into the fund, like 2000.');
    if (!date) return setError('Pick the date.');
    if (!saveTrip({ ...trip, contributions: [...trip.contributions, { id: newId('c'), personId: who, amount: paise, date }] })) return;
    toast(`${nameOf(trip, who)} put ${inr(paise)} into the fund.`);
    onClose();
  };
  return (
    <Sheet title="Add to the common fund" onClose={onClose} onSubmit={save} footer={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit">Add to fund</Btn></>}>
      <Field label="Who is paying in?" htmlFor="contribution-person">
        <select id="contribution-person" className={INPUT} value={who} onChange={e => setWho(e.target.value)}>
          {trip.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)" htmlFor="contribution-amount"><input id="contribution-amount" className={`${INPUT} tabular-nums`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></Field>
        <Field label="Date" htmlFor="contribution-date"><input id="contribution-date" type="date" className={INPUT} value={date} onChange={e => setDate(e.target.value)} /></Field>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Sheet>
  );
}

// ---------- app shell ----------

function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1));
  useEffect(() => {
    const f = () => { setHash(location.hash.slice(1)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return hash;
}

function App() {
  const st = useStore();
  const hash = useHash();
  const [modal, setModal] = useState<Modal>(null);
  const [ask, setAsk] = useState<Confirm | null>(null);
  const [note, setNote] = useState<{ msg: string; bad: boolean; n: number } | null>(null);

  useEffect(() => onToast((msg, bad) => setNote({ msg, bad, n: Date.now() })), []);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), note.bad ? 6000 : 3500); return () => clearTimeout(t); }, [note]);

  const ui = useMemo(() => ({
    open: (m: Modal) => setModal(m),
    confirm: (c: Omit<Confirm, 'resolve'>) => new Promise<boolean>(resolve => setAsk({ ...c, resolve })),
  }), []);
  const close = () => setModal(null);
  const answer = (ok: boolean) => { ask?.resolve(ok); setAsk(null); };

  const tripId = hash.startsWith('trip-') ? hash.slice(5) : '';
  const trip = tripId ? st.trips[tripId] : undefined;
  const mTrip = modal && 'tripId' in modal && modal.tripId ? st.trips[modal.tripId] : undefined;

  return (
    <Ui.Provider value={ui}>
      <div className="mx-auto w-full max-w-4xl px-4 pb-28">
        <header className="flex items-center justify-between gap-3 py-4">
          <a href="#home" className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-btn text-btn-ink text-lg" aria-hidden="true">₹</span>
            TripSplit
          </a>
          <span className="text-xs text-muted text-right">{st.mode === 'cloud' ? 'Saved automatically' : st.mode === 'local' ? 'Saved on this device' : ''}</span>
        </header>
        {st.notice && <p role="status" className="mb-4 px-3 py-2 rounded-xl bg-zero-bg text-sm">{st.notice}</p>}
        <main>
          {st.mode === 'loading' ? <p className={`${CARD} p-6 text-muted`}>Loading your trips…</p>
            : tripId && !trip ? (
              <Empty title="This trip is not here" body="It may have been deleted, or the link is from another account."><Btn onClick={() => go('home')}>See all trips</Btn></Empty>
            ) : trip ? <TripPage key={trip.id} trip={trip} /> : <Dashboard trips={Object.values(st.trips)} />}
        </main>
      </div>

      {modal?.kind === 'trip' && (!modal.tripId || mTrip) && <TripForm trip={mTrip} onClose={close} />}
      {modal?.kind === 'expense' && mTrip && <ExpenseForm trip={mTrip} expense={mTrip.expenses.find(e => e.id === modal.expenseId)} onClose={close} />}
      {modal?.kind === 'pay' && mTrip && <PayForm trip={mTrip} transfer={modal.transfer} onClose={close} />}
      {modal?.kind === 'fundSetup' && mTrip && <FundSetupForm trip={mTrip} onClose={close} />}
      {modal?.kind === 'contribution' && mTrip && <ContributionForm trip={mTrip} personId={modal.personId} due={modal.due} onClose={close} />}

      {ask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45">
          <div role="alertdialog" aria-modal="true" aria-label={ask.title} className="w-full max-w-sm bg-surface rounded-3xl p-5 shadow-xl flex flex-col gap-3">
            <h2 className="font-display text-xl font-semibold">{ask.title}</h2>
            <p className="text-sm text-muted">{ask.body}</p>
            <div className="flex justify-end gap-2 mt-1">
              <Btn kind="ghost" onClick={() => answer(false)}>Keep it</Btn>
              <Btn kind="red" onClick={() => answer(true)}>{ask.action}</Btn>
            </div>
          </div>
        </div>
      )}
      {note && (
        <div className="fixed bottom-20 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div role="status" key={note.n} className={`max-w-md px-4 py-2.5 rounded-2xl shadow-lg text-sm font-semibold ${note.bad ? 'bg-neg text-surface' : 'bg-btn text-btn-ink'}`}>{note.msg}</div>
        </div>
      )}
    </Ui.Provider>
  );
}

init();
createRoot(document.getElementById('root')!).render(<App />);
