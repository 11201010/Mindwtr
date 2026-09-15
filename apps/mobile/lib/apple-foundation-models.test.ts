import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  capability: vi.fn(),
  clarify: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { appleClarificationPrototypeEnabled: true } } },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../modules/apple-foundation-models', () => ({
  getNativeAppleFoundationModelsCapability: native.capability,
  requestNativeAppleInboxClarification: native.clarify,
  cancelNativeAppleInboxClarification: native.cancel,
}));

import {
  AppleClarificationCancelledError,
  AppleClarificationInputError,
  AppleClarificationOutputError,
  APPLE_CLARIFICATION_MAX_CANDIDATES_PER_KIND,
  areAppleClarificationAssociationsCurrent,
  buildAppleClarificationCandidates,
  consumeAppleClarificationApply,
  createAppleClarificationLease,
  isAppleClarificationLeaseCurrent,
  requestAppleInboxClarification,
  validateAppleClarificationInput,
  validateAppleClarificationSuggestion,
  type AppleClarificationDraftSnapshot,
  type AppleClarificationInput,
} from './apple-foundation-models';

const input: AppleClarificationInput = {
  requestId: 'request-1',
  locale: 'en-US',
  title: 'Call dentist by September 18, 2026',
  description: 'Book the annual checkup.',
  candidates: [
    { kind: 'project', id: 'project-health', label: 'Health' },
    { kind: 'area', id: 'area-personal', label: 'Personal' },
    { kind: 'context', id: '@phone', label: '@phone' },
    { kind: 'tag', id: '#health', label: '#health' },
  ],
};

const snapshot: AppleClarificationDraftSnapshot = {
  taskId: 'task-1',
  revision: '4:device-a:2026-09-14T12:00:00.000Z',
  title: input.title,
  description: input.description,
  projectId: null,
  areaId: null,
  contexts: [],
  tags: [],
  startDate: null,
  dueDate: null,
  startDateOnly: false,
  dueDateOnly: false,
  workflowChoices: [null, null, null],
};

describe('Apple clarification validation and lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.capability.mockResolvedValue({ available: true, supportedOperations: ['inbox_clarification'] });
  });

  it('rejects oversized source text and candidate sets instead of truncating them', () => {
    expect(() => validateAppleClarificationInput({ ...input, title: 'x'.repeat(513) }))
      .toThrow(AppleClarificationInputError);
    expect(() => validateAppleClarificationInput({
      ...input,
      candidates: Array.from({ length: APPLE_CLARIFICATION_MAX_CANDIDATES_PER_KIND + 1 }, (_, index) => ({
        kind: 'context' as const,
        id: `@context-${index}`,
        label: `@context-${index}`,
      })),
    })).toThrow(AppleClarificationInputError);
  });

  it('rejects malformed and invented associations', () => {
    expect(() => validateAppleClarificationSuggestion({
      cleanedTitle: 'Call the dentist',
      projectIds: ['invented'],
    }, input)).toThrow(AppleClarificationOutputError);
    expect(() => validateAppleClarificationSuggestion({
      cleanedTitle: 'Call the dentist',
      projectIds: ['project-health'],
      areaIds: ['area-personal'],
    }, input)).toThrow('Project and area associations conflict');
  });

  it('accepts real IDs and only dates backed by explicit source evidence', () => {
    const suggestion = validateAppleClarificationSuggestion({
      cleanedTitle: 'Call the dentist',
      status: 'next',
      projectIds: ['project-health'],
      contextIds: ['@phone'],
      tagIds: ['#health'],
      dueDate: '2026-09-18',
      dueDateEvidence: 'September 18, 2026',
      startDate: '2026-09-17',
      startDateEvidence: 'tomorrow',
    }, input);

    expect(suggestion).toEqual({
      cleanedTitle: 'Call the dentist',
      status: 'next',
      projectId: 'project-health',
      contextIds: ['@phone'],
      tagIds: ['#health'],
      dueDate: '2026-09-18',
    });
  });

  it('cancels native inference from an AbortSignal and ignores its late result', async () => {
    let resolve!: (value: { cleanedTitle: string }) => void;
    native.clarify.mockReturnValue(new Promise((done) => { resolve = done; }));
    const controller = new AbortController();
    const pending = requestAppleInboxClarification(input, { signal: controller.signal });

    controller.abort();
    resolve({ cleanedTitle: 'Late result' });

    await expect(pending).rejects.toBeInstanceOf(AppleClarificationCancelledError);
    expect(native.cancel).toHaveBeenCalledWith('request-1');
  });

  it('invalidates a lease on task revision or draft edits and consumes Apply once', () => {
    const lease = createAppleClarificationLease('request-1', snapshot);
    expect(isAppleClarificationLeaseCurrent(lease, snapshot)).toBe(true);
    expect(isAppleClarificationLeaseCurrent(lease, { ...snapshot, title: 'Edited while waiting' })).toBe(false);
    expect(isAppleClarificationLeaseCurrent(lease, { ...snapshot, revision: '5:device-b:new' })).toBe(false);

    const consumed = new Set<string>();
    expect(consumeAppleClarificationApply(lease, snapshot, consumed)).toBe(true);
    expect(consumeAppleClarificationApply(lease, snapshot, consumed)).toBe(false);
  });

  it('rejects suggestions after time-only, date-mode, or workflow edits', () => {
    const before: AppleClarificationDraftSnapshot = {
      ...snapshot,
      startDate: String(Date.parse('2026-09-18T09:00:00Z')),
      workflowChoices: ['actionable', 'no', 'defer'],
    };
    const lease = createAppleClarificationLease('request-1', before);
    expect(isAppleClarificationLeaseCurrent(lease, {
      ...before, startDate: String(Date.parse('2026-09-18T10:00:00Z')),
    })).toBe(false);
    expect(isAppleClarificationLeaseCurrent(lease, { ...before, startDateOnly: true })).toBe(false);
    expect(isAppleClarificationLeaseCurrent(lease, {
      ...before, workflowChoices: ['reference', null, null],
    })).toBe(false);
  });

  it('revalidates IDs against current app state immediately before Apply', () => {
    const suggestion = validateAppleClarificationSuggestion({
      cleanedTitle: 'Call the dentist',
      projectIds: ['project-health'],
      contextIds: ['@phone'],
    }, input);
    expect(areAppleClarificationAssociationsCurrent(suggestion, {
      projectIds: new Set(['project-health']),
      areaIds: new Set(['area-personal']),
      contextIds: new Set(['@phone']),
      tagIds: new Set(['#health']),
    })).toBe(true);
    expect(areAppleClarificationAssociationsCurrent(suggestion, {
      projectIds: new Set(),
      areaIds: new Set(['area-personal']),
      contextIds: new Set(['@phone']),
      tagIds: new Set(['#health']),
    })).toBe(false);
  });

  it('builds only bounded relevant candidates rather than exposing the store', () => {
    const candidates = buildAppleClarificationCandidates({
      title: 'Health call',
      description: '',
      projects: Array.from({ length: 30 }, (_, index) => ({
        id: `project-${index}`,
        title: index === 20 ? 'Health' : `Unrelated ${index}`,
        status: 'active' as const,
        color: '#000000',
        order: index,
        tagIds: [],
        createdAt: '',
        updatedAt: '',
      })),
      areas: [],
      contexts: ['@phone', '@office'],
      tags: ['#health', '#later'],
      selectedContexts: ['@phone'],
    });

    expect(candidates).toContainEqual({ kind: 'project', id: 'project-20', label: 'Health' });
    expect(candidates).toContainEqual({ kind: 'context', id: '@phone', label: '@phone' });
    expect(candidates.filter((candidate) => candidate.kind === 'project').length)
      .toBeLessThanOrEqual(APPLE_CLARIFICATION_MAX_CANDIDATES_PER_KIND);
    expect(candidates).not.toContainEqual(expect.objectContaining({ id: 'project-0' }));
  });

  it('keeps current draft associations even when they are absent from the suggestion pool', () => {
    const candidates = buildAppleClarificationCandidates({
      title: 'Call',
      description: '',
      projects: [],
      areas: [],
      contexts: ['@office'],
      tags: ['#later'],
      selectedContexts: ['@phone'],
      selectedTags: ['#health'],
    });

    expect(candidates).toContainEqual({ kind: 'context', id: '@phone', label: '@phone' });
    expect(candidates).toContainEqual({ kind: 'tag', id: '#health', label: '#health' });
  });

  it('rejects a draft whose selected associations cannot fit without truncation', () => {
    expect(() => buildAppleClarificationCandidates({
      title: 'Call',
      description: '',
      projects: [],
      areas: [],
      contexts: [],
      tags: [],
      selectedContexts: Array.from(
        { length: APPLE_CLARIFICATION_MAX_CANDIDATES_PER_KIND + 1 },
        (_, index) => `@context-${index}`,
      ),
    })).toThrow(AppleClarificationInputError);
  });
});
