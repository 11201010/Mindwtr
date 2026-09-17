import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: true,
  fixtures: vi.fn(),
  capability: vi.fn(),
  run: vi.fn(),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    bg: '#fff', border: '#ddd', text: '#111', secondaryText: '#555', tint: '#06f', onTint: '#fff', danger: '#c00',
  }),
}));
vi.mock('@/lib/apple-pcc-evaluation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/apple-pcc-evaluation')>();
  return {
    ...actual,
    isApplePccEvaluationEnabled: () => mocks.enabled,
    loadApplePccEvaluationFixtures: mocks.fixtures,
    getApplePccEvaluationCapability: mocks.capability,
    runApplePccEvaluation: mocks.run,
  };
});

import { ApplePccEvaluation } from './ApplePccEvaluation';

const text = (node: ReactTestInstance): string => (
  Array.isArray(node.props.children)
    ? node.props.children.filter((value: unknown) => typeof value === 'string' || typeof value === 'number').join('')
    : typeof node.props.children === 'string'
      ? node.props.children
      : ''
);
const pressable = (root: ReactTestInstance, label: string): ReactTestInstance => {
  const labelNode = root.findAll((node) => text(node) === label)[0];
  if (!labelNode?.parent) throw new Error(`Missing pressable: ${label}`);
  return labelNode.parent;
};
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('ApplePccEvaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.fixtures.mockResolvedValue([
      { fixtureId: 'smoke', text: 'Synthetic smoke fixture.' },
      { fixtureId: 'project_planning', text: 'Synthetic planning fixture.' },
    ]);
    mocks.capability.mockImplementation(async (backend: string) => ({ available: true, backend }));
    mocks.run.mockResolvedValue({
      backend: 'private_cloud_compute',
      fixtureId: 'smoke',
      outcome: 'completed',
      durationMs: 42,
      summary: 'Smoke passed.',
      nextActions: [],
    });
  });

  it('loads capability and native-owned text without starting inference', async () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ApplePccEvaluation />); });
    await flush();
    expect(tree.root.findByProps({ children: 'Synthetic smoke fixture.' })).toBeTruthy();
    expect(mocks.capability).toHaveBeenCalledTimes(2);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(pressable(tree.root, '2. Project planning').props.disabled).toBe(false);
  });

  it('allows the explicitly selected local planning baseline before PCC smoke', async () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ApplePccEvaluation />); });
    await flush();
    act(() => { pressable(tree.root, '2. Project planning').props.onPress(); });
    expect(pressable(tree.root, 'Run On-device baseline').props.disabled).toBe(false);
    expect(pressable(tree.root, 'Run Apple Private Cloud Compute').props.disabled).toBe(true);
  });

  it('requires and consumes per-request PCC consent, then unlocks the planning fixture after smoke', async () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ApplePccEvaluation />); });
    await flush();
    const consent = tree.root.findByProps({ accessibilityLabel: 'Consent to this PCC request' });
    expect(consent.props.accessibilityState.checked).toBe(false);
    act(() => { consent.props.onPress(); });
    expect(tree.root.findByProps({ accessibilityLabel: 'Consent to this PCC request' }).props.accessibilityState.checked).toBe(true);

    const runPcc = pressable(tree.root, 'Run Apple Private Cloud Compute');
    act(() => {
      runPcc.props.onPress();
      runPcc.props.onPress();
    });
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'private_cloud_compute', fixtureId: 'smoke', consent: true, signal: expect.any(AbortSignal),
    }));
    expect(tree.root.findByProps({ accessibilityLabel: 'Consent to this PCC request' }).props.accessibilityState.checked).toBe(false);
    expect(pressable(tree.root, '2. Project planning').props.disabled).toBe(false);
    expect(tree.root.findByProps({ children: 'Smoke passed.' })).toBeTruthy();
  });

  it('does not let a stalled PCC capability check block fixtures or the local baseline', async () => {
    mocks.capability.mockImplementation((backend: string) => (
      backend === 'private_cloud_compute'
        ? new Promise(() => undefined)
        : Promise.resolve({ available: true, backend })
    ));
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ApplePccEvaluation />); });
    await flush();
    expect(tree.root.findByProps({ children: 'Synthetic smoke fixture.' })).toBeTruthy();
    expect(pressable(tree.root, 'Run On-device baseline').props.disabled).toBe(false);
    act(() => { pressable(tree.root, 'Run On-device baseline').props.onPress(); });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ backend: 'on_device' }));
    act(() => { tree.unmount(); });
  });

  it('aborts an active request on cancel and never mounts when the build flag is off', async () => {
    let observedSignal: AbortSignal | undefined;
    mocks.run.mockImplementation((_options: { signal?: AbortSignal }) => {
      observedSignal = _options.signal;
      return new Promise(() => undefined);
    });
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ApplePccEvaluation />); });
    await flush();
    act(() => { pressable(tree.root, 'Run On-device baseline').props.onPress(); });
    expect(observedSignal?.aborted).toBe(false);
    act(() => { pressable(tree.root, 'Cancel On-device baseline').props.onPress(); });
    expect(observedSignal?.aborted).toBe(true);

    act(() => { tree.unmount(); });
    mocks.enabled = false;
    act(() => { tree = create(<ApplePccEvaluation />); });
    expect(tree.toJSON()).toBeNull();
  });
});
