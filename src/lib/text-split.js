export const LINE_MAX_TEXT_CHARS = 5000;
export const LINE_MAX_MESSAGES_PER_REQUEST = 5;

export function splitText(text, maxChars = LINE_MAX_TEXT_CHARS) {
  const input = String(text ?? '');
  if (input.length <= maxChars) return [input];

  const chunks = [];
  for (let offset = 0; offset < input.length; offset += maxChars) {
    chunks.push(input.slice(offset, offset + maxChars));
  }
  return chunks;
}

export function toTextMessages(text) {
  return splitText(text).map(chunk => ({
    type: 'text',
    text: chunk
  }));
}

export function batchMessages(messages, size = LINE_MAX_MESSAGES_PER_REQUEST) {
  const batches = [];
  for (let offset = 0; offset < messages.length; offset += size) {
    batches.push(messages.slice(offset, offset + size));
  }
  return batches;
}
