import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  downloadLineMessageContent,
  isBlockedIp,
  isSafeLineMessageId,
  validatePublicMediaUrl
} from '../src/lib/media.js';

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

    expect(fetchImpl).toHaveBeenCalledWith('https://api.line.me/v2/bot/message/msg_123/content', expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer token' }
    }));
    expect(result.filePath).toBe(path.join(dir, 'msg_123.png'));
    expect(fs.readFileSync(result.filePath, 'utf8')).toBe('data');
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
