import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Nango } from '@nangohq/node';
import { createMockNango } from '../mock/nango-mock.js';
import { createApp } from '../server/index.js';

let mock, app, base;

before(async () => {
  mock = createMockNango().listen(0);
  const mockUrl = `http://localhost:${mock.address().port}`;
  app = createApp(new Nango({ host: mockUrl, apiKey: 'test' })).listen(0);
  base = `http://localhost:${app.address().port}`;
});
after(() => {
  mock.close();
  app.close();
});

const call = async (path, opts = {}) => {
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: opts.body && JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json() };
};

// What the mock's Connect UI does after the user clicks "Authorize".
const authorize = async (token) => {
  const res = await fetch(new URL('/__mock/connections', mock_url()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  assert.equal(res.status, 200);
};
const mock_url = () => `http://localhost:${mock.address().port}`;

test('lists all five connectors, none connected', async () => {
  const { body } = await call('/api/connectors');
  assert.deepEqual(
    body.map((c) => c.id),
    ['google-calendar', 'google-meet', 'google-analytics', 'anthropic', 'openai'],
  );
  assert.ok(body.every((c) => c.connected === false));
});

test('actions are refused until connected', async () => {
  const { status } = await call('/api/connectors/anthropic/actions/models', { method: 'POST', body: {} });
  assert.equal(status, 409);
});

test('connect -> run actions through the proxy -> disconnect', async () => {
  for (const id of ['google-calendar', 'google-meet', 'google-analytics', 'anthropic', 'openai']) {
    const { body } = await call(`/api/connectors/${id}/session`, { method: 'POST' });
    assert.match(body.token, /^nango_connect_session_/);
    await authorize(body.token);
  }
  const list = (await call('/api/connectors')).body;
  assert.ok(list.every((c) => c.connected), 'all connected');

  const run = (id, action, input) => call(`/api/connectors/${id}/actions/${action}`, { method: 'POST', body: { input } });

  assert.equal((await run('google-calendar', 'upcoming-events')).body.data.items.length, 2);
  assert.match((await run('google-meet', 'create-space')).body.data.meetingUri, /meet\.google\.com/);
  assert.equal((await run('google-analytics', 'account-summaries')).body.data.accountSummaries.length, 1);
  assert.equal((await run('google-analytics', 'run-report', { propertyId: '123456789' })).body.data.rows.length, 2);
  assert.equal((await run('anthropic', 'message', { model: 'm', prompt: 'hi' })).body.text, 'Hello from mock Claude!');
  assert.equal((await run('openai', 'chat', { model: 'm', prompt: 'hi' })).body.text, 'Hello from mock ChatGPT!');

  await call('/api/connectors/openai/connection', { method: 'DELETE' });
  const after = (await call('/api/connectors')).body;
  assert.equal(after.find((c) => c.id === 'openai').connected, false);
});

test('analytics rejects a non-numeric property id before calling Nango', async () => {
  const { status, body } = await call('/api/connectors/google-analytics/actions/run-report', {
    method: 'POST',
    body: { input: { propertyId: '../evil' } },
  });
  assert.equal(status, 400);
  assert.match(body.error, /numeric/);
});
