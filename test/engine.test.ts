import assert from 'node:assert/strict';
import {
  FUND, Trip, Transfer, parseAmount, inr, splitEqual, splitPercent, computeShares, summarize, balanceNodes,
  settleDirect, settleHub, option, recommend, tripStatus, Method, Id,
} from '../src/engine';
import { demoTrips } from '../src/demo';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ' + name); };

const apply = (nodes: [Id, number][], ts: Transfer[]) => {
  const b = new Map(nodes);
  for (const t of ts) {
    assert(t.amount > 0, 'transfer must be positive');
    b.set(t.from, (b.get(t.from) ?? 0) + t.amount);
    b.set(t.to, (b.get(t.to) ?? 0) - t.amount);
  }
  return [...b.values()];
};

// brute force: largest number of zero-sum groups a set of balances can be split into
function maxGroups(vals: number[]): number {
  if (!vals.length) return 0;
  const [first, ...rest] = vals;
  let best = 0;
  for (let mask = 0; mask < 1 << rest.length; mask++) {
    let sum = first; const others: number[] = [];
    rest.forEach((v, i) => { if (mask & (1 << i)) sum += v; else others.push(v); });
    if (sum === 0) best = Math.max(best, 1 + maxGroups(others));
  }
  return best;
}

ok('parseAmount', () => {
  assert.equal(parseAmount('1,500.50'), 150050);
  assert.equal(parseAmount('₹ 2000'), 200000);
  assert.equal(parseAmount('0.1'), 10);
  assert.equal(parseAmount('12.345'), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(inr(1234567850), '₹1,23,45,678.50');
});

ok('equal split reconciles paise', () => {
  const s = splitEqual(10000, ['a', 'b', 'c']);
  assert.deepEqual(s, { a: 3334, b: 3333, c: 3333 });
  assert.equal(Object.values(splitEqual(100, ['a', 'b', 'c', 'd', 'e', 'f', 'g'])).reduce((x, y) => x + y), 100);
});

ok('percent split reconciles paise', () => {
  const s = splitPercent(10001, ['a', 'b', 'c'], { a: 33.33, b: 33.33, c: 33.34 })!;
  assert.equal(s.a + s.b + s.c, 10001);
  assert.equal(splitPercent(10000, ['a', 'b'], { a: 60, b: 30 }), null);
});

ok('custom split validation', () => {
  assert.equal(computeShares(250000, 'amount', ['a', 'b'], { a: '1500', b: '900' }).ok, false);
  const r = computeShares(250000, 'amount', ['a', 'b'], { a: '1500', b: '1000' });
  assert(r.ok && r.shares.a === 150000 && r.shares.b === 100000);
  assert.equal(computeShares(1000, 'percent', ['a', 'b'], { a: '50', b: '40' }).ok, false);
  assert.equal(computeShares(1000, 'equal', [], {}).ok, false);
});

const [goa, manali, lonavala] = demoTrips();

ok('brief example: balances', () => {
  const t: Trip = { ...lonavala, payments: [] };
  const s = summarize(t);
  assert.equal(s.total, 1200000);
  const row = (name: string) => s.people.find(p => p.name === name)!;
  assert.deepEqual([row('Rahul').paid, row('Rahul').share, row('Rahul').net], [600000, 300000, 300000]);
  assert.deepEqual([row('Hitesh').paid, row('Hitesh').share, row('Hitesh').net], [400000, 300000, 100000]);
  assert.deepEqual([row('Amit').paid, row('Amit').share, row('Amit').net], [200000, 300000, -100000]);
  assert.deepEqual([row('Neha').paid, row('Neha').share, row('Neha').net], [0, 300000, -300000]);
});

ok('brief example: direct = Neha->Rahul 3000, Amit->Hitesh 1000', () => {
  const t: Trip = { ...lonavala, payments: [] };
  const o = option(t, 'direct');
  const txt = o.transfers.map(x => `${x.from}>${x.to}:${x.amount}`).sort();
  assert.deepEqual(txt, ['la>lh:100000', 'ln>lr:300000']);
});

ok('brief example: treasurer Rahul', () => {
  const t: Trip = { ...lonavala, payments: [], treasurerId: 'lr' };
  const o = option(t, 'treasurer');
  const txt = o.transfers.map(x => `${x.from}>${x.to}:${x.amount}`).sort();
  assert.deepEqual(txt, ['la>lr:100000', 'ln>lr:300000', 'lr>lh:100000']);
  assert.equal(o.collect, 400000);
  assert.equal(o.distribute, 100000); // Rahul keeps his own 3,000
});

ok('payment marked paid updates balances; partial payments work', () => {
  const s = summarize(lonavala);
  assert.equal(s.byId['ln'].outstanding, 0);
  assert.equal(s.byId['lr'].outstanding, 0);
  assert.equal(tripStatus(lonavala), 'open');
  const half: Trip = { ...lonavala, payments: [...lonavala.payments, { id: 'x', from: 'la', to: 'lh', amount: 40000, date: '' }] };
  assert.deepEqual(option(half, 'direct').transfers, [{ from: 'la', to: 'lh', amount: 60000 }]);
  const done: Trip = { ...half, payments: [...half.payments, { id: 'y', from: 'la', to: 'lh', amount: 60000, date: '' }] };
  assert.equal(tripStatus(done), 'settled');
  assert.equal(done.expenses, lonavala.expenses); // expense records untouched
});

ok('common fund: 30,000 in, 25,000 spent, 5,000 refunded, nothing double counted', () => {
  const s = summarize(manali);
  assert.equal(s.total, 2500000);           // contributions are not expenses
  assert.equal(s.fund.collected, 3000000);
  assert.equal(s.fund.cash, 500000);
  assert.equal(s.people.reduce((a, p) => a + p.outstanding, 0), 500000);
  const o = option(manali, 'fund');
  assert.equal(o.distribute, 500000);
  assert.equal(o.collect, 0);
  assert(o.transfers.every(t => t.from === FUND));
  assert.equal(recommend(manali)!.method, 'fund');
  assert(apply(balanceNodes(s), o.transfers).every(v => v === 0));
});

ok('goa demo: shares follow participation', () => {
  const s = summarize(goa);
  assert.equal(s.total, 1744550);
  assert.equal(s.people.reduce((a, p) => a + p.share, 0), s.total);
  assert.equal(s.people.reduce((a, p) => a + p.net, 0), 0);
  for (const e of goa.expenses) assert.equal(Object.values(e.shares).reduce((a, b) => a + b, 0), e.amount);
  // Rohit skipped dinner, shopping and water sports
  assert.equal(s.byId['go'].share, 120000 + 40000 + 56000 + 16910);
});

ok('every method settles every random trip to zero; direct is minimal', () => {
  let seed = 42;
  const rnd = (k: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
  for (let run = 0; run < 400; run++) {
    const count = 2 + rnd(8);
    const ids = Array.from({ length: count }, (_, i) => 'p' + i);
    const trip: Trip = {
      id: 't', name: 't', destination: '', startDate: '', endDate: '', createdAt: 0,
      people: ids.map(id => ({ id, name: id })), expenses: [], contributions: [], fundPerPerson: 0,
      payments: [], method: null, treasurerId: null,
    };
    const useFund = rnd(3) === 0;
    if (useFund) for (const id of ids) if (rnd(4)) trip.contributions.push({ id: 'c' + id, personId: id, amount: (1 + rnd(50)) * 10000, date: '' });
    let cash = trip.contributions.reduce((a, c) => a + c.amount, 0);
    for (let e = 0; e < 1 + rnd(10); e++) {
      const among = ids.filter(() => rnd(3) > 0); if (!among.length) among.push(ids[0]);
      const amount = 1 + rnd(run % 2 ? 500000 : 50) * (run % 2 ? 1 : 10000);
      const kind = rnd(3);
      let shares = splitEqual(amount, among);
      if (kind === 1) {
        const pct: Record<string, number> = {}; let left = 10000;
        among.forEach((id, i) => { const v = i === among.length - 1 ? left : rnd(left + 1); pct[id] = v / 100; left -= v; });
        shares = splitPercent(amount, among, pct)!;
      }
      const fromFund = useFund && cash >= amount && rnd(2) === 0;
      if (fromFund) cash -= amount;
      assert.equal(Object.values(shares).reduce((a, b) => a + b, 0), amount);
      trip.expenses.push({ id: 'e' + e, title: 'x', amount, paidBy: fromFund ? FUND : ids[rnd(count)], category: '', date: '', notes: '', splitType: 'equal', among, shares });
    }
    const s = summarize(trip);
    const nodes = balanceNodes(s);
    assert.equal(nodes.reduce((a, x) => a + x[1], 0), 0, 'owed must equal receivable');
    assert.equal(s.people.reduce((a, p) => a + p.outstanding, 0), s.fund.cash);
    for (const method of ['direct', 'treasurer', 'fund'] as Method[]) {
      const o = option(trip, method, s);
      assert(apply(nodes, o.transfers).every(v => v === 0), method + ' must clear all balances');
      // pay the plan off in two halves and check the trip ends settled
      let t2 = trip;
      for (let round = 0; round < 3 && option(t2, method).count; round++) {
        const plan = option(t2, method).transfers;
        t2 = { ...t2, payments: [...t2.payments, ...plan.map((t, i) => ({ id: `r${round}${i}`, from: t.from, to: t.to,
          amount: round === 0 && t.amount > 1 ? Math.floor(t.amount / 2) : t.amount, date: '' }))] };
      }
      assert.equal(tripStatus(t2), 'settled', method + ' must end settled');
    }
    const nz = nodes.filter(x => x[1] !== 0);
    const direct = settleDirect(nodes);
    if (nz.length <= 9) assert.equal(direct.length, nz.length - maxGroups(nz.map(x => x[1])), 'direct must be the true minimum');
    assert(direct.length <= Math.max(0, nz.length - 1));
    assert(direct.length <= settleHub(nodes, ids[0]).length);
  }
});

ok('large group falls back safely', () => {
  const nodes: [string, number][] = Array.from({ length: 30 }, (_, i) => ['p' + i, i % 2 ? 100 * (i + 1) : -100 * (i + 2)]);
  const total = nodes.reduce((a, x) => a + x[1], 0);
  nodes.push(['z', -total]);
  assert(apply(nodes, settleDirect(nodes)).every(v => v === 0));
});

console.log(`\n${n} test groups passed`);
