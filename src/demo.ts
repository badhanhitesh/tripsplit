import { FUND, Trip, Expense, splitEqual, splitPercent, Id } from './engine';

// Three example trips that exercise every feature. Ids are fixed so loading twice never duplicates.

function equal(id: string, title: string, rupees: number, paidBy: Id, category: string, date: string, among: Id[], notes = ''): Expense {
  const amount = Math.round(rupees * 100);
  return { id, title, amount, paidBy, category, date, notes, splitType: 'equal', among, shares: splitEqual(amount, among) };
}

export function demoTrips(): Trip[] {
  const now = Date.now();

  // 1. Goa: equal, custom-amount and percent splits, people skipping expenses, paise rounding.
  const g = { h: 'gh', r: 'gr', a: 'ga', n: 'gn', o: 'go' };
  const all = [g.h, g.r, g.a, g.n, g.o];
  const scooterPct = { [g.o]: 40, [g.r]: 30, [g.h]: 30 };
  const goa: Trip = {
    id: 'demo-goa', name: 'Goa Trip 2026', destination: 'Goa', startDate: '2026-10-22', endDate: '2026-10-26', createdAt: now,
    people: [
      { id: g.h, name: 'Hitesh' }, { id: g.r, name: 'Rahul' }, { id: g.a, name: 'Amit' },
      { id: g.n, name: 'Neha' }, { id: g.o, name: 'Rohit' },
    ],
    expenses: [
      equal('ge1', 'Hotel', 6000, g.r, 'Stay', '2026-10-22', all, '2 rooms, 2 nights'),
      equal('ge2', 'Petrol', 2000, g.h, 'Travel', '2026-10-22', all),
      equal('ge3', 'Dinner', 1500, g.a, 'Food', '2026-10-23', [g.h, g.r, g.a, g.n], 'Rohit skipped'),
      { id: 'ge4', title: 'Shopping', amount: 250000, paidBy: g.n, category: 'Shopping', date: '2026-10-24', notes: 'Flea market',
        splitType: 'amount', among: [g.n, g.h, g.a], shares: { [g.n]: 150000, [g.h]: 60000, [g.a]: 40000 } },
      { id: 'ge5', title: 'Scooter rental', amount: 140000, paidBy: g.o, category: 'Travel', date: '2026-10-24', notes: '',
        splitType: 'percent', among: [g.o, g.r, g.h], percents: scooterPct,
        shares: splitPercent(140000, [g.o, g.r, g.h], scooterPct)! },
      equal('ge6', 'Water sports', 3200, g.h, 'Activities', '2026-10-25', [g.h, g.r, g.n]),
      equal('ge7', 'Breakfast', 845.5, g.a, 'Food', '2026-10-26', all),
    ],
    contributions: [], fundPerPerson: 0, payments: [], method: null, treasurerId: null,
  };

  // 2. Manali: everything runs through a common fund. 6 x 5,000 collected, 25,000 spent, 5,000 to refund.
  const m = ['ms', 'mm', 'mh', 'mp', 'mv', 'ma'];
  const manali: Trip = {
    id: 'demo-manali', name: 'Manali Family Trip', destination: 'Manali', startDate: '2026-11-05', endDate: '2026-11-10', createdAt: now - 1000,
    people: [
      { id: m[0], name: 'Suresh' }, { id: m[1], name: 'Meena' }, { id: m[2], name: 'Hitesh' },
      { id: m[3], name: 'Pooja' }, { id: m[4], name: 'Vikram' }, { id: m[5], name: 'Anita' },
    ],
    expenses: [
      equal('me1', 'Cottage stay', 12000, FUND, 'Stay', '2026-11-05', m),
      equal('me2', 'Cab from Chandigarh', 6500, FUND, 'Travel', '2026-11-05', m),
      equal('me3', 'Meals', 4200, FUND, 'Food', '2026-11-08', m),
      equal('me4', 'Solang Valley rides', 2300, FUND, 'Activities', '2026-11-09', m.slice(2), 'Suresh and Meena stayed back'),
    ],
    contributions: m.map((id, i) => ({ id: 'mc' + i, personId: id, amount: 500000, date: '2026-11-01' })),
    fundPerPerson: 500000, payments: [], method: 'fund', treasurerId: null,
  };

  // 3. Lonavala: the worked example from the brief, with one payment already made.
  const l = { r: 'lr', h: 'lh', a: 'la', n: 'ln' };
  const four = [l.r, l.h, l.a, l.n];
  const lonavala: Trip = {
    id: 'demo-lonavala', name: 'Lonavala Weekend', destination: 'Lonavala', startDate: '2026-08-15', endDate: '2026-08-16', createdAt: now - 2000,
    people: [{ id: l.r, name: 'Rahul' }, { id: l.h, name: 'Hitesh' }, { id: l.a, name: 'Amit' }, { id: l.n, name: 'Neha' }],
    expenses: [
      equal('le1', 'Villa', 6000, l.r, 'Stay', '2026-08-15', four),
      equal('le2', 'Food and groceries', 2500, l.h, 'Food', '2026-08-15', four),
      equal('le3', 'Fuel and tolls', 1500, l.h, 'Travel', '2026-08-15', four),
      equal('le4', 'Dinner', 2000, l.a, 'Food', '2026-08-16', four),
    ],
    contributions: [], fundPerPerson: 0,
    payments: [{ id: 'lp1', from: l.n, to: l.r, amount: 300000, date: '2026-08-18' }],
    method: 'direct', treasurerId: null,
  };

  return [goa, manali, lonavala];
}
