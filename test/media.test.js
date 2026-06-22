import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createPinnedLookup,
  downloadLineMessageContent,
  isBlockedIp,
  isSafeLineMessageId,
  validatePublicMediaUrl
} from '../src/lib/media.js';

const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC/1n5HMth4b5B9
nsKClcckmuJRnLHmddNRjsyy8/vax1KVLD5hEU3OQgJV5U4SvsOPecR4F+hGwhbu
mMfIxaIUx3qimSMXrNnidJLFIGH3e+TjkuZgvpgdlkdregUGgPSNhLVYhWy3oalV
ywEdumXDR3EDicUC4hYqMmJqVEGB/EdOfsGZl6c34QZ71iwcl6u85yzfRXzz33q1
IknivQXxd2imU75Z5bxpZHJWLYNBceCKKeEB77GCZjxdG/J41jGr3R+PetKGu1VY
z5eCpexj1Yq+G0S4qVpV/nZEOrEFl+buMgym70FVQ/1Dx9mlhR195cGL99x1Gx8O
Vs4DRjKpAgMBAAECggEAFJ31aFV7P5ujMxJS4+c7myAs3onb8gwLr/eMNwH9uUo0
ApAvYWM+B21qBC08B3ZfshXAxbSxY+62uYx15t/xRrvBiaQHn3hrhOjztSKBJNs4
gt9mHv5HfuEzFRvsr6xARs1SaAxpiLq5EN1bu1mDAkpf8k9mJaSCrqTyQBcvYHa6
1WQ7dMnHmyDQxWDUnL5ECM89PQYhPGqGGZpoE62XFYAfqBYXs7cOTijXsqPzkXq/
EeV7qbLO2a3s7ethgcdmBYPhJVVEggaL2gkmZ7BLNCSbyfVi6cyxTkdVmgsTIV/i
7zCM/scXli0W07tG5gzmh6Khqdv/RdSqSTWXIr+FGQKBgQDi94bw2+1w2OVONwI2
L5cnrhC8RaHDjlIqs+2509xMiDyWtYI3VIO5dKy8Ua57ez8Fw/a7VN55GSyi0Va/
M0jmLNM/i/VrvjFloKvnEOHW17TtSZQd56UKuaqSVtp2z8FfkTcUEyZtPNsEG5gQ
EFKkvzWAA2MJmgYeTVNDvY601wKBgQDYYJjx09b6E14Ne2kaPT9LUYX9yMqtmcET
Rv8MVektadcRUjxq9/Sh3eYYH4z61NKdDxD/X1dr9O/LXtW475iYAjRNvGNjE9Wj
a0p3iztEnLuAdFDLTTDIdqx7qOxP9A/+TE3PVh0Q90MD7ySqsEU6xFD7LFiwk0OF
qlBdKo3kfwKBgHEqpFDSB7j9nI/8I5Eq934kb1nAimC8RMHgBwdh2HUcdMFcbTnz
XN6Ki1o2i/4rvIe+ZvaO4YKWB8iDAnLBOnbyIL6NpWf8ZBrdGvlSVJjP4vlxd3XV
u1f2rVLcFX+qJSvmdwT+a2mKL1YEADT6PorAgAd9KNNvxd80BPFAwbfvAoGAKT5g
aNgERi6i4tb/Na0u/2BOtg0r9OM11kLWIrfNdoaSJA8UzR7uVlxBm5+H89fVPXK9
vq+hrkZF3vH4swOYhoEFDzw1hZEmS7wLubWkWnO1mcqSC+5uugdE4V1VjffrhIFu
43J6n91BvOI8jvyCda0t8nKFhULMwBGyt8+AtGkCgYBENrNwE1F0QqvJJ+5N6Gl0
Q1JjPglIrjk/Pc/XsMUuxnN5vN45vfQjmGyAHy3mZEMwrlK6RFv9X1qVKXh/vbY6
nw3JbmFG7Joj9KZNvyrHSgCKEau3Fr3fB6eMqhLkxTOJJ3d5N6BUPpNeot9ozWbp
KlWUusv+YsmQ9roCKBaQ8g==
-----END PRIVATE KEY-----`;

const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDNDCCAhygAwIBAgIUeVM8tB/NWestCGhEYu6lLTmZzYQwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQY2RuLmV4YW1wbGUudGVzdDAeFw0yNjA2MDkxNjE4MDFa
Fw0zNjA2MDYxNjE4MDFaMBsxGTAXBgNVBAMMEGNkbi5leGFtcGxlLnRlc3QwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC/1n5HMth4b5B9nsKClcckmuJR
nLHmddNRjsyy8/vax1KVLD5hEU3OQgJV5U4SvsOPecR4F+hGwhbumMfIxaIUx3qi
mSMXrNnidJLFIGH3e+TjkuZgvpgdlkdregUGgPSNhLVYhWy3oalVywEdumXDR3ED
icUC4hYqMmJqVEGB/EdOfsGZl6c34QZ71iwcl6u85yzfRXzz33q1IknivQXxd2im
U75Z5bxpZHJWLYNBceCKKeEB77GCZjxdG/J41jGr3R+PetKGu1VYz5eCpexj1Yq+
G0S4qVpV/nZEOrEFl+buMgym70FVQ/1Dx9mlhR195cGL99x1Gx8OVs4DRjKpAgMB
AAGjcDBuMB0GA1UdDgQWBBQSGRESd6mhPqAQnT8MhqeOES9uizAfBgNVHSMEGDAW
gBQSGRESd6mhPqAQnT8MhqeOES9uizAPBgNVHRMBAf8EBTADAQH/MBsGA1UdEQQU
MBKCEGNkbi5leGFtcGxlLnRlc3QwDQYJKoZIhvcNAQELBQADggEBACIsfCXEmwsB
ejbn65s3sJ6qTDxSr4698wf3bsN60Ca/HewaXosqn5WJMo+XcdC+w/7IoHAdm3c9
1809PaLGlDklkoupYKUM2Dx4HUCyJSQ8gL8TBG1NkoS8LO6PXXHWDds1s0TXXMdo
+VbtMwlGAtfkvaybMoYTmyl8NQMudB1vnj7hzGA0dGtAmAm7qyntb3uPKqzZH1+U
1ePCVZ9Jlijta6VB15lrYEnNSxh3F7kL9E40X1P6o/OE/GaxA+sDS00qYkoXBwAi
pXTpPLkNF5ZwqJbknkdCax2K+QkqtG0YgMPc9E3S044o2A4q/c6UDql14omaJYd7
GXVQYeJ4tI4=
-----END CERTIFICATE-----`;

function responseHeaders(headers = {}) {
  return {
    get(name) {
      return headers[name.toLowerCase()] || '';
    }
  };
}

function fakeHttpsRequest(responses, calls = []) {
  return (options, callback) => {
    const req = new EventEmitter();
    req.end = () => {
      options.lookup(options.hostname, {}, (lookupErr, address, family) => {
        if (lookupErr) {
          req.emit('error', lookupErr);
          return;
        }
        calls.push({ options, address, family });
        const item = responses.shift();
        if (item?.error) {
          req.emit('error', item.error);
          return;
        }
        const response = new EventEmitter();
        response.statusCode = item.statusCode ?? 200;
        response.headers = item.headers || { 'content-type': 'image/png', 'content-length': '10' };
        response.socket = { remoteAddress: item.remoteAddress || address };
        response.resume = vi.fn();
        item.respond?.(response);
        callback(response);
      });
    };
    req.destroy = err => req.emit('error', err);
    return req;
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe('LINE media helpers', () => {
  it('validates LINE message ids before content fetch', () => {
    expect(isSafeLineMessageId('abc_123-XYZ')).toBe(true);
    expect(isSafeLineMessageId('../secret')).toBe(false);
    expect(isSafeLineMessageId('abc/123')).toBe(false);
    expect(isSafeLineMessageId('a'.repeat(129))).toBe(false);
  });

  it('downloads inbound LINE media only from the fixed LINE content host with a size cap', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-media-'));
    const fetchImpl = vi.fn(async (url, options) => ({
      ok: true,
      status: 200,
      headers: responseHeaders({
        'content-type': 'image/png',
        'content-length': '4'
      }),
      async arrayBuffer() {
        return Buffer.from('data');
      }
    }));

    const result = await downloadLineMessageContent({
      messageId: 'msg_123',
      channelAccessToken: 'token',
      config: { mediaMaxMb: 1 },
      fetchImpl,
      mediaDir: dir
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://api-data.line.me/v2/bot/message/msg_123/content', expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer token' }
    }));
    expect(result.filePath).toBe(path.join(dir, 'msg_123.png'));
    expect(fs.readFileSync(result.filePath, 'utf8')).toBe('data');
  });

  it('maps LINE voice content-type audio/x-m4a to a .m4a extension, not .bin (F2)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-media-'));
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: responseHeaders({ 'content-type': 'audio/x-m4a', 'content-length': '4' }),
      async arrayBuffer() {
        return Buffer.from('aud!');
      }
    }));

    const result = await downloadLineMessageContent({
      messageId: 'voice_1',
      channelAccessToken: 'token',
      config: { mediaMaxMb: 1 },
      fetchImpl,
      mediaDir: dir
    });

    expect(result.filePath).toBe(path.join(dir, 'voice_1.m4a'));
  });

  it('maps additional LINE audio content-types to proper extensions (F2)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-media-'));
    for (const [contentType, ext] of [['audio/m4a', '.m4a'], ['audio/x-aac', '.aac']]) {
      const id = `aud_${ext.slice(1)}`;
      const result = await downloadLineMessageContent({
        messageId: id,
        channelAccessToken: 'token',
        config: { mediaMaxMb: 1 },
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: responseHeaders({ 'content-type': contentType, 'content-length': '3' }),
          async arrayBuffer() { return Buffer.from('aud'); }
        }),
        mediaDir: dir
      });
      expect(result.filePath).toBe(path.join(dir, `${id}${ext}`));
    }
  });

  it('rejects inbound LINE media that exceeds the configured size cap', async () => {
    await expect(downloadLineMessageContent({
      messageId: 'msg_123',
      channelAccessToken: 'token',
      config: { mediaMaxMb: 1 },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: responseHeaders({ 'content-length': String(2 * 1024 * 1024) }),
        async arrayBuffer() {
          return Buffer.from('x');
        }
      })
    })).rejects.toThrow(/size limit/);
  });

  it('rejects inbound LINE media while streaming when content-length is absent', async () => {
    await expect(downloadLineMessageContent({
      messageId: 'msg_123',
      channelAccessToken: 'token',
      config: { mediaMaxMb: 1 },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: responseHeaders({ 'content-type': 'image/png' }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.alloc(1024 * 1024));
            controller.enqueue(Buffer.alloc(1));
            controller.close();
          }
        })
      })
    })).rejects.toThrow(/size limit/);
  });

  it('canonicalizes and rejects private, link-local, encoded, and IPv4-mapped addresses', async () => {
    expect(isBlockedIp('10.1.2.3')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('::ffff:10.1.2.3')).toBe(true);

    const requestImpl = fakeHttpsRequest([]);
    await expect(validatePublicMediaUrl('https://2130706433/image.png', { mediaType: 'image', requestImpl })).rejects.toThrow(/private address/);
    await expect(validatePublicMediaUrl('https://0x7f.1/image.png', { mediaType: 'image', requestImpl })).rejects.toThrow(/private address/);
    await expect(validatePublicMediaUrl('https://017700000001/image.png', { mediaType: 'image', requestImpl })).rejects.toThrow(/private address/);
    await expect(validatePublicMediaUrl('https://[::ffff:10.0.0.1]/image.png', { mediaType: 'image', requestImpl })).rejects.toThrow(/private address/);
  });

  it('pins a validated DNS result into the HTTPS connection and validates the actual peer', async () => {
    const calls = [];
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);

    await validatePublicMediaUrl('https://cdn.example.test/image.png', {
      mediaType: 'image',
      lookup,
      requestImpl: fakeHttpsRequest([{ remoteAddress: '93.184.216.34' }], calls)
    });

    expect(lookup).toHaveBeenCalledWith('cdn.example.test', { all: true, verbatim: true });
    expect(calls[0].address).toBe('93.184.216.34');
    expect(calls[0].options.lookup).toEqual(expect.any(Function));
    expect(calls[0].options.headers.Host).toBe('cdn.example.test');
    expect(calls[0].options.servername).toBe('cdn.example.test');

    await expect(validatePublicMediaUrl('https://cdn.example.test/image.png', {
      mediaType: 'image',
      lookup,
      requestImpl: fakeHttpsRequest([{ remoteAddress: '127.0.0.1' }])
    })).rejects.toThrow(/connected to a private address/);
  });

  it('uses a Node-compatible pinned lookup callback with real https.request', async () => {
    const seen = [];
    const server = https.createServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT }, (req, res) => {
      seen.push({
        url: req.url,
        host: req.headers.host
      });
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': '10'
      });
      res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    try {
      const port = server.address().port;
      const response = await new Promise((resolve, reject) => {
        const req = https.request({
          protocol: 'https:',
          method: 'HEAD',
          hostname: 'cdn.example.test',
          port,
          path: '/image.png',
          servername: 'cdn.example.test',
          ca: TEST_TLS_CERT,
          headers: { Host: `cdn.example.test:${port}` },
          lookup: createPinnedLookup({ address: '127.0.0.1', family: 4 })
        }, res => {
          res.resume();
          resolve(res);
        });
        req.on('error', reject);
        req.end();
      });

      expect(response.statusCode).toBe(200);
      expect(seen).toEqual([{
        url: '/image.png',
        host: `cdn.example.test:${port}`
      }]);
    } finally {
      await closeServer(server);
    }
  });

  it('re-runs the full guard on redirect targets', async () => {
    const calls = [];
    const lookup = vi.fn(async hostname => {
      if (hostname === 'cdn.example.test') return [{ address: '93.184.216.34', family: 4 }];
      throw new Error(`unexpected lookup for ${hostname}`);
    });

    await expect(validatePublicMediaUrl('https://cdn.example.test/image.png', {
      mediaType: 'image',
      lookup,
      requestImpl: fakeHttpsRequest([{
        statusCode: 302,
        remoteAddress: '93.184.216.34',
        headers: { location: 'https://169.254.169.254/latest/meta-data' }
      }], calls)
    })).rejects.toThrow(/private address/);

    expect(calls).toHaveLength(1);
  });

  it('enforces content type and configured size caps on outbound media preflight', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);

    await expect(validatePublicMediaUrl('https://cdn.example.test/image.png', {
      mediaType: 'image',
      lookup,
      requestImpl: fakeHttpsRequest([{
        remoteAddress: '93.184.216.34',
        headers: { 'content-type': 'image/png' }
      }])
    })).rejects.toThrow(/content length/);

    await expect(validatePublicMediaUrl('https://cdn.example.test/file.bin', {
      mediaType: 'image',
      lookup,
      requestImpl: fakeHttpsRequest([{
        remoteAddress: '93.184.216.34',
        headers: { 'content-type': 'application/octet-stream', 'content-length': '10' }
      }])
    })).rejects.toThrow(/content type/);

    await expect(validatePublicMediaUrl('https://cdn.example.test/image.png', {
      mediaType: 'image',
      config: { mediaMaxMb: 1 },
      lookup,
      requestImpl: fakeHttpsRequest([{
        remoteAddress: '93.184.216.34',
        headers: { 'content-type': 'image/png', 'content-length': String(2 * 1024 * 1024) }
      }])
    })).rejects.toThrow(/size limit/);
  });
});
