// Registry of the connectors shown in the UI.
//
// `integrationKey` is the "Unique Key" of the integration you create in the Nango
// dashboard (Integrations -> Set up new integration). It defaults to the Nango
// provider name and can be overridden with INTEGRATION_<ID> env vars.
//
// Every action is executed through Nango's proxy, so this server never sees the
// Google access tokens or the OpenAI/Anthropic API keys: Nango injects them.

const env = (name, fallback) => process.env[name] || fallback;

const GOOGLE_SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  meetRead: 'https://www.googleapis.com/auth/meetings.space.readonly',
  meetCreate: 'https://www.googleapis.com/auth/meetings.space.created',
  analytics: 'https://www.googleapis.com/auth/analytics.readonly',
};

export const connectors = [
  {
    id: 'google-calendar',
    label: 'Google Calendar',
    group: 'Google Workspace',
    provider: 'google-calendar',
    authMode: 'OAUTH2',
    description: 'Read calendars and upcoming events.',
    scopes: [GOOGLE_SCOPES.calendar],
    actions: [
      {
        id: 'upcoming-events',
        label: 'Upcoming events',
        build: () => ({
          method: 'GET',
          endpoint: '/calendar/v3/calendars/primary/events',
          params: {
            timeMin: new Date().toISOString(),
            maxResults: '10',
            singleEvents: 'true',
            orderBy: 'startTime',
          },
        }),
      },
      {
        id: 'calendars',
        label: 'My calendars',
        build: () => ({ method: 'GET', endpoint: '/calendar/v3/users/me/calendarList' }),
      },
    ],
  },
  {
    id: 'google-meet',
    label: 'Google Meet',
    group: 'Google Workspace',
    provider: 'google-meet',
    authMode: 'OAUTH2',
    description: 'Create meeting links and list past conferences.',
    scopes: [GOOGLE_SCOPES.meetCreate, GOOGLE_SCOPES.meetRead],
    actions: [
      {
        id: 'create-space',
        label: 'Create meeting link',
        build: () => ({ method: 'POST', endpoint: '/v2/spaces', data: {} }),
      },
      {
        id: 'conference-records',
        label: 'Recent conferences',
        build: () => ({ method: 'GET', endpoint: '/v2/conferenceRecords', params: { pageSize: '10' } }),
      },
    ],
  },
  {
    id: 'google-analytics',
    label: 'Google Analytics',
    group: 'Google Workspace',
    provider: 'google-analytics',
    authMode: 'OAUTH2',
    description: 'List GA4 properties and run simple reports.',
    scopes: [GOOGLE_SCOPES.analytics],
    actions: [
      {
        id: 'account-summaries',
        label: 'List properties',
        // google-analytics aliases the generic `google` provider (base URL
        // www.googleapis.com), but GA4 lives on its own hosts, so we override.
        build: () => ({
          method: 'GET',
          endpoint: '/v1beta/accountSummaries',
          baseUrlOverride: 'https://analyticsadmin.googleapis.com',
        }),
      },
      {
        id: 'run-report',
        label: 'Last 7 days report',
        inputs: [{ name: 'propertyId', label: 'GA4 property ID', placeholder: '123456789', required: true }],
        build: ({ propertyId }) => {
          if (!/^\d+$/.test(propertyId || '')) {
            throw Object.assign(new Error('propertyId must be the numeric GA4 property ID'), { status: 400 });
          }
          return {
            method: 'POST',
            endpoint: `/v1beta/properties/${propertyId}:runReport`,
            baseUrlOverride: 'https://analyticsdata.googleapis.com',
            data: {
              dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
              dimensions: [{ name: 'date' }],
              metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
              orderBys: [{ dimension: { dimensionName: 'date' } }],
            },
          };
        },
      },
    ],
  },
  {
    id: 'anthropic',
    label: 'Claude (Anthropic API)',
    group: 'AI',
    provider: 'anthropic',
    authMode: 'API_KEY',
    description: 'Bring your own Anthropic API key. Nango stores it; you call Claude through the proxy.',
    actions: [
      {
        id: 'models',
        label: 'List models',
        build: () => ({ method: 'GET', endpoint: '/v1/models' }),
      },
      {
        id: 'message',
        label: 'Ask Claude',
        inputs: [
          { name: 'model', label: 'Model', default: env('ANTHROPIC_MODEL', 'claude-haiku-5-5'), required: true },
          { name: 'prompt', label: 'Prompt', default: 'Say hello in five words.', required: true, multiline: true },
        ],
        build: ({ model, prompt }) => ({
          method: 'POST',
          endpoint: '/v1/messages',
          data: { model, max_tokens: 256, messages: [{ role: 'user', content: prompt }] },
        }),
        // Pull the plain text out of the response for display.
        text: (res) => (res?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
      },
    ],
  },
  {
    id: 'openai',
    label: 'ChatGPT (OpenAI API)',
    group: 'AI',
    provider: 'openai',
    authMode: 'API_KEY',
    description:
      'ChatGPT itself has no public API; this connects the OpenAI API (the same models) with your API key.',
    actions: [
      {
        id: 'models',
        label: 'List models',
        build: () => ({ method: 'GET', endpoint: '/v1/models' }),
      },
      {
        id: 'chat',
        label: 'Ask ChatGPT',
        inputs: [
          { name: 'model', label: 'Model', default: env('OPENAI_MODEL', 'gpt-4o-mini'), required: true },
          { name: 'prompt', label: 'Prompt', default: 'Say hello in five words.', required: true, multiline: true },
        ],
        build: ({ model, prompt }) => ({
          method: 'POST',
          endpoint: '/v1/chat/completions',
          data: { model, messages: [{ role: 'user', content: prompt }] },
        }),
        text: (res) => res?.choices?.[0]?.message?.content ?? '',
      },
    ],
  },
].map((c) => ({
  ...c,
  integrationKey: env(`INTEGRATION_${c.id.toUpperCase().replace(/-/g, '_')}`, c.provider),
}));

export const byId = new Map(connectors.map((c) => [c.id, c]));

// What the browser needs to render a card (no functions, no secrets).
export function publicView(c) {
  return {
    id: c.id,
    label: c.label,
    group: c.group,
    authMode: c.authMode,
    description: c.description,
    integrationKey: c.integrationKey,
    scopes: c.scopes || [],
    actions: c.actions.map((a) => ({ id: a.id, label: a.label, inputs: a.inputs || [] })),
  };
}
