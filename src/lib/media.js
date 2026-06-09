import dns from 'node:dns/promises';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { LINE_API_BASE } from './line-api.js';

export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const MAX_REDIRECTS = 3;

const SAFE_MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TYPE_PREFIX = {
  image: 'image/',
  video: 'video/',
  audio: 'audio/'
};

const EXT_BY_TYPE = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['video/mp4', '.mp4'],
  ['audio/mpeg', '.mp3'],
  ['audio/mp4', '.m4a'],
  ['audio/aac', '.aac'],
  ['application/pdf', '.pdf']
]);

const IPV4_BLOCKED_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

export function isSafeLineMessageId(messageId) {
  return SAFE_MESSAGE_ID_RE.test(String(messageId || ''));
}

function mediaMaxBytes(config = {}) {
  const mb = Number(config.mediaMaxMb || 10);
  return Math.max(1, mb) * 1024 * 1024;
}

function extensionFor(contentType = '', fallback = '.bin') {
  const clean = contentType.split(';')[0].trim().toLowerCase();
  return EXT_BY_TYPE.get(clean) || fallback;
}

function ensureMediaDir(mediaDir) {
  fs.mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
}

async function readResponseBodyLimited(response, maxBytes) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error('inbound media exceeds size limit');
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('inbound media exceeds size limit');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function downloadLineMessageContent({
  messageId,
  channelAccessToken,
  config = {},
  fetchImpl = fetch,
  mediaDir = MEDIA_DIR
} = {}) {
  if (!isSafeLineMessageId(messageId)) throw new Error('invalid LINE message id');
  if (!channelAccessToken) throw new Error('missing LINE channelAccessToken');

  const response = await fetchImpl(`${LINE_API_BASE}/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${channelAccessToken}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`LINE content API HTTP ${response.status}`);

  const maxBytes = mediaMaxBytes(config);
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('inbound media exceeds size limit');

  const buffer = await readResponseBodyLimited(response, maxBytes);
  if (buffer.byteLength === 0) throw new Error('inbound media is empty');

  const contentType = response.headers?.get?.('content-type') || 'application/octet-stream';
  ensureMediaDir(mediaDir);
  const filePath = path.join(mediaDir, `${messageId}${extensionFor(contentType)}`);
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });
  return { filePath, contentType, bytes: buffer.byteLength };
}

function stripIpv6Brackets(hostname) {
  return String(hostname || '').replace(/^\[/, '').replace(/]$/, '');
}

function parseUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('media URL is invalid');
  }
  if (parsed.protocol !== 'https:') throw new Error('media URL must be https');
  if (parsed.username || parsed.password) throw new Error('media URL must not include credentials');
  if (!parsed.hostname) throw new Error('media URL host is required');
  return parsed;
}

function ipv4ToNumber(address) {
  const parts = String(address || '').split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    result = ((result << 8) + value) >>> 0;
  }
  return result;
}

function inIpv4Cidr(addressNumber, rangeAddress, prefixLength) {
  const rangeNumber = ipv4ToNumber(rangeAddress);
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return ((addressNumber & mask) >>> 0) === ((rangeNumber & mask) >>> 0);
}

function parseIpv6Bytes(address) {
  let input = String(address || '').toLowerCase();
  if (input.includes('%')) return null;

  if (input.includes('.')) {
    const lastColon = input.lastIndexOf(':');
    const ipv4 = input.slice(lastColon + 1);
    const ipv4Number = ipv4ToNumber(ipv4);
    if (ipv4Number === null) return null;
    input = `${input.slice(0, lastColon)}:${((ipv4Number >>> 16) & 0xffff).toString(16)}:${(ipv4Number & 0xffff).toString(16)}`;
  }

  const parts = input.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (parts.length === 1 && left.length !== 8) return null;
  if (left.length + right.length > 8) return null;

  const fill = new Array(8 - left.length - right.length).fill('0');
  const groups = [...left, ...fill, ...right];
  if (groups.length !== 8) return null;

  const bytes = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function ipv4MappedFromIpv6(bytes) {
  if (!bytes || bytes.length !== 16) return null;
  for (let idx = 0; idx < 10; idx += 1) {
    if (bytes[idx] !== 0) return null;
  }
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

function isBlockedIpv4(address) {
  const n = ipv4ToNumber(address);
  if (n === null) return true;
  return IPV4_BLOCKED_RANGES.some(([range, prefix]) => inIpv4Cidr(n, range, prefix));
}

function isBlockedIpv6(address) {
  const bytes = parseIpv6Bytes(address);
  if (!bytes) return true;

  const mapped = ipv4MappedFromIpv6(bytes);
  if (mapped) return isBlockedIpv4(mapped);

  const allZero = bytes.every(byte => byte === 0);
  const loopback = bytes.slice(0, 15).every(byte => byte === 0) && bytes[15] === 1;
  if (allZero || loopback) return true;

  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // documentation

  return false;
}

export function isBlockedIp(address) {
  const clean = stripIpv6Brackets(address);
  const family = net.isIP(clean);
  if (family === 4) return isBlockedIpv4(clean);
  if (family === 6) return isBlockedIpv6(clean);
  return true;
}

function addressFamily(address) {
  return net.isIP(stripIpv6Brackets(address));
}

async function resolvePublicAddresses(hostname, lookup = dns.lookup) {
  const cleanHostname = stripIpv6Brackets(hostname);
  const family = addressFamily(cleanHostname);
  if (family) {
    if (isBlockedIp(cleanHostname)) throw new Error('media URL resolves to a private address');
    return [{ address: cleanHostname, family }];
  }

  const records = await lookup(cleanHostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || records.length === 0) throw new Error('media URL DNS lookup failed');

  const valid = records.map(record => ({
    address: stripIpv6Brackets(record.address),
    family: record.family || addressFamily(record.address)
  }));
  for (const record of valid) {
    if (!record.family || isBlockedIp(record.address)) {
      throw new Error('media URL resolves to a private address');
    }
  }
  return valid;
}

function validateContentType(contentType, mediaType) {
  const prefix = TYPE_PREFIX[mediaType];
  if (!prefix) return;
  if (!String(contentType || '').toLowerCase().startsWith(prefix)) {
    throw new Error(`media URL content type must be ${prefix}*`);
  }
}

function requestPathFor(parsed) {
  return `${parsed.pathname || '/'}${parsed.search || ''}`;
}

export function guardedHttpsRequest(parsed, {
  lookup = dns.lookup,
  method = 'HEAD',
  timeoutMs = 15000,
  requestImpl = https.request
} = {}) {
  return new Promise((resolve, reject) => {
    resolvePublicAddresses(parsed.hostname, lookup).then(records => {
      const selected = records[0];
      const hostname = stripIpv6Brackets(parsed.hostname);
      const isIpLiteral = Boolean(addressFamily(hostname));
      const req = requestImpl({
        protocol: 'https:',
        method,
        hostname,
        port: parsed.port || 443,
        path: requestPathFor(parsed),
        servername: isIpLiteral ? undefined : hostname,
        headers: {
          Host: parsed.host,
          'User-Agent': 'zylos-line/0.1'
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, selected.address, selected.family);
        },
        timeout: timeoutMs
      }, response => {
        const remoteAddress = response.socket?.remoteAddress;
        if (!remoteAddress || isBlockedIp(remoteAddress)) {
          response.resume();
          reject(new Error('media URL connected to a private address'));
          return;
        }

        response.resume();
        resolve(response);
      });

      req.on('timeout', () => {
        req.destroy(new Error('media URL request timed out'));
      });
      req.on('error', reject);
      req.end();
    }).catch(reject);
  });
}

export async function validatePublicMediaUrl(rawUrl, {
  mediaType,
  config = {},
  lookup = dns.lookup,
  requestImpl = https.request,
  redirectCount = 0
} = {}) {
  if (redirectCount > MAX_REDIRECTS) throw new Error('media URL redirects too many times');
  const parsed = parseUrl(rawUrl);
  const response = await guardedHttpsRequest(parsed, { lookup, requestImpl });

  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    const location = response.headers?.location;
    if (!location) throw new Error('media URL redirect missing location');
    const nextUrl = new URL(location, parsed.href).href;
    return validatePublicMediaUrl(nextUrl, {
      mediaType,
      config,
      lookup,
      requestImpl,
      redirectCount: redirectCount + 1
    });
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`media URL preflight HTTP ${response.statusCode}`);
  }

  const contentLength = Number(response.headers?.['content-length'] || 0);
  if (contentLength > mediaMaxBytes(config)) throw new Error('media URL exceeds size limit');
  const contentType = response.headers?.['content-type'] || '';
  validateContentType(contentType, mediaType);

  return {
    url: parsed.href,
    contentType,
    contentLength
  };
}
