// A tiny stand-in for a Nango server, for local development and tests only.
// It implements just the endpoints this app uses, with the same shapes as the real
// REST API (verified against @nangohq/node 0.71.x):
//   POST   /connect/sessions        -> { data: { token, connect_link, expires_at } }
//   GET    /connections?endUserId=  -> { connections: [...] }
//   DELETE /connections/:id?provider_config_key=
//   ALL    /proxy/*                 -> canned provider responses
// plus a fake Connect UI at /connect/ that speaks the same postMessage protocol as
// the real iframe (ready -> session_token -> connect/close).
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const connections = new Map(); // `${integration}:${endUser}` -> connection
const sessions = new Map(); // token -> session body

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });

const API_KEY_INTEGRATIONS = new Set(['anthropic', 'openai']);

const connectPage = `<!doctype html><meta charset="utf-8"><title>Mock Connect UI</title>
<style>body{font:15px system-ui;margin:0;display:grid;place-items:center;height:100vh;background:rgba(0,0,0,.45)}
.box{background:#fff;color:#111;padding:24px;border-radius:12px;width:min(360px,90vw)}
button{font:inherit;padding:8px 14px;margin-right:8px;border-radius:8px;border:1px solid #ccc;cursor:pointer}
button.p{background:#4f46e5;color:#fff;border-color:#4f46e5}input{width:100%;padding:8px;margin:8px 0;box-sizing:border-box}</style>
<div class="box"><h3>Mock Nango Connect</h3><p id="msg">Waiting for session…</p><div id="ui"></div></div>
<script>
const origin = location.origin;
let session;
addEventListener('message', async (e) => {
  if (e.data?.type !== 'session_token') return;
  const r = await fetch('/connect/session?token=' + e.data.sessionToken);
  session = (await r.json()).data;
  const key = session.allowed_integrations[0];
  document.getElementById('msg').textContent = 'Connect ' + key + ' as ' + session.end_user.id;
  const needsKey = ${JSON.stringify([...API_KEY_INTEGRATIONS])}.includes(key);
  document.getElementById('ui').innerHTML =
    (needsKey ? '<input id="k" placeholder="API key" value="sk-mock">' : '') +
    '<button class="p" id="go">Authorize</button><button id="x">Cancel</button>';
  document.getElementById('x').onclick = () => parent.postMessage({ type: 'close' }, '*');
  document.getElementById('go').onclick = async () => {
    const r = await fetch('/__mock/connections', { method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({ token: e.data.sessionToken }) });
    const conn = await r.json();
    parent.postMessage({ type: 'connect', payload: { connectionId: conn.connection_id, providerConfigKey: key } }, '*');
    parent.postMessage({ type: 'close' }, '*');
  };
});
parent.postMessage({ type: 'ready' }, '*');
</script>`;

// Canned upstream responses keyed by "METHOD path".
const upstream = {
  'GET /calendar/v3/calendars/primary/events': {
    kind: 'calendar#events',
    items: [
      { id: 'e1', summary: 'Standup', start: { dateTime: '2026-11-02T09:30:00Z' } },
      { id: 'e2', summary: 'Design review', start: { dateTime: '2026-11-02T14:00:00Z' } },
    ],
  },
  'GET /calendar/v3/users/me/calendarList': { items: [{ id: 'primary', summary: 'Demo calendar', primary: true }] },
  'POST /v2/spaces': { name: 'spaces/mock123', meetingUri: 'https://meet.google.com/abc-defg-hij', meetingCode: 'abc-defg-hij' },
  'GET /v2/conferenceRecords': { conferenceRecords: [{ name: 'conferenceRecords/c1', startTime: '2026-10-28T10:00:00Z' }] },
  'GET /v1beta/accountSummaries': {
    accountSummaries: [{ account: 'accounts/1', displayName: 'Demo Co', propertySummaries: [{ property: 'properties/123456789', displayName: 'Demo site' }] }],
  },
  'POST /v1beta/properties/123456789:runReport': {
    rows: [
      { dimensionValues: [{ value: '20261027' }], metricValues: [{ value: '120' }, { value: '150' }] },
      { dimensionValues: [{ value: '20261028' }], metricValues: [{ value: '98' }, { value: '110' }] },
    ],
  },
  'GET /v1/models': { data: [{ id: 'mock-model-1' }, { id: 'mock-model-2' }] },
  'POST /v1/messages': { content: [{ type: 'text', text: 'Hello from mock Claude!' }] },
  'POST /v1/chat/completions': { choices: [{ message: { role: 'assistant', content: 'Hello from mock ChatGPT!' } }] },
};

export function createMockNango() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const auth = req.headers.authorization;

    if (url.pathname === '/health') return json(res, 200, { ok: true });

    if (url.pathname.startsWith('/connect/') && req.method === 'GET' && url.pathname !== '/connect/session' && url.pathname !== '/connect/sessions') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(connectPage);
    }
    if (url.pathname === '/connect/session' && req.method === 'GET') {
      const s = sessions.get(url.searchParams.get('token'));
      return s ? json(res, 200, { data: s }) : json(res, 404, { error: { code: 'unknown_session' } });
    }
    if (url.pathname === '/__mock/connections' && req.method === 'POST') {
      const { token } = await readBody(req);
      const s = sessions.get(token);
      if (!s) return json(res, 404, { error: 'unknown_session' });
      const key = s.allowed_integrations[0];
      const conn = {
        id: connections.size + 1,
        connection_id: `conn-${key}-${s.end_user.id}`,
        provider_config_key: key,
        provider: key,
        created: new Date().toISOString(),
        end_user: s.end_user,
      };
      connections.set(`${key}:${s.end_user.id}`, conn);
      return json(res, 200, conn);
    }

    // Everything below is the authenticated server API.
    if (!auth?.startsWith('Bearer ')) return json(res, 401, { error: { code: 'missing_auth_header' } });

    if (url.pathname === '/connect/sessions' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.end_user?.id) return json(res, 400, { error: { code: 'invalid_body' } });
      const token = `nango_connect_session_${Math.random().toString(36).slice(2)}`;
      sessions.set(token, body);
      return json(res, 201, { data: { token, connect_link: `http://mock/connect/${token}`, expires_at: new Date(Date.now() + 36e5).toISOString() } });
    }
    if (url.pathname === '/connections' && req.method === 'GET') {
      const user = url.searchParams.get('endUserId');
      const integration = url.searchParams.get('integrationId');
      const list = [...connections.values()].filter(
        (c) => (!user || c.end_user.id === user) && (!integration || c.provider_config_key === integration),
      );
      return json(res, 200, { connections: list });
    }
    if (url.pathname.startsWith('/connections/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/')[2]);
      for (const [k, c] of connections) if (c.connection_id === id) connections.delete(k);
      return json(res, 200, { success: true });
    }
    if (url.pathname.startsWith('/proxy/')) {
      const connectionId = req.headers['connection-id'];
      const integration = req.headers['provider-config-key'];
      const known = [...connections.values()].some((c) => c.connection_id === connectionId && c.provider_config_key === integration);
      if (!known) return json(res, 404, { error: { code: 'unknown_connection' } });
      const hit = upstream[`${req.method} ${url.pathname.slice('/proxy'.length)}`];
      if (!hit) return json(res, 404, { error: { message: `mock has no response for ${req.method} ${url.pathname}` } });
      return json(res, 200, hit);
    }
    json(res, 404, { error: { code: 'not_found', path: url.pathname } });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MOCK_PORT || 3003);
  createMockNango().listen(port, () => console.log(`Mock Nango on http://localhost:${port}`));
}
