import { WhitelistStrategy } from '../../../src/strategies/whitelist';

describe('WhitelistStrategy', () => {
  const strategy = new WhitelistStrategy();

  it('returns canary for whitelisted users', () => {
    const result = strategy.evaluate(
      { id: 'alice' },
      { type: 'whitelist', userIds: ['alice', 'bob'] },
    );
    expect(result).toBe('canary');
  });

  it('returns null for non-whitelisted users', () => {
    const result = strategy.evaluate(
      { id: 'charlie' },
      { type: 'whitelist', userIds: ['alice', 'bob'] },
    );
    expect(result).toBeNull();
  });

  it('returns null for non-whitelist config', () => {
    expect(strategy.evaluate({ id: 'a' }, { type: 'percentage', percentage: 50 })).toBeNull();
  });

  it('handles empty whitelist', () => {
    expect(strategy.evaluate({ id: 'a' }, { type: 'whitelist', userIds: [] })).toBeNull();
  });
});
