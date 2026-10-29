// Runs the app against the local mock Nango server: no account or network needed.
//   npm run demo   ->  http://localhost:3000
const mockPort = Number(process.env.MOCK_PORT || 3003);
const mockUrl = `http://localhost:${mockPort}`;

Object.assign(process.env, {
  NANGO_SECRET_KEY: 'mock-secret',
  NANGO_HOST: mockUrl,
  NANGO_CONNECT_URL: `${mockUrl}/connect/`,
  NANGO_PUBLIC_API_URL: mockUrl,
});

const { createMockNango } = await import('../mock/nango-mock.js');
const { createApp, config } = await import('../server/index.js');
const { Nango } = await import('@nangohq/node');

createMockNango().listen(mockPort);
createApp(new Nango({ host: config.nangoHost, apiKey: config.secretKey })).listen(config.port, () =>
  console.log(`Demo (mock Nango on ${mockUrl}) -> http://localhost:${config.port}`),
);
