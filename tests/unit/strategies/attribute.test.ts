import { AttributeStrategy } from '../../../src/strategies/attribute';

describe('AttributeStrategy', () => {
  const strategy = new AttributeStrategy();

  it('returns canary when attribute matches', () => {
    const result = strategy.evaluate(
      { id: 'u1', attributes: { country: 'US' } },
      { type: 'attribute', attribute: 'country', values: ['US', 'CA'] },
    );
    expect(result).toBe('canary');
  });

  it('returns null when attribute does not match', () => {
    const result = strategy.evaluate(
      { id: 'u1', attributes: { country: 'FR' } },
      { type: 'attribute', attribute: 'country', values: ['US', 'CA'] },
    );
    expect(result).toBeNull();
  });

  it('returns null when user has no attributes', () => {
    const result = strategy.evaluate(
      { id: 'u1' },
      { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
    );
    expect(result).toBeNull();
  });

  it('returns null when user lacks the specific attribute', () => {
    const result = strategy.evaluate(
      { id: 'u1', attributes: { role: 'admin' } },
      { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
    );
    expect(result).toBeNull();
  });

  it('handles numeric attribute matching', () => {
    const result = strategy.evaluate(
      { id: 'u1', attributes: { tier: 2 } },
      { type: 'attribute', attribute: 'tier', values: [2, 3] },
    );
    expect(result).toBe('canary');
  });

  it('handles boolean attribute matching', () => {
    const result = strategy.evaluate(
      { id: 'u1', attributes: { beta: true } },
      { type: 'attribute', attribute: 'beta', values: [true] },
    );
    expect(result).toBe('canary');
  });

  it('returns null for non-attribute config', () => {
    expect(strategy.evaluate({ id: 'a' }, { type: 'percentage', percentage: 50 })).toBeNull();
  });
});
