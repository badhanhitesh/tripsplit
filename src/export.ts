// Trip report as text, Excel (.xlsx) and PDF.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Trip, summarize, option, tripStatus, nameOf, rupees, FUND, treasurerOf, Method } from './engine';

export const METHOD_NAME: Record<Method, string> = {
  direct: 'Pay each other directly',
  treasurer: 'Trip Treasurer',
  fund: 'Common trip fund',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}
export function dateRange(a: string, b: string): string {
  if (a && b && a !== b) {
    const [d1, m1, y1] = fmtDate(a).split(' '), [, m2, y2] = fmtDate(b).split(' ');
    if (y1 !== y2) return `${fmtDate(a)} \u2013 ${fmtDate(b)}`;
    return m1 === m2 ? `${d1}\u2013${fmtDate(b)}` : `${d1} ${m1} \u2013 ${fmtDate(b)}`;
  }
  return fmtDate(a || b);
}

function report(trip: Trip) {
  const s = summarize(trip);
  const status = tripStatus(trip, s);
  const method = trip.method;
  const pending = method ? option(trip, method, s).transfers : option(trip, 'direct', s).transfers;
  const statusText = status === 'settled' ? 'Settled' : status === 'empty' ? 'No expenses yet' : `${pending.length} payment${pending.length === 1 ? '' : 's'} pending`;
  const methodText = method ? METHOD_NAME[method] + (method === 'treasurer' ? ` (${nameOf(trip, treasurerOf(trip, s) ?? '')})` : '') : 'Not chosen yet';
  return { s, status, pending, statusText, methodText };
}

const rs = (p: number) => (p < 0 ? '-' : '') + 'Rs ' + rupees(p);
const signed = (p: number) => (p > 0 ? '+' : p < 0 ? '-' : '') + 'Rs ' + rupees(p);

/** A short plain-text summary, handy for pasting into a group chat. */
export function reportText(trip: Trip): string {
  const { s, pending, statusText, methodText } = report(trip);
  const L: string[] = [];
  L.push(`${trip.name}${trip.destination ? ' (' + trip.destination + ')' : ''}`);
  const when = dateRange(trip.startDate, trip.endDate);
  if (when) L.push(when);
  L.push(`Total spent: ₹${rupees(s.total)} by ${trip.people.length} people`, '');
  L.push('Balances');
  for (const p of s.people) {
    const o = p.outstanding;
    L.push(`- ${p.name}: paid ₹${rupees(p.paid)}, share ₹${rupees(p.share)}, ${o > 0 ? 'gets back ₹' + rupees(o) : o < 0 ? 'owes ₹' + rupees(o) : 'settled'}`);
  }
  L.push('', `Settlement: ${methodText}. ${statusText}.`);
  if (pending.length) { L.push('To pay'); for (const t of pending) L.push(`- ${nameOf(trip, t.from)} pays ${nameOf(trip, t.to)} ₹${rupees(t.amount)}`); }
  if (trip.payments.length) { L.push('Paid'); for (const t of trip.payments) L.push(`- ${nameOf(trip, t.from)} paid ${nameOf(trip, t.to)} ₹${rupees(t.amount)}`); }
  return L.join('\n');
}

// ---------- Excel ----------

let xlsxLoading: Promise<any> | null = null;
function loadXlsx(): Promise<any> {
  const w = window as any;
  if (w.XLSX) return Promise.resolve(w.XLSX);
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      el.onload = () => (w.XLSX ? resolve(w.XLSX) : reject(new Error('missing')));
      el.onerror = () => { xlsxLoading = null; reject(new Error('load failed')); };
      document.head.appendChild(el);
    });
  }
  return xlsxLoading;
}

export async function buildXlsx(trip: Trip): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  const { s, pending, statusText, methodText } = report(trip);
  const r = (p: number) => p / 100;
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: any[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(wch => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  const fundCols = s.fund.inUse;
  add('Summary', [
    ['Trip', trip.name], ['Destination', trip.destination], ['Dates', dateRange(trip.startDate, trip.endDate)],
    ['Participants', trip.people.length], ['Total expenses (INR)', r(s.total)],
    ['Settlement method', methodText], ['Settlement status', statusText],
    ...(fundCols ? [['Fund collected (INR)', r(s.fund.collected)], ['Fund spent (INR)', r(s.fund.spent)], ['Fund balance (INR)', r(s.fund.cash)]] : []),
    [],
    ['Person', 'Paid', 'Share', ...(fundCols ? ['Put into fund'] : []), 'Balance', 'Settled so far', 'Still outstanding', 'Status'],
    ...s.people.map(p => [p.name, r(p.paid), r(p.share), ...(fundCols ? [r(p.contributed)] : []), r(p.net), r(p.sent - p.received), r(p.outstanding),
      p.outstanding > 0 ? 'Gets money' : p.outstanding < 0 ? 'Needs to pay' : 'Settled']),
  ], [24, 16, 14, 14, 14, 16, 18, 14]);

  add('Expenses', [
    ['Date', 'Expense', 'Category', 'Paid by', 'Amount', 'Split', 'Shared between', 'Notes', ...trip.people.map(p => p.name + ' share')],
    ...[...trip.expenses].sort((a, b) => a.date.localeCompare(b.date)).map(e => [
      e.date, e.title, e.category, nameOf(trip, e.paidBy), r(e.amount),
      e.splitType === 'equal' ? 'Equal' : e.splitType === 'percent' ? 'By percent' : 'By amount',
      e.among.map(id => nameOf(trip, id)).join(', '), e.notes, ...trip.people.map(p => r(e.shares[p.id] ?? 0)),
    ]),
  ], [12, 24, 14, 14, 12, 12, 36, 24, ...trip.people.map(() => 14)]);

  add('Settlement', [
    ['Status', 'From', 'To', 'Amount', 'Date'],
    ...trip.payments.map(p => ['Paid', nameOf(trip, p.from), nameOf(trip, p.to), r(p.amount), p.date]),
    ...pending.map(t => ['Pending', nameOf(trip, t.from), nameOf(trip, t.to), r(t.amount), '']),
  ], [12, 18, 18, 14, 12]);

  if (fundCols) {
    add('Common fund', [
      ['Date', 'Person', 'Contribution'],
      ...trip.contributions.map(c => [c.date, nameOf(trip, c.personId), r(c.amount)]),
      [], ['Collected', '', r(s.fund.collected)], ['Spent from fund', '', r(s.fund.spent)], ['In the fund now', '', r(s.fund.cash)],
    ], [14, 18, 14]);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

// ---------- PDF ----------

// The built-in PDF fonts only cover Latin text, so anything else is replaced.
const clean = (t: string) => String(t).replace(/₹/g, 'Rs ').replace(/[−–—]/g, '-').replace(/→/g, '->')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA1-\xFF]/g, '?');

export async function buildPdf(trip: Trip): Promise<Uint8Array> {
  const { s, pending, statusText, methodText } = report(trip);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 44;
  const ink = rgb(0.14, 0.16, 0.16), grey = rgb(0.42, 0.45, 0.43), line = rgb(0.86, 0.88, 0.84), green = rgb(0.1, 0.45, 0.25), red = rgb(0.72, 0.22, 0.18);
  let page = doc.addPage([W, H]);
  let y = H - M;
  const need = (h: number) => { if (y - h < M) { page = doc.addPage([W, H]); y = H - M; } };
  const fit = (t: string, f: typeof font, size: number, w: number) => {
    let out = clean(t);
    if (f.widthOfTextAtSize(out, size) <= w) return out;
    while (out.length > 1 && f.widthOfTextAtSize(out + '...', size) > w) out = out.slice(0, -1);
    return out + '...';
  };
  const text = (t: string, x: number, size = 10, f = font, color = ink) => page.drawText(clean(t), { x, y, size, font: f, color });
  const heading = (t: string) => { need(40); y -= 14; text(t, M, 13, bold); y -= 18; };
  type Col = { w: number; right?: boolean };
  const table = (cols: Col[], head: string[], rows: { cells: string[]; colors?: (typeof ink | undefined)[] }[]) => {
    const drawRow = (cells: string[], f: typeof font, colors?: (typeof ink | undefined)[]) => {
      let x = M;
      cells.forEach((c, i) => {
        const w = cols[i].w - 8;
        const t = fit(c, f, 9.5, w);
        const tx = cols[i].right ? x + w - f.widthOfTextAtSize(t, 9.5) : x;
        page.drawText(t, { x: tx, y, size: 9.5, font: f, color: colors?.[i] ?? (f === bold ? grey : ink) });
        x += cols[i].w;
      });
    };
    need(34);
    drawRow(head, bold);
    y -= 5; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: line }); y -= 13;
    for (const r of rows) { need(16); drawRow(r.cells, font, r.colors); y -= 15; }
    y -= 4;
  };

  text(trip.name, M, 20, bold); y -= 18;
  text([trip.destination, dateRange(trip.startDate, trip.endDate)].filter(Boolean).join('   |   ') || 'Trip expense report', M, 10.5, font, grey); y -= 22;
  const facts: [string, string][] = [
    ['Participants', String(trip.people.length)], ['Total expenses', rs(s.total)],
    ['Settlement method', methodText], ['Settlement status', statusText],
  ];
  if (s.fund.inUse) facts.push(['Common fund', `${rs(s.fund.collected)} collected, ${rs(s.fund.spent)} spent, ${rs(s.fund.cash)} left`]);
  for (const [k, v] of facts) { text(k, M, 10, font, grey); text(v, M + 120, 10, bold); y -= 15; }

  heading('Who paid what');
  const colour = (v: number) => (v > 0 ? green : v < 0 ? red : grey);
  table([{ w: 130 }, { w: 90, right: true }, { w: 90, right: true }, { w: 95, right: true }, { w: 102, right: true }],
    ['Person', 'Paid', 'Share', 'Balance', 'Still outstanding'],
    s.people.map(p => ({
      cells: [p.name, rs(p.paid + p.contributed), rs(p.share), signed(p.net), signed(p.outstanding)],
      colors: [undefined, undefined, undefined, colour(p.net), colour(p.outstanding)],
    })));
  if (s.fund.inUse) { text('Paid includes money put into the common fund.', M, 8.5, font, grey); y -= 12; }

  heading('Settlement');
  if (!trip.payments.length && !pending.length) { text('Nothing to settle.', M, 10, font, grey); y -= 15; }
  else table([{ w: 70 }, { w: 150 }, { w: 150 }, { w: 80, right: true }, { w: 57, right: true }], ['Status', 'From', 'To', 'Amount', 'Date'], [
    ...trip.payments.map(p => ({ cells: ['Paid', nameOf(trip, p.from), nameOf(trip, p.to), rs(p.amount), p.date.slice(5).split('-').reverse().join('/')], colors: [green] })),
    ...pending.map(t => ({ cells: ['Pending', nameOf(trip, t.from), nameOf(trip, t.to), rs(t.amount), ''], colors: [red] })),
  ]);

  heading('Expenses');
  if (!trip.expenses.length) { text('No expenses recorded.', M, 10, font, grey); y -= 15; }
  else table([{ w: 62 }, { w: 130 }, { w: 80 }, { w: 80, right: true }, { w: 155 }], ['Date', 'Expense', 'Paid by', 'Amount', '   Shared between'],
    [...trip.expenses].sort((a, b) => a.date.localeCompare(b.date)).map(e => ({
      cells: [fmtDate(e.date).replace(/ \d{4}$/, ''), e.title, nameOf(trip, e.paidBy), rs(e.amount),
        '   ' + (e.among.length === trip.people.length ? 'Everyone' : e.among.map(id => nameOf(trip, id)).join(', '))],
    })));

  void FUND;
  return doc.save();
}
