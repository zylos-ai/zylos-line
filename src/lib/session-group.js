/**
 * Session-group mapping for zylos-core multi-session mode.
 *
 * The group name is derived only from the reply endpoint, so the inbound
 * `--session-group` value and `scripts/session-group.js <endpoint>` always
 * agree. Rules (fixed once live; changing them needs a migration with Core):
 *   `<userId>|type:dm|account:<id>|...`     -> dm-<account>:<userId>
 *   `<groupId>|type:group|account:<id>|...` -> group-<account>:<groupId>
 *   `<roomId>|type:room|account:<id>|...`   -> room-<account>:<roomId>
 *   `admin|type:dm-pairing|...` (pairing notice to the agent) -> '' (overall group)
 *
 * One group per LINE account and conversation, because each account is its
 * own bot. The account id contains no ':' and LINE ids are alphanumeric, so
 * the first ':' splits account from conversation: the mapping is one-to-one.
 * Per-message parts (user, replyKey) never take part. Anything else throws;
 * ids are never truncated or hashed. Core adds the `line:` namespace.
 */

/** Core's limits for the name a component passes (Core adds `<namespace>:`). */
export const SESSION_GROUP_MAX_LENGTH = 95;
export const SESSION_GROUP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

/** Endpoint of the pairing notice sent to the agent, not a LINE conversation. */
export const PAIRING_NOTICE_TYPE = 'dm-pairing';

const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const LINE_ID = /^[A-Za-z0-9]+$/;
const PREFIX = { dm: 'dm', group: 'group', room: 'room' };

/**
 * Whether Core would accept this nonempty name.
 * @param {string} name
 * @returns {boolean}
 */
export function isValidSessionGroup(name) {
  return typeof name === 'string' && name.length <= SESSION_GROUP_MAX_LENGTH
    && SESSION_GROUP_PATTERN.test(name);
}

const quote = (value, max = 64) => JSON.stringify(String(value ?? '').slice(0, max));

function endpointField(parts, key) {
  return parts.slice(1).find((part) => part.startsWith(`${key}:`))?.slice(key.length + 1);
}

/**
 * Derive the in-group session name from an endpoint string.
 * @param {string} endpoint - e.g. "Uabc|type:dm|account:default|user:Uabc|replyKey:k"
 * @returns {string} group name without namespace; '' for the overall group
 * @throws {Error} when the endpoint cannot be mapped
 */
export function sessionGroupFromEndpoint(endpoint) {
  const parts = String(endpoint ?? '').split('|');
  const targetId = parts[0];
  const type = endpointField(parts, 'type');
  const account = endpointField(parts, 'account');

  if (type === PAIRING_NOTICE_TYPE && targetId === 'admin') return '';
  if (type === undefined) throw new Error(`endpoint has no type: ${quote(endpoint)}`);
  const prefix = PREFIX[type];
  if (!prefix) throw new Error(`unknown chat type in endpoint: ${quote(type, 32)}`);
  if (account === undefined || !ACCOUNT_ID.test(account)) {
    throw new Error(`invalid LINE account in endpoint: ${quote(endpoint)}`);
  }
  if (!LINE_ID.test(targetId)) throw new Error(`invalid LINE id in endpoint: ${quote(endpoint)}`);

  const name = `${prefix}-${account}:${targetId}`;
  if (!isValidSessionGroup(name)) {
    throw new Error(`session group would be invalid for Core (length ${name.length}, max ${SESSION_GROUP_MAX_LENGTH})`);
  }
  return name;
}
