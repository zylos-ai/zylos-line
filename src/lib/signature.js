import crypto from 'node:crypto';

export function computeLineSignature(rawBody, channelSecret) {
  return crypto
    .createHmac('sha256', channelSecret)
    .update(rawBody)
    .digest('base64');
}

export function verifyLineSignature(rawBody, signatureHeader, channelSecret) {
  if (!Buffer.isBuffer(rawBody)) {
    throw new TypeError('rawBody must be a Buffer');
  }
  if (!signatureHeader || !channelSecret) return false;

  let actual;
  let expected;
  try {
    actual = Buffer.from(String(signatureHeader), 'base64');
    expected = Buffer.from(computeLineSignature(rawBody, channelSecret), 'base64');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
