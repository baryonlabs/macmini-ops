#!/usr/bin/env node
// LLM gateway: an OpenAI-compatible endpoint with ordered fallback across model backends.
//
//   node --env-file=~/.macmini-ops/gateway.env gateway.mjs      # uses the "gateway" block of the config
//
// Config: OPS_CONFIG or ./config.json, key "gateway" (see docs/llm-gateway.md).
// API keys come from environment variables named in each provider's "apiKeyEnv".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './lib/gateway.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.OPS_CONFIG || path.join(HERE, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const g = config.gateway;
if (!g) {
  console.error(`no "gateway" block in ${configPath} (see docs/llm-gateway.md)`);
  process.exit(1);
}
for (const [name, p] of Object.entries(g.providers)) {
  if (p.apiKeyEnv && !process.env[p.apiKeyEnv]) console.warn(`[gateway] provider ${name}: API key not set (see apiKeyEnv in config); it will be skipped`);
}
const { server } = createGateway(g);
const host = g.host || '127.0.0.1';
const port = g.port || 8030;
server.listen(port, host, () => {
  console.log(`[gateway] http://${host}:${port}/v1  models=${Object.keys(g.models).join(',')}`);
  for (const [m, routes] of Object.entries(g.models)) console.log(`[gateway]   ${m}: ${routes.map(r => `${r.provider}/${r.model}`).join(' -> ')}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
