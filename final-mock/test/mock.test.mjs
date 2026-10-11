import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixtures from '../src/test-customers.json' with { type: 'json' };
import { handle } from '../src/index.js';

const base = 'https://mock.example/voice/v1/';

async function call(service, data) {
  return handle(
    new Request(base + service, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data, call: { ani: '5000000000', lang: 'tr' } }),
    }),
  );
}

async function equalFixture(service, data, fixture) {
  const response = await call(service, data);
  assert.equal(response.status, fixture.http, `${service} HTTP`);
  assert.deepEqual(await response.json(), fixture.response, `${service} body`);
}

test('all supplied service answers match the synthetic fixture exactly', async () => {
  for (const customer of fixtures.customers) {
    const number = customer.customerNo;
    const services = customer.services;
    await equalFixture(
      'cards.list',
      { customerNo: number, aiFlow: 'CardOps' },
      services['cards.list'],
    );
    await equalFixture(
      'contact.email.get',
      { customerNo: number, intAddressInfoType: 'E' },
      services['contact.email.get'],
    );
    for (const [card, fixture] of Object.entries(services['cards.balance'] || {})) {
      await equalFixture('cards.balance', { cardNumber: card }, fixture);
    }
    for (const [card, fixture] of Object.entries(services['statement.week.get'] || {})) {
      await equalFixture('statement.week.get', { cardNumber: card }, fixture);
    }
    for (const service of ['statement.week.decide', 'statement.week.change']) {
      for (const [card, weeks] of Object.entries(services[service] || {})) {
        for (const [week, fixture] of Object.entries(weeks)) {
          await equalFixture(
            service,
            { cardNumber: card, newStatementWeek: Number(week), statementDay: 5 },
            fixture,
          );
        }
      }
    }
    if (services['statement.pdf.send']) {
      const card = Object.keys(services['cards.balance'])[0];
      const date = services['cards.balance'][card].response.data.statementDate;
      await equalFixture(
        'statement.pdf.send',
        {
          customerNo: number,
          cardNumber: card,
          currencyType: 'TL',
          statementDate: date,
          emailAddress: 'test@example.com',
        },
        services['statement.pdf.send'],
      );
    }
  }
});

test('unknown records and missing required data return contract errors', async () => {
  const unknown = await call('cards.list', { customerNo: '00000000', aiFlow: 'CardOps' });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).result.code, 'FB_IVR_CHANNEL_102');
  const invalid = await call('contact.email.get', { customerNo: '90000001' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).result.code, 'INVALID_ARGUMENTS_ERROR');
});
