# expo-ai-starter

An Expo / React Native (TypeScript) starter for a chat app that streams model replies through your own small backend, so no API key ever ships inside the app.

**Status: first working version (0.1).** What exists today: a streaming chat screen, a `useChat` hook, a dependency-free Node proxy that forwards to any OpenAI-compatible endpoint, and a built-in mock mode that streams canned text with no key and no network. The planned voice input, conversation caching, App Store checklist and EAS configuration are **not built yet**. The code is covered by unit tests and bundles for iOS and Android, but **the app has not been run on a simulator or a physical device** — see [What has and has not been verified](#what-has-and-has-not-been-verified).

## Why a proxy

Anything bundled into a mobile app can be extracted from it, including API keys. In this starter the app only knows the URL of your proxy. The proxy holds the key, picks the model, adds the system prompt and enforces limits; the app sends just the conversation and reads back a stream of text.

```
 Expo app  ──POST /api/chat {messages}──▶  proxy (server/)  ──▶  OpenAI-compatible endpoint
           ◀──── text/event-stream ──────                    or  mock mode (canned text)
```

## Quick start

Requires Node.js 22.18 or newer (the proxy is TypeScript that Node runs directly).

```bash
npx create-expo-app my-app --template https://github.com/narayana006/expo-ai-starter
cd my-app
```

Start the proxy. With no configuration it runs in mock mode:

```bash
npm run server
```

```text
Chat proxy listening on http://localhost:8787 (mock mode: canned replies, no model is called)
```

Try it from another terminal:

```bash
curl -N -X POST http://localhost:8787/api/chat \
  -H 'content-type: application/json' \
  -d @examples/chat-request.json
```

```text
data: {"type":"delta","text":"You said: \"How "}

data: {"type":"delta","text":"long does it "}

data: {"type":"delta","text":"take?\". This is "}

data: {"type":"delta","text":"a canned reply "}

...

data: {"type":"delta","text":"it arrives."}

data: {"type":"done"}
```

Then start the app in a second terminal:

```bash
cp .env.example .env    # sets EXPO_PUBLIC_CHAT_API_URL
npm start
```

The proxy URL the app needs depends on where it runs: `http://localhost:8787` for the iOS simulator, `http://10.0.2.2:8787` for the Android emulator, and your computer's LAN address for a physical device.

## Using a real model

Set three variables in the **server's** environment and restart it:

```bash
UPSTREAM_BASE_URL=https://models.example.com/v1 \
UPSTREAM_API_KEY=your-key \
UPSTREAM_MODEL=your-model-name \
npm run server
```

The proxy sends `POST {UPSTREAM_BASE_URL}/chat/completions` with `{"model", "messages", "stream": true}` and a bearer token, and expects the usual OpenAI-compatible stream of `choices[0].delta.content` chunks ending in `data: [DONE]`. Any service that speaks that format should work; none has been tested against yet, only a local fake.

You can also keep the settings in `.env` and run `node --env-file=.env server/index.ts`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Port the proxy listens on. |
| `UPSTREAM_BASE_URL` | empty | Base URL of the model API. Empty means mock mode. |
| `UPSTREAM_API_KEY` | empty | Sent as `Authorization: Bearer ...` to the upstream only. |
| `UPSTREAM_MODEL` | empty | Required when an upstream is set. |
| `SYSTEM_PROMPT` | empty | Prepended on the server; clients cannot send `system` messages. |
| `MOCK` | off | `1` forces mock mode even when an upstream is set. |
| `RATE_LIMIT_PER_MINUTE` | `30` | Requests per client address per minute. `0` disables. |
| `MAX_MESSAGES` | `50` | Longest conversation accepted. |
| `MAX_TOTAL_CHARS` | `32000` | Combined length of all messages. |
| `ALLOWED_ORIGIN` | `*` | `Access-Control-Allow-Origin` header, for browser clients. |
| `MOCK_DELAY_MS` | `40` | Pause between chunks of the canned reply. |

## What is in the box

```
App.tsx                    wires the chat screen to the proxy transport
src/screens/ChatScreen.tsx message list, composer, Send/Stop, error banner, AI notice
src/hooks/useChat.ts       conversation state: send, stream, stop, reset, errors
src/lib/chatClient.ts      reads the proxy's event stream with a streaming fetch
src/lib/transport.ts       the real transport, built on expo/fetch
shared/sse.ts              incremental Server-Sent Events parser (app and server)
shared/chatProtocol.ts     request and stream event types (app and server)
server/                    the proxy: config, mock mode, upstream client, HTTP handler
examples/chat-request.json a request body to try with curl
```

### The protocol

Request: `POST /api/chat` with `{"messages": [{"role": "user" | "assistant", "content": "..."}]}`. The last message must be from the user.

Response: `text/event-stream`. Each event's data is one JSON object: `{"type":"delta","text":"..."}`, then exactly one of `{"type":"done"}` or `{"type":"error","message":"..."}`. Problems detected before streaming starts come back as normal HTTP errors with `{"error": "..."}` (400 invalid body, 413 too large, 429 rate limited, 502 upstream failed). `GET /healthz` returns `{"ok":true,"mode":"mock"}` or `"upstream"`.

### The hook

```tsx
const { messages, status, error, send, stop, reset } = useChat(transport);
```

`status` is `idle`, `streaming` or `error`. `stop()` cancels the request and keeps the text received so far. The transport is a plain function, which is how the tests drive the hook without a network; swap it to talk to a different backend.

## Checks

```bash
npm run typecheck   # tsc for the app and for the server
npm run lint        # eslint with eslint-config-expo
npm test            # jest: SSE parser, chat client, useChat hook, proxy
```

CI runs all three on every push and pull request, then starts the proxy in mock mode and checks that it streams a complete reply.

## What has and has not been verified

Verified:

- 46 unit tests pass: the SSE parser (including events split at every byte offset), the chat client, the `useChat` hook, and the proxy over real local HTTP in mock mode and against a fake upstream.
- `tsc --noEmit` passes for the app and the server; `eslint` is clean; `npx expo-doctor` reports no issues (Expo SDK 58).
- `npx expo export` bundles the app for iOS and Android, so every import resolves under Metro.
- The proxy was run by hand in mock mode and against a local fake of an OpenAI-compatible endpoint, and exercised with `curl`.

Not verified:

- **The app has never been launched on an iOS simulator, an Android emulator, or a physical device.** Layout, keyboard behaviour, scrolling and streaming through `expo/fetch` on a real runtime are untested.
- No real model service has been called.
- No EAS build, store build or store submission has been attempted.
- Web is not set up (`react-native-web` is not installed).

## Features

- [x] Streaming chat UI
- [x] Backend proxy so model keys never ship in the app
- [x] Mock mode for developing without a key
- [ ] Voice input with speech-to-text
- [ ] Local caching of conversations
- [ ] App Store review checklist (privacy manifest, account deletion, AI disclosure)
- [ ] EAS build and submit config

The chat screen shows a one-line notice that replies are AI-generated. That is a starting point, not the planned review checklist.

## Limitations

- The proxy has no user authentication. Anyone who can reach it can use your model quota, limited only by the per-address rate limit, which lives in memory, resets on restart and is not shared between instances. Add real authentication before exposing it to the internet.
- Behind a reverse proxy every client appears to come from one address, so the rate limit applies to all of them together.
- The proxy needs Node.js 22.18+ because it runs TypeScript directly; there is no build step or deployment recipe yet.
- Conversations live in memory and are lost when the app restarts.
- Replies are plain text; Markdown is not rendered.
- Release builds on iOS and Android block plain `http://` URLs by default, so a deployed proxy must be served over `https`.

## Contributing

Issues and pull requests are welcome, especially reports from running the app on real devices. Please run `npm run typecheck`, `npm run lint` and `npm test` before opening a pull request.

Built and maintained by [Narayana Vemburaj](https://github.com/narayana006).

## License

[MIT](LICENSE)
