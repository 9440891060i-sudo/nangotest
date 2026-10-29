# Connector Hub

A small web UI that connects **Google Calendar, Google Meet, Google Analytics, Claude (Anthropic API)
and ChatGPT (OpenAI API)** through [Nango](https://github.com/NangoHQ/nango), and lets you try a
couple of live API calls per connector. Background and findings: [docs/NANGO_RESEARCH.md](docs/NANGO_RESEARCH.md).

```
public/     vanilla JS UI (opens Nango Connect UI in an iframe)
server/     Express backend: mints Connect sessions, calls APIs via Nango's proxy
mock/       local fake Nango (for demo + tests)
```

Your server never sees Google tokens or AI API keys: Nango stores them and injects them on proxy calls.

## Try it now (no accounts)

```bash
npm install
npm run demo        # http://localhost:3000 against the built-in mock Nango
npm test
```

The mock returns canned data; it proves the app flow, not the real providers.

## Use real Nango

1. Get Nango: [Nango Cloud](https://app.nango.dev) or self-host with `docker compose up -d` (see `docker-compose.yml`).
2. In the Nango dashboard create five integrations with these **unique keys** and, for Google ones,
   your Google OAuth client + scopes (see research doc, section 4):
   `google-calendar`, `google-meet`, `google-analytics`, `anthropic`, `openai`.
3. Configure and run:

```bash
cp .env.example .env     # set NANGO_SECRET_KEY (and the self-host URLs if applicable)
npm start                # http://localhost:3000
```

## Notes

- ChatGPT has no consumer API; the "ChatGPT" card uses the OpenAI API.
- Everyone shares one hard-coded end user (`DEMO_USER_ID`). Wire in your real auth before deploying.
- Not yet verified against a live Nango account (the authoring sandbox could not reach one).
