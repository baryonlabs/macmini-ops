# LLM gateway

`gateway.mjs` is a small OpenAI-compatible endpoint (`/v1/chat/completions`, `/v1/models`) with **ordered fallback** across model backends. Point your apps, and macmini-ops' own LLM diagnosis, at one URL, and keep the routing in one place.

```
app ─▶ gateway (127.0.0.1:8030/v1) ─▶ 1. on-prem GPU (vLLM via SSH tunnel)
                                     ─▶ 2. second GPU box (Ollama)
                                     ─▶ 3. OpenRouter
                                     ─▶ 4. Ollama Cloud
```

## Behaviour

- Routes are tried **in order**. The gateway moves to the next route when:
  - the connection fails
  - no response byte arrives within `firstByteMs`
  - the backend returns 404, 408, 409, 425, 429 or 5xx
  - the backend returns any other 4xx, without marking it unhealthy
- **Cooldown**: a failed backend is skipped for `cooldownSec`, then tried again. Requests don't wait for a dead backend each time. A provider can set its own `cooldownSec`, for example a shared GPU that is often busy for hours.
- **Streaming** passes through unbuffered. Fallback is only possible before the first byte reaches the client.
- Every response has `x-gateway-backend` and `x-gateway-model` headers. `GET /health` shows each provider's up/down state, counters and last error, plus the route order per model.
- **API keys** come from environment variables named by `apiKeyEnv`. A provider whose key is missing is skipped. Keep keys in an env file (mode 600) and start the gateway with `node --env-file=<file> gateway.mjs`.

## Config (`gateway` block in config.json)

```json
"gateway": {
  "host": "127.0.0.1",
  "port": 8030,
  "cooldownSec": 60,
  "firstByteMs": 30000,
  "providers": {
    "gpu-a":      { "baseUrl": "http://127.0.0.1:8020/v1" },
    "gpu-b":      { "baseUrl": "http://gpu-b.local:11434/v1", "firstByteMs": 20000 },
    "openrouter": { "baseUrl": "https://openrouter.ai/api/v1", "apiKeyEnv": "OPENROUTER_API_KEY",
                    "dropFields": ["chat_template_kwargs"], "extraBody": { "reasoning": { "enabled": false } } },
    "ollama-cloud": { "baseUrl": "https://ollama.com/v1", "apiKeyEnv": "OLLAMA_API_KEY", "dropFields": ["chat_template_kwargs"] }
  },
  "models": {
    "my-chat": [
      { "provider": "gpu-a", "model": "my-chat" },
      { "provider": "gpu-b", "model": "qwen3.5-27b-local" },
      { "provider": "openrouter", "model": "qwen/qwen3.5-27b" },
      { "provider": "ollama-cloud", "model": "qwen3.5" }
    ]
  }
}
```

- `dropFields` removes request fields a provider doesn't understand. `extraBody` adds provider-specific ones, such as disabling reasoning on OpenRouter.
- Per-route `extraBody` and `firstByteMs` override the provider defaults.
- Keep fallback models in the same family where possible, so answers stay consistent when the gateway falls back.

## Watching it

Give an `llm-app` agent `"model": { "gatewayHealthUrl": "http://127.0.0.1:8030/health", "name": "my-chat", ... }`.

- While a fallback is serving, the agent shows a **warning** naming the active backend.
- When every route is down, it raises a **critical** alert.
- If `tunnelLabel` is set, it also restarts the SSH tunnel to the primary, if that tunnel is on the allow-list.

## Running

```bash
printf 'OPENROUTER_API_KEY=...\nOLLAMA_API_KEY=...\n' > ~/.macmini-ops/gateway.env && chmod 600 ~/.macmini-ops/gateway.env
./deploy/install-gateway-macos.sh ~/.macmini-ops/config.json ~/.macmini-ops/gateway.env
curl -s http://127.0.0.1:8030/health
```
