# Nango: research notes

Researched 2026-10-29 from the Nango GitHub repo (README, `LICENSE`, `docker-compose.yaml`,
`packages/providers/providers.yaml`) and the published `@nangohq/node` / `@nangohq/frontend`
0.71.14 packages. **Not verified:** nango.dev and docs.nango.dev were unreachable from the
authoring sandbox, and no live Nango instance was available, so nothing here was run against a
real Nango server. Items marked *(unverified)* come from secondary sources.

## 1. What Nango is

An open-source (source-available, see License) platform that sits between your product and
third-party APIs. It grew out of Pizzly, an OAuth handler for ~40 APIs, and now describes itself
as supporting 1,000+ APIs (the catalog file has ~1,080 top-level entries). Three primitives:

| Primitive | What it does |
|-----------|--------------|
| **Auth** | OAuth 1/2, API keys, basic, JWT, etc. Stores credentials encrypted, refreshes tokens, white-label embeddable **Connect UI**, per-end-user connections. |
| **Proxy** | `ALL /proxy/*`: you call the upstream API *through Nango*; it injects the user's credentials/headers, retries and respects rate limits. |
| **Functions** | TypeScript functions deployed to Nango's runtime for syncs, actions, webhooks (data sync, tool calls, MCP). Not used in this project. |

Philosophy: unlike unified-API vendors (Merge etc.) with a fixed normalized schema, Nango gives
you the auth + plumbing and you define the data model.

## 2. Architecture

- **nango-server** (image `nangohq/nango-server:hosted`): REST API (port 3003) and Connect UI (3009).
- **Postgres 16**: connections, integrations, encrypted credentials (`NANGO_ENCRYPTION_KEY`).
- **Redis 7**: queues/cache.
- **Elasticsearch** (optional, commented out upstream): operation logs.
- **`providers.yaml`**: the declarative catalog. Each provider declares `auth_mode`, authorization
  and token URLs, proxy `base_url`, headers, retry/pagination rules, credential fields.
  Mounted into the server container, so you can add custom providers.
- Cloud-only / paid features per README: managed runtime for Functions, BYOC. Self-hosting is
  free with a *limited feature set*.

### License (important)
Elastic License 2.0. You may use it, self-host it and embed it in **your own product**. You may
**not** offer it to third parties as a hosted/managed service, nor tamper with license-key
functionality. Fine for this project; matters if you ever want to resell "Nango as a service".

## 3. The integration flow (verified from SDK source)

```
Browser                    Your backend                      Nango
  | click "Connect"            |                               |
  |--------------------------->| POST /connect/sessions        |
  |                            |  {end_user, allowed_integrations}  (Bearer secret key)
  |                            |<------------------------------| {data:{token, expires_at}}
  |<---- token ----------------|                               |
  | ConnectUI iframe (baseURL) -- postMessage ready/session_token/connect/close
  | user authorizes at Google / pastes API key                 |
  |                            | GET /connections?endUserId=&integrationId=
  |                            | ALL /proxy/<upstream path>    |
  |                            |   Connection-Id, Provider-Config-Key headers
```

- Secret key never reaches the browser; the browser only holds a short-lived session token.
- Connections are keyed by `(integration unique key, connection_id)`; the end user is attached via
  the session's `end_user`, and can be looked up with `listConnections({ userId })`.
- Custom headers are forwarded as `Nango-Proxy-<Header>`; `baseUrlOverride` swaps the upstream host.
- Webhooks (auth/sync events) are available but this project polls `listConnections` instead.
- Note a path quirk found while testing: the SDK lists via `GET /connections` and deletes via
  `DELETE /connections/:id?provider_config_key=` (the `/connection` path in the types package is for a different call).

## 4. The five connectors requested

Catalog entries (from `providers.yaml`):

| Connector | Nango provider key | Auth | Upstream base URL |
|-----------|--------------------|------|-------------------|
| Google Calendar | `google-calendar` (alias of `google`) | OAUTH2 | `www.googleapis.com` |
| Google Meet | `google-meet` (alias of `google`) | OAUTH2 | `meet.googleapis.com` |
| Google Analytics | `google-analytics` (alias of `google`) | OAUTH2 | inherited `www.googleapis.com`, so **GA4 hosts need `baseUrlOverride`** |
| Claude | `anthropic` (+ `anthropic-admin`) | API_KEY | `api.anthropic.com`; Nango sets `x-api-key` and `anthropic-version` (connection field, e.g. `2023-06-01`) |
| ChatGPT | `openai` (+ `openai-admin`) | API_KEY | `api.openai.com`; Nango sets `Authorization: Bearer` |

Also exist: `google-calendar-mcp`, `chatgpt-enterprise` (SCIM user-management only).

### ChatGPT caveat
There is no public API for the ChatGPT consumer product. The only ChatGPT-named provider,
`chatgpt-enterprise`, is the SCIM API for managing enterprise users. For "talk to ChatGPT models"
the right connector is **`openai`** with an OpenAI API key, which is what this project uses.

### Google setup (one-time, per integration)
Nango's Google providers use *your own* Google OAuth app (Nango also offers a shared dev app
for testing *(unverified)*). In Google Cloud Console:

1. Create a project; enable **Google Calendar API**, **Google Meet REST API**, **Google Analytics
   Admin API** and **Google Analytics Data API**.
2. OAuth consent screen + an OAuth client (Web). Authorized redirect URI = the callback URL
   shown in the Nango integration page (Cloud: `https://api.nango.dev/oauth/callback`).
3. In Nango: Integrations -> new integration for each provider, paste client id/secret and set scopes:

| Integration | Scopes |
|-------------|--------|
| `google-calendar` | `https://www.googleapis.com/auth/calendar.readonly` |
| `google-meet` | `https://www.googleapis.com/auth/meetings.space.created`, `https://www.googleapis.com/auth/meetings.space.readonly` |
| `google-analytics` | `https://www.googleapis.com/auth/analytics.readonly` |

4. Unverified Google OAuth apps stay in "testing" mode (limited to listed test users); sensitive
   scopes need Google app verification before public launch.
5. The shared `google` provider requests `access_type=offline&prompt=consent` so a refresh token is
   issued, and Nango refreshes access tokens for you.

For Anthropic / OpenAI no app registration is needed: create an integration (no credentials),
and each end user pastes their own API key in Connect UI.

## 5. Gotchas / open questions

- **Token portability** *(unverified, from a competitor's blog)*: if you later leave Nango, refresh
  tokens only keep working if issued by *your own* OAuth app, another reason to register your own.
- **Self-host limits**: free self-hosting has a restricted feature set vs Cloud; check the pricing
  page before committing to a function-heavy design.
- **Rate limits & retries** are defined per provider in `providers.yaml` (e.g. Calendar retries on
  401/403/429/5xx).
- **Meet API access**: reading conference records requires the user to be an organizer/participant,
  and Google Workspace admins may restrict API access.
- **Model names** in the demo forms are editable defaults and may be stale; use "List models".

## 6. Sources

- https://github.com/NangoHQ/nango (README, LICENSE, `docker-compose.yaml`, `packages/providers/providers.yaml`)
- https://www.npmjs.com/package/@nangohq/node and `@nangohq/frontend` / `@nangohq/types` 0.71.14 (type definitions and source read directly)
- https://nango.dev/blog/what-is-a-unified-api/ , Launch HN (YC W23) and the Unified.to comparison post (secondary; license/portability claims treated as unverified)
