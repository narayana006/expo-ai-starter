/**
 * Where the app finds the chat proxy.
 *
 * Set EXPO_PUBLIC_CHAT_API_URL in `.env` (see `env.example`). Variables with
 * the EXPO_PUBLIC_ prefix are bundled into the app and visible to anyone who
 * has it, so only the proxy's URL belongs here. The model API key stays on
 * the server.
 */
export const CHAT_API_URL = process.env.EXPO_PUBLIC_CHAT_API_URL ?? 'http://localhost:8787';
