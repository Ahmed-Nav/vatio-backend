import { CookieSerializeOptions } from '@fastify/cookie';

export const SESSION_IDLE_TTL_SECONDS = Number(
  process.env.SESSION_IDLE_TTL_SECONDS || 12 * 60 * 60,
);
export const SESSION_ABSOLUTE_TTL_SECONDS = Number(
  process.env.SESSION_ABSOLUTE_TTL_SECONDS || 7 * 24 * 60 * 60,
);
export const SESSION_TOUCH_INTERVAL_SECONDS = 5 * 60;

export function getSessionCookieName() {
  return process.env.NODE_ENV === 'production'
    ? '__Host-vatio_session'
    : 'vatio_session';
}

export function getSessionCookieOptions(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_ABSOLUTE_TTL_SECONDS,
  };
}

export function getSessionCookieClearOptions(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  };
}
