import assert from 'node:assert/strict';
import fixtures from '../src/test-customers.json' with { type: 'json' };

const base = process.env.MOCK_URL;
if (!base || !base.startsWith('https://'))
  throw new Error('Set MOCK_URL to the deployed Worker URL.');
const customer = fixtures.customers.find((item) => String(item.customerNo) === '90000001');
const card = Object.keys(customer.services['cards.balance'])[0];
const date = customer.services['cards.balance'][card].response.data.statementDate;
const cases = [
  [
    'cards.list',
    { customerNo: customer.customerNo, aiFlow: 'CardOps' },
    customer.services['cards.list'],
  ],
  ['cards.balance', { cardNumber: card }, customer.services['cards.balance'][card]],
  ['statement.week.get', { cardNumber: card }, customer.services['statement.week.get'][card]],
  [
    'statement.week.decide',
    { cardNumber: card, newStatementWeek: 2, statementDay: 5 },
    customer.services['statement.week.decide'][card]['2'],
  ],
  [
    'statement.week.change',
    { cardNumber: card, newStatementWeek: 2, statementDay: 5 },
    customer.services['statement.week.change'][card]['2'],
  ],
  [
    'contact.email.get',
    { customerNo: customer.customerNo, intAddressInfoType: 'E' },
    customer.services['contact.email.get'],
  ],
  [
    'statement.pdf.send',
    {
      customerNo: customer.customerNo,
      cardNumber: card,
      currencyType: 'TL',
      statementDate: date,
      emailAddress: 'ornek@freyabank.example',
    },
    customer.services['statement.pdf.send'],
  ],
];
const health = await fetch(base + '/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).customers, fixtures.customers.length);
for (const [service, data, expected] of cases) {
  const response = await fetch(base + '/voice/v1/' + service, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data, call: { ani: '5000000000', lang: 'tr' } }),
  });
  assert.equal(response.status, expected.http, service + ' HTTP');
  assert.deepEqual(await response.json(), expected.response, service + ' body');
  process.stdout.write(service + ' OK\n');
}
