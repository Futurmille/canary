import { CanaryManager } from '../../../src/core/canary-manager';
import { InMemoryStorage } from '../../../src/storage/in-memory';

describe('Multi-variant support', () => {
  let storage: InMemoryStorage;
  let manager: CanaryManager;

  beforeEach(() => {
    storage = new InMemoryStorage();
    manager = new CanaryManager({ storage });
  });

  it('whitelist strategy can target a custom variant', async () => {
    await manager.createExperiment('checkout', [
      { type: 'whitelist', userIds: ['alice'], variant: 'variant-a' },
      { type: 'whitelist', userIds: ['bob'], variant: 'variant-b' },
      { type: 'percentage', percentage: 0 },
    ]);

    expect(await manager.getVariant({ id: 'alice' }, 'checkout')).toBe('variant-a');
    expect(await manager.getVariant({ id: 'bob' }, 'checkout')).toBe('variant-b');
    expect(await manager.getVariant({ id: 'charlie' }, 'checkout')).toBe('stable');
  });

  it('attribute strategy can target a custom variant', async () => {
    await manager.createExperiment('pricing', [
      { type: 'attribute', attribute: 'country', values: ['US'], variant: 'us-pricing' },
      { type: 'attribute', attribute: 'country', values: ['EU'], variant: 'eu-pricing' },
      { type: 'percentage', percentage: 0 },
    ]);

    expect(await manager.getVariant(
      { id: 'u1', attributes: { country: 'US' } }, 'pricing',
    )).toBe('us-pricing');

    expect(await manager.getVariant(
      { id: 'u2', attributes: { country: 'EU' } }, 'pricing',
    )).toBe('eu-pricing');

    expect(await manager.getVariant(
      { id: 'u3', attributes: { country: 'JP' } }, 'pricing',
    )).toBe('stable');
  });

  it('percentage strategy can target a custom variant', async () => {
    await manager.createExperiment('test', [
      { type: 'percentage', percentage: 100, variant: 'beta' },
    ]);

    expect(await manager.getVariant({ id: 'user-1' }, 'test')).toBe('beta');
  });

  it('strategies default to canary when variant is not specified', async () => {
    await manager.createExperiment('test', [
      { type: 'whitelist', userIds: ['alice'] },
      // no variant field → defaults to 'canary'
    ]);

    expect(await manager.getVariant({ id: 'alice' }, 'test')).toBe('canary');
  });

  it('sticky sessions preserve custom variants', async () => {
    await manager.createExperiment('test', [
      { type: 'whitelist', userIds: ['alice'], variant: 'variant-a' },
    ]);

    const first = await manager.getVariant({ id: 'alice' }, 'test');
    const second = await manager.getVariant({ id: 'alice' }, 'test');
    expect(first).toBe('variant-a');
    expect(second).toBe('variant-a');
  });
});
