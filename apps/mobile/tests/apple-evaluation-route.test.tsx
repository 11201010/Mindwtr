import React from 'react';
import { Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tasks: new Map<string, { id: string; deletedAt?: string }>(),
  showToast: vi.fn(),
  updateTask: vi.fn(),
  pccEnabled: true,
}));

vi.mock('@mindwtr/core', () => ({
  isTaskVisible: (task: { deletedAt?: string }) => !task.deletedAt,
  useTaskStore: Object.assign(
    (selector: (store: unknown) => unknown) => selector({ _tasksById: state.tasks }),
    { getState: () => ({ _tasksById: state.tasks, updateTask: state.updateTask }) },
  ),
}));
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => React.createElement('Redirect', { href, testID: 'redirect' }),
  Stack: { Screen: () => null },
  useRouter: () => ({ canGoBack: () => false, replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => React.createElement('SafeAreaView', props),
}));
vi.mock('@/components/AppleSearchEvaluation', () => ({
  AppleSearchEvaluation: (props: object) => React.createElement('SearchEvaluation', { ...props, testID: 'search' }),
}));
vi.mock('@/components/AppleImageCaptureEvaluation', () => ({
  AppleImageCaptureEvaluation: (props: object) => React.createElement('ImageEvaluation', { ...props, testID: 'image' }),
}));
vi.mock('@/components/ApplePccEvaluation', () => ({
  ApplePccEvaluation: () => React.createElement('PccEvaluation', { testID: 'pcc' }),
}));
vi.mock('@/lib/apple-pcc-evaluation', () => ({
  isApplePccEvaluationEnabled: () => state.pccEnabled,
}));
vi.mock('@/components/task-edit-modal', () => ({
  TaskEditModal: (props: object) => React.createElement('TaskEditor', { ...props, testID: 'editor' }),
}));
vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({ bg: '#fff', text: '#111', tint: '#00f', secondaryText: '#555' }),
}));
vi.mock('@/contexts/toast-context', () => ({ useToast: () => ({ showToast: state.showToast }) }));

import AppleEvaluationRoute from '@/app/apple-evaluation';

const originalOS = Platform.OS;
let tree: ReturnType<typeof create> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('__DEV__', true);
  Platform.OS = 'ios';
  state.tasks = new Map();
  state.pccEnabled = true;
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  Platform.OS = originalOS;
  vi.unstubAllGlobals();
});

it.each([
  { dev: false, os: 'ios' },
  { dev: true, os: 'android' },
])('does not mount inference entry points for $os with development=$dev', async ({ dev, os }) => {
  vi.stubGlobal('__DEV__', dev);
  Platform.OS = os as typeof Platform.OS;
  await act(async () => { tree = create(<AppleEvaluationRoute />); });
  expect(tree!.root.findAllByProps({ testID: 'search' })).toHaveLength(0);
  expect(tree!.root.findAllByProps({ testID: 'image' })).toHaveLength(0);
  expect(tree!.root.findAllByProps({ testID: 'pcc' })).toHaveLength(0);
  expect(tree!.root.findByProps({ testID: 'redirect' }).props.href).toBe('/inbox');
});

it('shows PCC as an explicit development-only tab only when the build opt-in is enabled', async () => {
  await act(async () => { tree = create(<AppleEvaluationRoute />); });
  expect(tree!.root.findAllByProps({ testID: 'pcc' })).toHaveLength(0);
  const pccTab = tree!.root.findByProps({ children: 'PCC comparison' }).parent;
  await act(async () => { pccTab?.props.onPress(); });
  expect(tree!.root.findAllByProps({ testID: 'pcc' })).toHaveLength(1);
});

it('omits the PCC tab when the build-time opt-in is disabled', async () => {
  state.pccEnabled = false;
  await act(async () => { tree = create(<AppleEvaluationRoute />); });
  expect(tree!.root.findAllByProps({ children: 'PCC comparison' })).toHaveLength(0);
  expect(tree!.root.findAllByProps({ testID: 'pcc' })).toHaveLength(0);
});

it('opens the current task by ID and refuses a result deleted after search', async () => {
  state.tasks = new Map([['a', { id: 'a' }], ['b', { id: 'b', deletedAt: '2026-09-14' }]]);
  await act(async () => { tree = create(<AppleEvaluationRoute />); });
  const open = tree!.root.findByProps({ testID: 'search' }).props.onOpenTask;
  await act(async () => { open('b'); open('missing'); });
  expect(tree!.root.findAllByProps({ testID: 'editor' })).toHaveLength(0);
  expect(state.showToast).toHaveBeenCalledTimes(2);
  await act(async () => { open('a'); });
  expect(tree!.root.findByProps({ testID: 'editor' }).props.task).toBe(state.tasks.get('a'));
  expect(state.updateTask).not.toHaveBeenCalled();
});
