import { describe, expect, it, vi } from 'vitest';
import { decideInboundAccess } from '../src/lib/access.js';

function baseConfig(overrides = {}) {
  return {
    enabled: true,
    owner: {
      bound: true,
      userId: 'Uowner',
      name: 'Uowner'
    },
    dmPolicy: 'owner',
    dmAllowFrom: [],
    groupPolicy: 'allowlist',
    groups: {},
    ...overrides
  };
}

function event(source) {
  return {
    source,
    message: { type: 'text', text: 'hello' }
  };
}

describe('LINE inbound access control', () => {
  it('auto-binds the first DM sender as owner before policy checks', () => {
    const config = baseConfig({
      owner: { bound: false, userId: '', name: '' },
      dmPolicy: 'disabled'
    });
    const save = vi.fn(next => next);

    const result = decideInboundAccess({
      config,
      event: event({ type: 'user', userId: 'Ufirst' }),
      text: 'first',
      save
    });

    expect(result).toEqual({ allowed: true, reason: 'owner' });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      owner: { bound: true, userId: 'Ufirst', name: 'Ufirst' }
    }));
    expect(config.owner).toEqual({ bound: true, userId: 'Ufirst', name: 'Ufirst' });
  });

  it('denies first-owner DM access if owner binding cannot be persisted', () => {
    const config = baseConfig({
      owner: { bound: false, userId: '', name: '' },
      dmPolicy: 'open'
    });

    const result = decideInboundAccess({
      config,
      event: event({ type: 'user', userId: 'Ufirst' }),
      text: 'first',
      save: () => {
        throw new Error('disk failed');
      }
    });

    expect(result).toEqual({ allowed: false, reason: 'owner-bind-error' });
    expect(config.owner).toEqual({ bound: false, userId: '', name: '' });
  });

  it('applies DM policies after owner bypass', () => {
    expect(decideInboundAccess({
      config: baseConfig({ groupPolicy: 'disabled' }),
      event: event({ type: 'group', groupId: 'Gblocked', userId: 'Uowner' })
    })).toEqual({ allowed: true, reason: 'owner' });

    expect(decideInboundAccess({
      config: baseConfig({ dmPolicy: 'open' }),
      event: event({ type: 'user', userId: 'Uguest' })
    })).toEqual({ allowed: true, reason: 'dm-open' });

    expect(decideInboundAccess({
      config: baseConfig({ dmPolicy: 'allowlist', dmAllowFrom: ['Uguest'] }),
      event: event({ type: 'user', userId: 'Uguest' })
    })).toEqual({ allowed: true, reason: 'dm-allowlist' });

    expect(decideInboundAccess({
      config: baseConfig({ dmPolicy: 'allowlist', dmAllowFrom: ['Uother'] }),
      event: event({ type: 'user', userId: 'Uguest' })
    })).toEqual({ allowed: false, reason: 'dm-allowlist' });

    expect(decideInboundAccess({
      config: baseConfig({ dmPolicy: 'disabled' }),
      event: event({ type: 'user', userId: 'Uguest' })
    })).toEqual({ allowed: false, reason: 'dm-disabled' });
  });

  it('queues unpaired DMs without allowing them', () => {
    const state = { pending: {}, denied: {} };
    const savePairing = vi.fn();

    const result = decideInboundAccess({
      config: baseConfig({ dmPolicy: 'pairing' }),
      accountId: 'default',
      event: event({ type: 'user', userId: 'Uguest' }),
      text: 'please pair',
      loadPairing: () => state,
      savePairing
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('dm-pairing-pending');
    expect(result.notification.endpoint).toBe('admin|type:dm-pairing|account:default|user:Uguest');
    expect(result.notification.content).toContain('Uguest');
    expect(state.pending.Uguest).toEqual(expect.objectContaining({
      userId: 'Uguest',
      conversationId: 'Uguest',
      firstMessage: 'please pair'
    }));
    expect(savePairing).toHaveBeenCalledWith(state);
  });

  it('fails closed when pairing state cannot be read or written', () => {
    expect(decideInboundAccess({
      config: baseConfig({ dmPolicy: 'pairing' }),
      event: event({ type: 'user', userId: 'Uguest' }),
      loadPairing: () => {
        throw new Error('bad json');
      }
    })).toEqual({ allowed: false, reason: 'pairing-state-error' });

    expect(decideInboundAccess({
      config: baseConfig({ dmPolicy: 'pairing' }),
      event: event({ type: 'user', userId: 'Uguest' }),
      loadPairing: () => ({ pending: {}, denied: {} }),
      savePairing: () => {
        throw new Error('disk failed');
      }
    })).toEqual({ allowed: false, reason: 'pairing-state-error' });
  });

  it('does not duplicate pending pairing requests', () => {
    const state = { pending: { Uguest: { userId: 'Uguest' } }, denied: {} };
    const savePairing = vi.fn();

    const result = decideInboundAccess({
      config: baseConfig({ dmPolicy: 'pairing' }),
      event: event({ type: 'user', userId: 'Uguest' }),
      text: 'hello again',
      loadPairing: () => state,
      savePairing
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('dm-pairing-pending');
    expect(result.notification).toBeNull();
    expect(savePairing).not.toHaveBeenCalled();
  });

  it('allows configured groups with empty allowFrom and enforces non-empty allowFrom', () => {
    expect(decideInboundAccess({
      config: baseConfig({ groups: { G1: { allowFrom: [] } } }),
      event: event({ type: 'group', groupId: 'G1', userId: 'Uany' })
    })).toEqual({ allowed: true, reason: 'group-configured' });

    expect(decideInboundAccess({
      config: baseConfig({ groups: { G1: { allowFrom: [] } } }),
      event: event({ type: 'group', groupId: 'G1' })
    })).toEqual({ allowed: true, reason: 'group-configured' });

    expect(decideInboundAccess({
      config: baseConfig({ groups: { G1: { allowFrom: ['Uallowed'] } } }),
      event: event({ type: 'group', groupId: 'G1', userId: 'Udenied' })
    })).toEqual({ allowed: false, reason: 'group-allowFrom' });
  });

  it('maps rooms into the group access branch and requires configuration by default', () => {
    expect(decideInboundAccess({
      config: baseConfig({ groups: { R1: { allowFrom: [] } } }),
      event: event({ type: 'room', roomId: 'R1', userId: 'Uany' })
    })).toEqual({ allowed: true, reason: 'group-configured' });

    expect(decideInboundAccess({
      config: baseConfig(),
      event: event({ type: 'room', roomId: 'R1', userId: 'Uany' })
    })).toEqual({ allowed: false, reason: 'group-unconfigured' });
  });

  it('denies non-owner group messages when groupPolicy is disabled', () => {
    expect(decideInboundAccess({
      config: baseConfig({ groupPolicy: 'disabled', groups: { G1: { allowFrom: [] } } }),
      event: event({ type: 'group', groupId: 'G1', userId: 'Uany' })
    })).toEqual({ allowed: false, reason: 'group-disabled' });
  });

  it('allows a pairing-policy DM whose sender is already in dmAllowFrom', () => {
    const result = decideInboundAccess({
      config: baseConfig({ dmPolicy: 'pairing', dmAllowFrom: ['Uguest'] }),
      event: event({ type: 'user', userId: 'Uguest' }),
      text: 'hi',
      loadPairing: () => ({ pending: {}, denied: {} }),
      savePairing: vi.fn()
    });
    expect(result).toEqual({ allowed: true, reason: 'dm-pairing-approved' });
  });

  it('denies events with no resolvable target id (missing-target)', () => {
    expect(decideInboundAccess({
      config: baseConfig(),
      event: event({ type: 'group' })
    })).toEqual({ allowed: false, reason: 'missing-target' });
  });
});
