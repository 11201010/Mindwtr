import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { workspaceSessionStorage as AsyncStorage } from '@/lib/workspace-session-storage';
import {
  type Task,
  buildPomodoroPanelModel,
  getPomodoroAutoStartOptions,
  isPomodoroLinkedTaskGone,
  type PomodoroAutoStartOptions,
  type PomodoroPanelAction,
  useTaskStore,
} from '@mindwtr/core';

import { useLanguage } from '../contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { logWarn } from '../lib/app-log';
import { POMODORO_COLLAPSED_STORAGE_KEY } from '../lib/pomodoro-session';
import { mobilePomodoroController, useMobilePomodoroControllerState } from '../lib/pomodoro-controller';

/** The Focus screen's Pomodoro card, drawn from core's model (packages/core/src/pomodoro-panel-model.ts), which the native app draws too. */
export function PomodoroPanel({
  tasks,
  onMarkDone,
}: {
  tasks: Task[];
  onMarkDone: (taskId: string) => void;
}) {
  const { t } = useLanguage();
  const tc = useThemeColors();
  const filledButton = useFilledButtonColors();
  const settings = useTaskStore((state) => state.settings);
  const liveTasks = useTaskStore((state) => state.tasks);
  const { autoStartBreaks, autoStartFocus } = getPomodoroAutoStartOptions(settings);
  const autoStartOptions = useMemo<PomodoroAutoStartOptions>(
    () => ({ autoStartBreaks, autoStartFocus }),
    [autoStartBreaks, autoStartFocus]
  );
  const pomodoro = useMobilePomodoroControllerState();
  // Presentation only, and deliberately device-local: a phone folding the card
  // away should not fold it away on the desktop too, so this lives in
  // AsyncStorage rather than synced settings (#946, matching desktop's #875).
  // Starts expanded so an update never hides a timer someone was already using.
  const [collapsed, setCollapsed] = useState(false);
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false);
  const model = useMemo(
    () => buildPomodoroPanelModel({ session: pomodoro, settings, tasks: liveTasks, collapsed, t }),
    [collapsed, liveTasks, pomodoro, settings, t]
  );
  const isHydratingSession = model.loading !== null;
  const linkTaskEnabled = model.link !== null;
  const linkedTaskGone = isPomodoroLinkedTaskGone(pomodoro, settings, liveTasks);

  useEffect(() => {
    void mobilePomodoroController.ensureHydrated(autoStartOptions);
  }, [autoStartOptions]);

  useEffect(() => {
    if (!linkTaskEnabled) {
      setIsTaskPickerOpen(false);
      return;
    }
    if (linkedTaskGone) mobilePomodoroController.setSelectedTaskId(undefined);
  }, [linkTaskEnabled, linkedTaskGone]);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(POMODORO_COLLAPSED_STORAGE_KEY)
      .then((raw) => {
        if (!active || raw === null) return;
        setCollapsed(raw === 'true');
      })
      .catch((error) => {
        logWarn('Failed to read pomodoro collapse preference', { scope: 'pomodoro', extra: { error: String(error) } });
      });
    return () => {
      active = false;
    };
  }, []);

  const runAction = (action: PomodoroPanelAction) => {
    switch (action.type) {
      case 'run':
        mobilePomodoroController.toggle(autoStartOptions);
        return;
      case 'reset':
        mobilePomodoroController.reset(autoStartOptions);
        return;
      case 'phase':
        mobilePomodoroController.switchPhase(autoStartOptions);
        return;
      case 'preset':
        mobilePomodoroController.setDurations({ focusMinutes: action.focusMinutes, breakMinutes: action.breakMinutes }, autoStartOptions);
        return;
      case 'selectTask':
        mobilePomodoroController.setSelectedTaskId(action.taskId ?? undefined);
        return;
      case 'markDone':
        onMarkDone(action.taskId);
        mobilePomodoroController.clearLastEvent();
        return;
      case 'collapse':
        setCollapsed(action.value);
        void AsyncStorage.setItem(POMODORO_COLLAPSED_STORAGE_KEY, String(action.value)).catch((error) => {
          logWarn('Failed to save pomodoro collapse preference', { scope: 'pomodoro', extra: { error: String(error) } });
        });
        return;
    }
  };

  const phaseColor = model.phase === 'focus' ? tc.tint : tc.success;

  const collapseToggle = (
    <Pressable
      accessibilityLabel={model.collapseToggle.label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => runAction(model.collapseToggle.action)}
      style={styles.collapseToggle}
    >
      {model.collapsed
        ? <ChevronDown size={18} color={tc.secondaryText} />
        : <ChevronUp size={18} color={tc.secondaryText} />}
    </Pressable>
  );

  if (model.collapsed) {
    // The session state and its timers live above this branch, so folding the
    // card away never stops the run — the clock here is the same one.
    return (
      <View style={[styles.card, styles.collapsedCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
        <View style={styles.collapsedRow}>
          <Text style={[styles.collapsedClock, { color: tc.text }]}>
            {model.clock}
          </Text>
          <Text style={[styles.phaseStatusText, { color: phaseColor }]} numberOfLines={1}>
            {model.status}
          </Text>
          {model.running && (
            <View
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.collapsedRunningDot, { backgroundColor: phaseColor }]}
            />
          )}
          <View style={styles.collapsedSpacer} />
          {collapseToggle}
        </View>
      </View>
    );
  }

  const { link, picker } = model;

  return (
    <View style={[styles.card, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: tc.text }]}>{model.title}</Text>
        </View>
        <View style={styles.phaseStatus}>
          <Text style={[styles.phaseStatusText, { color: phaseColor }]}>
            {model.phaseLabel}
          </Text>
        </View>
        {collapseToggle}
      </View>

      {model.loading !== null && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={tc.tint} />
          <Text style={[styles.loadingText, { color: tc.secondaryText }]}>{model.loading}</Text>
        </View>
      )}

      <View style={styles.presetRow}>
        {model.presets.map((preset) => (
          <Pressable
            key={preset.id}
            onPress={() => runAction(preset.action)}
            disabled={isHydratingSession}
            style={[
              styles.presetChip,
              {
                opacity: isHydratingSession ? 0.6 : 1,
                borderColor: preset.active ? tc.tint : tc.border,
                backgroundColor: preset.active ? tc.tint : tc.filterBg,
              },
            ]}
          >
            <Text style={[styles.presetText, { color: preset.active ? tc.onTint : tc.secondaryText }]}>{preset.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.timerBox}>
        <Text style={[styles.timerText, { color: tc.text }]}>{model.clock}</Text>
        <Text style={[styles.sessionText, { color: tc.secondaryText }]}>
          {model.sessions}
        </Text>
      </View>

      {link && (
        <View style={styles.taskLinkRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={link.label}
            onPress={() => setIsTaskPickerOpen(true)}
            style={[styles.taskPickerButton, { borderColor: tc.border, backgroundColor: tc.filterBg }]}
          >
            <View style={styles.taskPickerTextBlock}>
              <Text style={[styles.taskPickerLabel, { color: tc.secondaryText }]}>{link.label}</Text>
              <Text style={[styles.taskPickerValue, { color: tc.text }]} numberOfLines={1}>
                {link.value}
              </Text>
            </View>
            <Text style={[styles.taskPickerAction, { color: tc.tint }]}>{link.changeLabel}</Text>
          </Pressable>
          {link.markDone && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={link.markDone.accessibilityLabel}
              onPress={() => runAction(link.markDone!.action)}
              disabled={isHydratingSession}
              style={[
                styles.actionDone,
                {
                  opacity: !isHydratingSession ? 1 : 0.5,
                  borderColor: tc.success,
                  backgroundColor: `${tc.success}18`,
                },
              ]}
            >
              <Text style={[styles.actionDoneText, { color: tc.success }]}>
                {link.markDone.label}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.timerActionRow}>
        <Pressable
          onPress={() => runAction(model.primary.action)}
          disabled={isHydratingSession}
          style={[
            styles.actionPrimary,
            {
              opacity: isHydratingSession ? 0.5 : 1,
              backgroundColor: filledButton.backgroundColor,
              borderColor: filledButton.backgroundColor,
            },
          ]}
        >
          <Text style={[styles.actionPrimaryText, { color: filledButton.textColor ?? tc.onTint }]}>
            {model.primary.label}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => runAction(model.reset.action)}
          disabled={isHydratingSession}
          style={[styles.actionSecondary, { borderColor: tc.border, backgroundColor: tc.filterBg }]}
        >
          <Text style={[styles.actionSecondaryText, { color: tc.secondaryText }]}>
            {model.reset.label}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={model.switchPhase.label}
          onPress={() => runAction(model.switchPhase.action)}
          disabled={isHydratingSession}
          style={[styles.actionSecondary, { borderColor: tc.border, backgroundColor: tc.filterBg }]}
        >
          <Text style={[styles.actionSecondaryText, { color: tc.secondaryText }]}>
            {model.switchPhase.label}
          </Text>
        </Pressable>
      </View>

      {model.event && (
        <Text style={[styles.eventText, { color: tc.secondaryText }]}>
          {model.event}
        </Text>
      )}

      {link && (
        <Modal
          visible={isTaskPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsTaskPickerOpen(false)}
        >
          <View style={styles.modalRoot}>
            <Pressable style={styles.modalScrim} onPress={() => setIsTaskPickerOpen(false)} />
            <View style={[styles.taskPickerSheet, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
              <Text style={[styles.taskPickerSheetTitle, { color: tc.text }]}>{picker.title}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: picker.timerOnly.selected }}
                onPress={() => {
                  runAction(picker.timerOnly.action);
                  setIsTaskPickerOpen(false);
                }}
                style={[
                  styles.taskPickerOption,
                  {
                    borderColor: picker.timerOnly.selected ? tc.tint : tc.border,
                    backgroundColor: picker.timerOnly.selected ? `${tc.tint}18` : tc.filterBg,
                  },
                ]}
              >
                <Text style={[styles.taskPickerOptionText, { color: picker.timerOnly.selected ? tc.tint : tc.text }]}>
                  {picker.timerOnly.label}
                </Text>
              </Pressable>
              <FlatList
                data={tasks}
                renderItem={({ item: task }) => {
                  const selected = task.id === pomodoro.selectedTaskId;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        runAction({ type: 'selectTask', taskId: task.id });
                        setIsTaskPickerOpen(false);
                      }}
                      style={[
                        styles.taskPickerOption,
                        {
                          borderColor: selected ? tc.tint : tc.border,
                          backgroundColor: selected ? `${tc.tint}18` : tc.filterBg,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.taskPickerOptionText, { color: selected ? tc.tint : tc.text }]}
                        numberOfLines={2}
                      >
                        {task.title}
                      </Text>
                    </Pressable>
                  );
                }}
                keyExtractor={(task) => task.id}
                style={styles.taskPickerList}
                contentContainerStyle={styles.taskPickerListContent}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={5}
                updateCellsBatchingPeriod={50}
                removeClippedSubviews={false}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <Text style={[styles.noTaskText, { color: tc.secondaryText }]}>{picker.empty}</Text>
                }
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    gap: 8,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  collapsedCard: {
    paddingVertical: 10,
  },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  collapsedClock: {
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  collapsedRunningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  collapsedSpacer: {
    flex: 1,
  },
  collapseToggle: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },

  headerText: {
    flex: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '500',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  phaseStatus: {
    paddingTop: 2,
  },
  phaseStatusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  presetText: {
    fontSize: 11,
    fontWeight: '700',
  },
  timerBox: {
    alignItems: 'center',
    gap: 2,
  },
  timerText: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  sessionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  taskLinkRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  taskPickerButton: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taskPickerTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  taskPickerLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  taskPickerValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  taskPickerAction: {
    fontSize: 12,
    fontWeight: '700',
  },
  timerActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionPrimary: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  actionPrimaryText: {
    fontSize: 12,
    fontWeight: '700',
  },
  actionSecondary: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionSecondaryText: {
    fontSize: 12,
    fontWeight: '700',
  },
  actionDone: {
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionDoneText: {
    fontSize: 12,
    fontWeight: '700',
  },
  eventText: {
    fontSize: 12,
    fontWeight: '500',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00000099',
  },
  taskPickerSheet: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    maxHeight: '72%',
  },
  taskPickerSheetTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  taskPickerList: {
    maxHeight: 320,
  },
  taskPickerListContent: {
    gap: 8,
  },
  taskPickerOption: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  taskPickerOptionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  noTaskText: {
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 8,
  },
});
