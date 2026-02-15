import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Task } from '@mindwtr/core';
import {
  createPomodoroState,
  DEFAULT_POMODORO_DURATIONS,
  formatPomodoroClock,
  POMODORO_PRESETS,
  type PomodoroDurations,
  resetPomodoroState,
  tickPomodoroState,
} from '@mindwtr/core';

import { useLanguage } from '../contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';

type PomodoroEvent = 'focus-finished' | 'break-finished' | null;

export function PomodoroPanel({
  tasks,
  onMarkDone,
}: {
  tasks: Task[];
  onMarkDone: (taskId: string) => void;
}) {
  const { t } = useLanguage();
  const tc = useThemeColors();
  const [durations, setDurations] = useState<PomodoroDurations>(DEFAULT_POMODORO_DURATIONS);
  const [timerState, setTimerState] = useState(() => createPomodoroState(DEFAULT_POMODORO_DURATIONS));
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [lastEvent, setLastEvent] = useState<PomodoroEvent>(null);

  useEffect(() => {
    if (tasks.length === 0) {
      setSelectedTaskId(undefined);
      return;
    }
    if (selectedTaskId && tasks.some((task) => task.id === selectedTaskId)) return;
    setSelectedTaskId(tasks[0].id);
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (!timerState.isRunning) return;
    const interval = setInterval(() => {
      setTimerState((prev) => {
        const next = tickPomodoroState(prev, durations);
        if (next.switchedPhase) {
          setLastEvent(next.completedFocusSession ? 'focus-finished' : 'break-finished');
        }
        return next.state;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [durations, timerState.isRunning]);

  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) : undefined),
    [selectedTaskId, tasks]
  );

  const cardTitleRaw = t('pomodoro.title');
  const cardTitle = cardTitleRaw.startsWith('pomodoro.') ? 'Pomodoro Focus' : cardTitleRaw;
  const subtitleRaw = t('pomodoro.subtitle');
  const subtitle = subtitleRaw.startsWith('pomodoro.') ? 'Work one task at a time.' : subtitleRaw;
  const focusDoneRaw = t('pomodoro.focusComplete');
  const focusDoneLabel = focusDoneRaw.startsWith('pomodoro.') ? 'Focus session complete. Take a short break.' : focusDoneRaw;
  const breakDoneRaw = t('pomodoro.breakComplete');
  const breakDoneLabel = breakDoneRaw.startsWith('pomodoro.') ? 'Break complete. Ready for the next focus session.' : breakDoneRaw;
  const phaseRaw = timerState.phase === 'focus' ? t('pomodoro.phaseFocus') : t('pomodoro.phaseBreak');
  const phaseLabel = phaseRaw.startsWith('pomodoro.') ? (timerState.phase === 'focus' ? 'Focus session' : 'Break') : phaseRaw;
  const noTaskRaw = t('pomodoro.noTask');
  const noTaskLabel = noTaskRaw.startsWith('pomodoro.') ? 'No available focus task' : noTaskRaw;

  const handleApplyPreset = (focusMinutes: number, breakMinutes: number) => {
    const nextDurations = { focusMinutes, breakMinutes };
    setDurations(nextDurations);
    setTimerState((prev) => resetPomodoroState(prev, nextDurations, prev.phase));
    setLastEvent(null);
  };

  const handleToggleRun = () => {
    setTimerState((prev) => ({ ...prev, isRunning: !prev.isRunning }));
  };

  const handleReset = () => {
    setTimerState((prev) => resetPomodoroState(prev, durations, prev.phase));
    setLastEvent(null);
  };

  const handleSwitchPhase = () => {
    setTimerState((prev) => resetPomodoroState(prev, durations, prev.phase === 'focus' ? 'break' : 'focus'));
    setLastEvent(null);
  };

  const handleMarkDone = () => {
    if (!selectedTask) return;
    onMarkDone(selectedTask.id);
    setLastEvent(null);
  };

  return (
    <View style={[styles.card, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: tc.text }]}>{cardTitle}</Text>
          <Text style={[styles.subtitle, { color: tc.secondaryText }]}>{subtitle}</Text>
        </View>
        <View
          style={[
            styles.phaseBadge,
            timerState.phase === 'focus'
              ? { backgroundColor: '#2563EB20', borderColor: '#2563EB', }
              : { backgroundColor: '#05966920', borderColor: '#059669', },
          ]}
        >
          <Text style={[styles.phaseBadgeText, { color: timerState.phase === 'focus' ? '#2563EB' : '#059669' }]}>
            {phaseLabel}
          </Text>
        </View>
      </View>

      <View style={styles.presetRow}>
        {POMODORO_PRESETS.map((preset) => {
          const active = durations.focusMinutes === preset.focusMinutes && durations.breakMinutes === preset.breakMinutes;
          return (
            <Pressable
              key={preset.id}
              onPress={() => handleApplyPreset(preset.focusMinutes, preset.breakMinutes)}
              style={[
                styles.presetChip,
                {
                  borderColor: active ? tc.tint : tc.border,
                  backgroundColor: active ? tc.tint : tc.filterBg,
                },
              ]}
            >
              <Text style={[styles.presetText, { color: active ? tc.onTint : tc.secondaryText }]}>{preset.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.timerBox}>
        <Text style={[styles.timerText, { color: tc.text }]}>{formatPomodoroClock(timerState.remainingSeconds)}</Text>
        <Text style={[styles.sessionText, { color: tc.secondaryText }]}>
          {(t('pomodoro.sessionsDone') === 'pomodoro.sessionsDone' ? 'Focus sessions completed' : t('pomodoro.sessionsDone'))}
          {`: ${timerState.completedFocusSessions}`}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.taskChipRow}>
        {tasks.length === 0 ? (
          <View style={[styles.emptyTaskChip, { borderColor: tc.border, backgroundColor: tc.filterBg }]}>
            <Text style={[styles.emptyTaskChipText, { color: tc.secondaryText }]}>{noTaskLabel}</Text>
          </View>
        ) : (
          tasks.map((task) => {
            const selected = task.id === selectedTaskId;
            return (
              <Pressable
                key={task.id}
                onPress={() => setSelectedTaskId(task.id)}
                style={[
                  styles.taskChip,
                  {
                    borderColor: selected ? tc.tint : tc.border,
                    backgroundColor: selected ? tc.tint : tc.filterBg,
                  },
                ]}
              >
                <Text
                  style={[styles.taskChipText, { color: selected ? tc.onTint : tc.text }]}
                  numberOfLines={1}
                >
                  {task.title}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <View style={styles.actionRow}>
        <Pressable
          onPress={handleToggleRun}
          disabled={!selectedTask}
          style={[
            styles.actionPrimary,
            {
              opacity: selectedTask ? 1 : 0.5,
              backgroundColor: tc.tint,
              borderColor: tc.tint,
            },
          ]}
        >
          <Text style={[styles.actionPrimaryText, { color: tc.onTint }]}>
            {timerState.isRunning
              ? (t('common.pause') === 'common.pause' ? 'Pause' : t('common.pause'))
              : (t('common.start') === 'common.start' ? 'Start' : t('common.start'))}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleReset}
          style={[styles.actionSecondary, { borderColor: tc.border, backgroundColor: tc.filterBg }]}
        >
          <Text style={[styles.actionSecondaryText, { color: tc.secondaryText }]}>
            {t('common.reset') === 'common.reset' ? 'Reset' : t('common.reset')}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleSwitchPhase}
          style={[styles.actionSecondary, { borderColor: tc.border, backgroundColor: tc.filterBg }]}
        >
          <Text style={[styles.actionSecondaryText, { color: tc.secondaryText }]}>
            {t('pomodoro.switchPhase') === 'pomodoro.switchPhase' ? 'Switch' : t('pomodoro.switchPhase')}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleMarkDone}
          disabled={!selectedTask}
          style={[
            styles.actionDone,
            {
              opacity: selectedTask ? 1 : 0.5,
              borderColor: '#059669',
              backgroundColor: '#059669',
            },
          ]}
        >
          <Text style={styles.actionDoneText}>
            {t('pomodoro.markTaskDone') === 'pomodoro.markTaskDone' ? 'Done' : t('pomodoro.markTaskDone')}
          </Text>
        </Pressable>
      </View>

      {lastEvent && (
        <Text style={[styles.eventText, { color: tc.secondaryText }]}>
          {lastEvent === 'focus-finished' ? focusDoneLabel : breakDoneLabel}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  phaseBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  phaseBadgeText: {
    fontSize: 11,
    fontWeight: '700',
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
    gap: 3,
  },
  timerText: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  sessionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  taskChipRow: {
    gap: 8,
    paddingRight: 12,
  },
  taskChip: {
    maxWidth: 220,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  taskChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyTaskChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  emptyTaskChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionPrimary: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionPrimaryText: {
    fontSize: 12,
    fontWeight: '700',
  },
  actionSecondary: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionSecondaryText: {
    fontSize: 12,
    fontWeight: '700',
  },
  actionDone: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionDoneText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  eventText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
