/**
 * `jsonwebtoken` para el demo en el navegador: tokens JWT firmados con HMAC-SHA256 propio
 * (mismo formato header.payload.firma). Solo se usa cuando la API corre dentro de la página.
 */
import { sha256Bytes } from './crypto';

const enc = new TextEncoder();
const b64url = (s: string | Uint8Array) =>
  btoa(typeof s === 'string' ? unescape(encodeURIComponent(s)) : String.fromCharCode(...s))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

function hmac(key: string, msg: string): string {
  let k = enc.encode(key);
  if (k.length > 64) k = sha256Bytes(k);
  const pad = (x: number) => {
    const out = new Uint8Array(64);
    out.set(k);
    return out.map((b) => b ^ x);
  };
  const m = enc.encode(msg);
  const inner = new Uint8Array(64 + m.length);
  inner.set(pad(0x36));
  inner.set(m, 64);
  const ih = sha256Bytes(inner);
  const outer = new Uint8Array(64 + 32);
  outer.set(pad(0x5c));
  outer.set(ih, 64);
  return b64url(sha256Bytes(outer));
}

function seconds(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v;
  const m = /^(\d+)\s*([smhd])?$/.exec(v);
  if (!m) return undefined;
  return Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] ?? 's'] ?? 1);
}

export function sign(payload: Record<string, unknown>, secret: string, opts: { expiresIn?: string | number; issuer?: string } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = seconds(opts.expiresIn);
  const body = { ...payload, iat, ...(exp ? { exp: iat + exp } : {}), ...(opts.issuer ? { iss: opts.issuer } : {}) };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  return `${data}.${hmac(secret, data)}`;
}

export function verify(token: string, secret: string, opts: { issuer?: string } = {}) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s || hmac(secret, `${h}.${p}`) !== s) throw new Error('invalid signature');
  const body = JSON.parse(fromB64url(p));
  if (body.exp && body.exp * 1000 < Date.now()) throw new Error('jwt expired');
  if (opts.issuer && body.iss !== opts.issuer) throw new Error('jwt issuer invalid');
  return body;
}

export default { sign, verify };
