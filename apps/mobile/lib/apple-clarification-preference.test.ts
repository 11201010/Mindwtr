import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

import {
  readAppleClarificationBackend,
  writeAppleClarificationBackend,
} from './apple-clarification-preference';

describe('Apple clarification device-local backend preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getItem.mockResolvedValue(null);
  });

  it('defaults invalid or missing state to the configured provider', async () => {
    await expect(readAppleClarificationBackend()).resolves.toBe('configured');
    storage.getItem.mockResolvedValue('future-value');
    await expect(readAppleClarificationBackend()).resolves.toBe('configured');
  });

  it('persists only the on-device override and removes it for the default', async () => {
    await writeAppleClarificationBackend('on-device');
    expect(storage.setItem).toHaveBeenCalledWith('mindwtr:appleClarificationBackend:v1', 'on-device');

    storage.getItem.mockResolvedValue('on-device');
    await expect(readAppleClarificationBackend()).resolves.toBe('on-device');

    await writeAppleClarificationBackend('configured');
    expect(storage.removeItem).toHaveBeenCalledWith('mindwtr:appleClarificationBackend:v1');
  });

  it('fails closed when device storage is unavailable', async () => {
    storage.getItem.mockRejectedValue(new Error('unavailable'));
    await expect(readAppleClarificationBackend()).resolves.toBe('configured');
    storage.setItem.mockRejectedValue(new Error('unavailable'));
    await expect(writeAppleClarificationBackend('on-device')).resolves.toBeUndefined();
  });
});
