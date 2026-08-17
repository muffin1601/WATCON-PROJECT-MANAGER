// The session cookie's name, and nothing else.
//
// Deliberately separate from lib/auth.ts: middleware.ts runs on the Edge
// runtime, where node:crypto is unavailable, so importing lib/auth there would
// pull the whole scrypt/session module into a runtime that cannot load it.
export const SESSION_COOKIE = "watcon_session";
