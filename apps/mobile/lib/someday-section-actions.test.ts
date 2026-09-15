import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  settings: {
    gtd: {
      viewSections: { someday: [] as Array<{ id: string; title: string; order: number }> },
    },
  },
  updateSettings: vi.fn().mockResolvedValue(undefined),
  flushPendingSave: vi.fn().mockResolvedValue(undefined),
  persistenceFailure: null as null | { message: string; failedAt: string; retrying: boolean },
  retryPersistence: vi.fn(async () => { storeState.persistenceFailure = null; }),
}));

vi.mock('@mindwtr/core', () => ({
  sortViewSectionDefinitions: (definitions: typeof storeState.settings.gtd.viewSections.someday = []) => (
    [...definitions].sort((left, right) => left.order - right.order)
  ),
  flushPendingSave: storeState.flushPendingSave,
  useTaskStore: {
    getState: () => storeState,
  },
}));

import { createSomedaySection } from './someday-section-actions';

describe('createSomedaySection', () => {
  beforeEach(() => {
    storeState.settings = { gtd: { viewSections: { someday: [] } } };
    storeState.updateSettings.mockClear();
    storeState.flushPendingSave.mockReset().mockResolvedValue(undefined);
    storeState.retryPersistence.mockClear();
    storeState.persistenceFailure = null;
  });

  it('creates the first definition consumed by the mobile Someday section grouping', async () => {
    const createdId = await createSomedaySection('Books to read');

    expect(createdId).toEqual(expect.any(String));
    expect(storeState.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      gtd: expect.objectContaining({
        viewSections: {
          someday: [expect.objectContaining({ id: createdId, title: 'Books to read', order: 0 })],
        },
      }),
    }));
    expect(storeState.flushPendingSave).toHaveBeenCalledOnce();
  });

  it('retries a failed durable creation without inserting a duplicate definition', async () => {
    storeState.updateSettings.mockImplementationOnce(async (updates) => {
      storeState.settings = updates;
    });
    storeState.flushPendingSave.mockImplementationOnce(async () => {
      storeState.persistenceFailure = { message: 'disk full', failedAt: 'now', retrying: false };
      throw new Error('disk full');
    });

    await expect(createSomedaySection('Books to read')).rejects.toThrow('disk full');
    expect(storeState.settings.gtd.viewSections.someday).toHaveLength(1);

    const existingId = storeState.settings.gtd.viewSections.someday[0].id;
    await expect(createSomedaySection('Books to read')).resolves.toBe(existingId);
    expect(storeState.updateSettings).toHaveBeenCalledOnce();
    expect(storeState.flushPendingSave).toHaveBeenCalledTimes(2);
    expect(storeState.retryPersistence).toHaveBeenCalledOnce();
  });

  it('appends later definitions without rewriting the existing section', async () => {
    storeState.settings = {
      gtd: {
        viewSections: { someday: [{ id: 'books', title: 'Books to read', order: 0 }] },
      },
    };

    await createSomedaySection('Career ideas');

    expect(storeState.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      gtd: expect.objectContaining({
        viewSections: {
          someday: [
            { id: 'books', title: 'Books to read', order: 0 },
            expect.objectContaining({ title: 'Career ideas', order: 1 }),
          ],
        },
      }),
    }));
  });
});
