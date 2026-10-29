import { ConnectUI } from '/vendor/nango-frontend/index.js';

const app = document.getElementById('app');
const banner = document.getElementById('banner');
let config;

const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    ...opts,
    headers: { 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
};

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.flat().filter((c) => c != null));
  return node;
};

function showBanner(msg) {
  banner.hidden = !msg;
  banner.textContent = msg || '';
}

// Opens Nango Connect UI for one integration, then refreshes when it reports success.
async function connect(connector) {
  showBanner('');
  const ui = new ConnectUI({
    baseURL: config.connectUrl,
    apiURL: config.apiUrl,
    onEvent: (event) => {
      if (event.type === 'connect') load();
      if (event.type === 'error') showBanner(event.payload?.errorMessage || 'Connection failed');
    },
  });
  ui.open();
  try {
    const { token } = await api(`/api/connectors/${connector.id}/session`, { method: 'POST' });
    ui.setSessionToken(token);
  } catch (err) {
    ui.close();
    showBanner(err.message);
  }
}

async function disconnect(connector) {
  try {
    await api(`/api/connectors/${connector.id}/connection`, { method: 'DELETE' });
    load();
  } catch (err) {
    showBanner(err.message);
  }
}

function actionPanel(connector, action) {
  const out = el('div');
  const fields = (action.inputs || []).map((input) => {
    const control = el(input.multiline ? 'textarea' : 'input', {
      name: input.name,
      value: input.default || '',
      placeholder: input.placeholder || '',
      required: Boolean(input.required),
    });
    if (input.multiline) control.rows = 3;
    return el('label', {}, input.label, control);
  });

  const run = el('button', { className: 'primary', type: 'button' }, action.label);
  run.addEventListener('click', async () => {
    const input = Object.fromEntries(fields.map((f) => [f.querySelector('[name]').name, f.querySelector('[name]').value]));
    run.disabled = true;
    out.replaceChildren(el('pre', { className: 'result' }, 'Running…'));
    try {
      const { data, text } = await api(`/api/connectors/${connector.id}/actions/${action.id}`, {
        method: 'POST',
        body: { input },
      });
      out.replaceChildren(
        el('pre', { className: 'result' + (text ? ' reply' : '') }, text || JSON.stringify(data, null, 2)),
      );
    } catch (err) {
      out.replaceChildren(el('pre', { className: 'result err' }, err.message));
    } finally {
      run.disabled = false;
    }
  });

  return el('div', { className: 'panel' }, ...fields, el('div', { className: 'row' }, run), out);
}

function card(connector) {
  const active = { current: null };
  const panels = el('div');
  const actions = el(
    'div',
    { className: 'row' },
    connector.actions.map((action) => {
      const btn = el('button', { type: 'button' }, action.label);
      btn.addEventListener('click', () => {
        active.current = active.current === action.id ? null : action.id;
        panels.replaceChildren(...(active.current ? [actionPanel(connector, action)] : []));
      });
      return btn;
    }),
  );

  const toggle = el(
    'button',
    { type: 'button', className: connector.connected ? 'link' : 'primary' },
    connector.connected ? 'Disconnect' : 'Connect',
  );
  toggle.addEventListener('click', () => (connector.connected ? disconnect(connector) : connect(connector)));

  return el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-head' },
      el('h3', {}, connector.label),
      el('span', { className: 'pill' + (connector.connected ? ' ok' : '') }, connector.connected ? 'Connected' : 'Not connected'),
    ),
    el('p', {}, connector.description),
    connector.error ? el('p', { className: 'result err' }, connector.error) : null,
    el('div', { className: 'row' }, toggle),
    connector.connected ? [actions, panels] : null,
  );
}

async function load() {
  try {
    const connectors = await api('/api/connectors');
    const groups = [...new Set(connectors.map((c) => c.group))];
    app.replaceChildren(
      ...groups.flatMap((group) => [
        el('h2', {}, group),
        el('div', { className: 'grid' }, connectors.filter((c) => c.group === group).map(card)),
      ]),
    );
  } catch (err) {
    app.replaceChildren(el('p', { className: 'muted' }, err.message));
  }
}

config = await api('/api/config');
document.getElementById('who').textContent = `End user: ${config.userId}`;
load();
