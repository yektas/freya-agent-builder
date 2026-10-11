import fixtures from './test-customers.json' with { type: 'json' };

const prefix = '/voice/v1/';
const serviceNames = new Set([
  'cards.list',
  'cards.balance',
  'statement.week.get',
  'statement.week.decide',
  'statement.week.change',
  'contact.email.get',
  'statement.pdf.send',
]);
const customers = new Map(
  fixtures.customers.map((customer) => [String(customer.customerNo), customer]),
);
const cards = new Map();
for (const customer of fixtures.customers) {
  for (const cardNumber of Object.keys(customer.services['cards.balance'] || {})) {
    cards.set(cardNumber, customer);
  }
}
const exampleCustomer = customers.get('90000001');
const exampleCard = Object.keys(exampleCustomer.services['cards.balance'])[0];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function error(code, message, status, type = 'ERROR') {
  const guid = '00000000000000000000000000000000';
  return json(
    {
      result: {
        guid,
        returnCode: code,
        messageText: message,
        code,
        message,
        type,
        details: {
          guid,
          rootCause: status === 404 ? 'NotFoundException' : 'InvalidArguments',
          errorOrigin: 'freyabank-statement-mock',
        },
      },
    },
    status,
  );
}

function invalid(field) {
  return error('INVALID_ARGUMENTS_ERROR', `${field} cannot be empty`, 400);
}

function missing(service) {
  const codes = {
    'cards.list': ['FB_IVR_CHANNEL_102', 'Müşteriye ait geçerli kart bilgisi bulunamadı.'],
    'cards.balance': ['FB_IVR_CHANNEL_120', 'Kart bakiye servisi hatası: kart bulunamadı'],
    'statement.week.get': ['FB_IVR_CHANNEL_121', 'Kart bulunamadı'],
    'statement.pdf.send': ['FB_IVR_CHANNEL_107', 'Pdf dokümanı bulunamadı'],
  };
  const item = codes[service];
  return item ? error(item[0], item[1], 404, 'WARNING') : invalid('data');
}

function value(data, field) {
  const raw = data?.[field];
  return typeof raw === 'string' ? raw.trim() : raw;
}

function isTemplateVariable(raw) {
  return typeof raw === 'string' && /^\{\{[^{}]+\}\}$/.test(raw.trim());
}

function required(data, fields) {
  for (const field of fields) {
    const raw = value(data, field);
    if (raw === undefined || raw === null || raw === '') return field;
  }
  return null;
}

function responseOf(entry) {
  if (!entry || typeof entry.http !== 'number' || !entry.response) return null;
  const delay = Number(entry.delaySeconds || 0);
  return delay > 0
    ? new Promise((resolve) =>
        setTimeout(() => resolve(json(entry.response, entry.http)), delay * 1000),
      )
    : json(entry.response, entry.http);
}

export async function handle(request) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, customers: customers.size });
  }
  if (!url.pathname.startsWith(prefix) || !serviceNames.has(url.pathname.slice(prefix.length))) {
    return json({ hata: 'kayıt bulunamadı' }, 404);
  }
  if (request.method !== 'POST') {
    return json({ hata: 'method not allowed' }, 405);
  }
  const service = url.pathname.slice(prefix.length);
  let body;
  try {
    body = await request.json();
  } catch {
    return invalid('data');
  }
  const data = body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid('data');
  const fields = {
    'cards.list': ['customerNo'],
    'cards.balance': ['cardNumber'],
    'statement.week.get': ['cardNumber'],
    'statement.week.decide': ['cardNumber', 'newStatementWeek', 'statementDay'],
    'statement.week.change': ['cardNumber', 'newStatementWeek', 'statementDay'],
    'contact.email.get': ['customerNo', 'intAddressInfoType'],
    'statement.pdf.send': [
      'customerNo',
      'cardNumber',
      'currencyType',
      'statementDate',
      'emailAddress',
    ],
  }[service];
  const absent = required(data, fields);
  if (absent) return invalid(absent);

  let customerNo = String(value(data, 'customerNo') ?? '');
  let cardNumber = String(value(data, 'cardNumber') ?? '');
  let week = String(value(data, 'newStatementWeek') ?? '');
  if (isTemplateVariable(customerNo)) customerNo = '90000001';
  if (isTemplateVariable(cardNumber)) cardNumber = exampleCard;
  if (isTemplateVariable(week)) week = '2';

  if (service === 'cards.list' || service === 'contact.email.get') {
    const customer = customers.get(customerNo);
    return (await responseOf(customer?.services[service])) || missing(service);
  }
  if (service === 'statement.pdf.send') {
    const customer = customers.get(customerNo);
    return (await responseOf(customer?.services[service])) || missing(service);
  }
  const customer = cards.get(cardNumber);
  if (!customer) return missing(service);
  const byCard = customer.services[service]?.[cardNumber];
  if (service === 'statement.week.decide' || service === 'statement.week.change') {
    if (!/^[1-4]$/.test(week)) return invalid('newStatementWeek');
    return (await responseOf(byCard?.[week])) || missing(service);
  }
  return (await responseOf(byCard)) || missing(service);
}

export default { fetch: handle };
