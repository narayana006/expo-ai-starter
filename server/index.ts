/** Starts the proxy: `node server/index.ts` (Node.js 22.18 or newer). */

import { createServer } from 'node:http';

import { createHandler } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig(process.env);
const handler = createHandler(config);
const server = createServer((req, res) => void handler(req, res));

server.listen(config.port, () => {
  const mode = config.mock
    ? 'mock mode: canned replies, no model is called'
    : `forwarding to ${config.upstreamBaseUrl} with model ${config.model}`;
  console.log(`Chat proxy listening on http://localhost:${config.port} (${mode})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
