import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Nango } from '@nangohq/node';
import { byId, connectors, publicView } from './connectors.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT || 3000),
  // Server-to-server Nango API (secret key stays on this server).
  nangoHost: process.env.NANGO_HOST || 'https://api.nango.dev',
  secretKey: process.env.NANGO_SECRET_KEY || '',
  // URLs the *browser* uses to reach Nango's Connect UI and API.
  connectUrl: process.env.NANGO_CONNECT_URL || 'https://connect.nango.dev',
  publicApiUrl: process.env.NANGO_PUBLIC_API_URL || process.env.NANGO_HOST || 'https://api.nango.dev',
  // Demo only: a single hard-coded end user. Replace with your real auth/session user id.
  userId: process.env.DEMO_USER_ID || 'demo-user',
  userEmail: process.env.DEMO_USER_EMAIL || undefined,
};

export function createApp(nango) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(root, 'public')));
  // @nangohq/frontend is plain ESM, so it is served as-is (no bundler).
  app.use('/vendor/nango-frontend', express.static(path.join(root, 'node_modules/@nangohq/frontend/dist')));

  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((err) => {
      const status = err.status || err.response?.status || 500;
      res.status(status).json({
        error: err.response?.data?.error?.message || err.response?.data?.message || err.message,
        details: err.response?.data,
      });
    });

  const getConnector = (req) => {
    const c = byId.get(req.params.id);
    if (!c) throw Object.assign(new Error(`Unknown connector "${req.params.id}"`), { status: 404 });
    return c;
  };

  async function findConnection(connector) {
    const { connections } = await nango.listConnections({
      userId: config.userId,
      integrationId: connector.integrationKey,
    });
    return connections?.find((c) => c.provider_config_key === connector.integrationKey) || null;
  }

  app.get('/api/config', (_req, res) => {
    res.json({ connectUrl: config.connectUrl, apiUrl: config.publicApiUrl, userId: config.userId });
  });

  app.get(
    '/api/connectors',
    wrap(async (_req, res) => {
      const out = await Promise.all(
        connectors.map(async (c) => {
          let connection = null;
          let error;
          try {
            connection = await findConnection(c);
          } catch (e) {
            error = e.response?.data?.error?.message || e.message;
          }
          return {
            ...publicView(c),
            connected: Boolean(connection),
            connectedAt: connection?.created,
            error,
          };
        }),
      );
      res.json(out);
    }),
  );

  // Step 1 of the Nango flow: backend mints a short-lived session token that the
  // browser hands to Connect UI. `allowed_integrations` opens straight to one card.
  app.post(
    '/api/connectors/:id/session',
    wrap(async (req, res) => {
      const c = getConnector(req);
      const { data } = await nango.createConnectSession({
        end_user: { id: config.userId, email: config.userEmail },
        allowed_integrations: [c.integrationKey],
      });
      res.json({ token: data.token, expiresAt: data.expires_at });
    }),
  );

  app.post(
    '/api/connectors/:id/actions/:action',
    wrap(async (req, res) => {
      const c = getConnector(req);
      const action = c.actions.find((a) => a.id === req.params.action);
      if (!action) return res.status(404).json({ error: `Unknown action "${req.params.action}"` });

      const connection = await findConnection(c);
      if (!connection) return res.status(409).json({ error: `${c.label} is not connected yet.` });

      const request = action.build(req.body?.input || {});
      const response = await nango.proxy({
        providerConfigKey: c.integrationKey,
        connectionId: connection.connection_id,
        ...request,
      });
      res.json({ data: response.data, text: action.text?.(response.data) });
    }),
  );

  app.delete(
    '/api/connectors/:id/connection',
    wrap(async (req, res) => {
      const c = getConnector(req);
      const connection = await findConnection(c);
      if (connection) await nango.deleteConnection(c.integrationKey, connection.connection_id);
      res.json({ ok: true });
    }),
  );

  return app;
}

// Only start listening when run directly (tests import createApp).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!config.secretKey) {
    console.error('NANGO_SECRET_KEY is not set. Copy .env.example to .env (or run `npm run demo` for the mock).');
    process.exit(1);
  }
  const nango = new Nango({ host: config.nangoHost, apiKey: config.secretKey });
  createApp(nango).listen(config.port, () => {
    console.log(`Connector hub on http://localhost:${config.port}  (Nango: ${config.nangoHost})`);
  });
}
