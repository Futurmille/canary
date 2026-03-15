import { PercentageStrategy } from '../../../src/strategies/percentage';
import { CanaryUser, PercentageStrategyConfig } from '../../../src/types';

describe('PercentageStrategy', () => {
  const strategy = new PercentageStrategy();

  const user = (id: string): CanaryUser => ({ id });
  const config = (pct: number): PercentageStrategyConfig => ({ type: 'percentage', percentage: pct });

  it('returns null for non-percentage configs', () => {
    expect(strategy.evaluate(user('a'), { type: 'whitelist', userIds: [] })).toBeNull();
  });

  it('at 0% everyone gets stable', () => {
    for (let i = 0; i < 50; i++) {
      expect(strategy.evaluate(user(`user-${i}`), config(0))).toBe('stable');
    }
  });

  it('at 100% everyone gets canary', () => {
    for (let i = 0; i < 50; i++) {
      expect(strategy.evaluate(user(`user-${i}`), config(100))).toBe('canary');
    }
  });

  it('is deterministic — same user always gets same result', () => {
    const u = user('deterministic-user');
    const c = config(50);
    const first = strategy.evaluate(u, c);
    for (let i = 0; i < 20; i++) {
      expect(strategy.evaluate(u, c)).toBe(first);
    }
  });

  it('produces roughly expected distribution at 50%', () => {
    const total = 1000;
    let canaryCount = 0;
    for (let i = 0; i < total; i++) {
      if (strategy.evaluate(user(`dist-${i}`), config(50)) === 'canary') {
        canaryCount++;
      }
    }
    // Allow 10% tolerance
    expect(canaryCount).toBeGreaterThan(total * 0.4);
    expect(canaryCount).toBeLessThan(total * 0.6);
  });

  it('increasing percentage never reassigns existing canary users to stable', () => {
    // Users in canary at 20% should still be in canary at 50%
    const canaryAt20: string[] = [];
    for (let i = 0; i < 500; i++) {
      const id = `rollout-${i}`;
      if (strategy.evaluate(user(id), config(20)) === 'canary') {
        canaryAt20.push(id);
      }
    }

    // This is guaranteed by deterministic hashing: bucket doesn't change,
    // only the threshold moves. All users canary at 20% are still canary at 50%.
    for (const id of canaryAt20) {
      expect(strategy.evaluate(user(id), config(50))).toBe('canary');
    }
  });
});
