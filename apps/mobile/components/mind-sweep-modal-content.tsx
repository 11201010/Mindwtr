import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getMindSweepGroups, shallow, useTaskStore, type MindSweepScope } from '@mindwtr/core';
import { useLanguage } from '../contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { CompactText } from '@/components/compact-text';

const INTRO_STEP = -1;

type MindSweepModalContentProps = {
  onClose: () => void;
};

export function MindSweepModalContent({ onClose }: MindSweepModalContentProps) {
  const { t } = useLanguage();
  const tc = useThemeColors();
  const filledButton = useFilledButtonColors();
  const { addTask } = useTaskStore((state) => ({ addTask: state.addTask }), shallow);

  const [scope, setScope] = useState<MindSweepScope>('all');
  const [stepIndex, setStepIndex] = useState(INTRO_STEP);
  const [draft, setDraft] = useState('');
  const [capturedByGroup, setCapturedByGroup] = useState<Record<string, string[]>>({});
  const [addFailed, setAddFailed] = useState(false);

  const groups = getMindSweepGroups(scope);
  const isIntro = stepIndex === INTRO_STEP;
  const isSummary = stepIndex >= groups.length;
  const group = !isIntro && !isSummary ? groups[stepIndex] : null;
  const capturedCount = Object.values(capturedByGroup).reduce((sum, items) => sum + items.length, 0);

  const handleAdd = async () => {
    const title = draft.trim();
    if (!title || !group) return;
    try {
      // Count the item only once the store accepted it, so the summary never
      // claims more captures than exist. A rejected write keeps the draft and
      // says so, instead of failing silently.
      const result = await addTask(title, { status: 'inbox' });
      if (!result?.success) {
        setAddFailed(true);
        return;
      }
      setCapturedByGroup((current) => ({
        ...current,
        [group.id]: [...(current[group.id] ?? []), title],
      }));
      setDraft('');
      setAddFailed(false);
    } catch {
      // Keep the draft so the capture is not lost; the user can retry.
      setAddFailed(true);
    }
  };

  const scopeOptions: Array<{ value: MindSweepScope; label: string }> = [
    { value: 'all', label: t('mindSweep.scopeAll') },
    { value: 'personal', label: t('mindSweep.scopePersonal') },
    { value: 'work', label: t('mindSweep.scopeWork') },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: tc.text }]}>{t('mindSweep.title')}</Text>
          <TouchableOpacity
            testID="mind-sweep-close"
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('mindSweep.close')}
          >
            <Text style={[styles.closeLabel, { color: tc.tint }]}>{t('mindSweep.close')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {isIntro && (
            <>
              <Text style={[styles.bodyText, { color: tc.secondaryText }]}>{t('mindSweep.intro')}</Text>
              <Text style={[styles.sectionLabel, { color: tc.text }]}>{t('mindSweep.scopeLabel')}</Text>
              <View style={styles.scopeRow}>
                {scopeOptions.map((option) => {
                  const selected = scope === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      testID={`mind-sweep-scope-${option.value}`}
                      onPress={() => setScope(option.value)}
                      accessibilityRole="button"
                      style={[
                        styles.scopeButton,
                        { borderColor: tc.border },
                        selected && { backgroundColor: tc.tint, borderColor: tc.tint },
                      ]}
                    >
                      <CompactText
                        style={[styles.scopeButtonText, { color: selected ? tc.onTint : tc.text }]}
                        numberOfLines={2}
                      >
                        {option.label}
                      </CompactText>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                testID="mind-sweep-start"
                onPress={() => setStepIndex(0)}
                accessibilityRole="button"
                style={[styles.primaryButton, { backgroundColor: filledButton.backgroundColor }]}
              >
                <Text style={[styles.primaryButtonText, { color: filledButton.textColor ?? tc.onTint }]}>{t('mindSweep.start')}</Text>
              </TouchableOpacity>
            </>
          )}

          {group && (
            <>
              <View style={styles.groupHeader}>
                <Text testID="mind-sweep-group-title" style={[styles.groupTitle, { color: tc.text }]}>
                  {t(group.titleKey)}
                </Text>
                <Text style={[styles.progress, { color: tc.secondaryText }]}>
                  {t('mindSweep.progress')
                    .replace('{{current}}', String(stepIndex + 1))
                    .replace('{{total}}', String(groups.length))}
                </Text>
              </View>
              {group.promptKeys.map((promptKey) => (
                <Text key={promptKey} style={[styles.prompt, { color: tc.secondaryText }]}>
                  {'•'} {t(promptKey)}
                </Text>
              ))}
              <View style={styles.inputRow}>
                <TextInput
                  testID="mind-sweep-input"
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={() => void handleAdd()}
                  blurOnSubmit={false}
                  returnKeyType="done"
                  placeholder={t('mindSweep.inputPlaceholder')}
                  placeholderTextColor={tc.secondaryText}
                  style={[styles.input, { borderColor: tc.border, color: tc.text }]}
                />
                <TouchableOpacity
                  testID="mind-sweep-add"
                  onPress={() => void handleAdd()}
                  disabled={!draft.trim()}
                  accessibilityRole="button"
                  style={[styles.addButton, { backgroundColor: filledButton.backgroundColor, opacity: draft.trim() ? 1 : 0.5 }]}
                >
                  <Text style={[styles.primaryButtonText, { color: filledButton.textColor ?? tc.onTint }]}>{t('mindSweep.add')}</Text>
                </TouchableOpacity>
              </View>
              {addFailed && (
                <Text testID="mind-sweep-add-failed" style={[styles.addFailed, { color: tc.danger }]}>
                  {t('task.addFailed')}
                </Text>
              )}
              {(capturedByGroup[group.id]?.length ?? 0) > 0 && (
                <View style={styles.capturedBlock}>
                  <Text style={[styles.capturedLabel, { color: tc.secondaryText }]}>
                    {t('mindSweep.groupCaptured')}
                  </Text>
                  {capturedByGroup[group.id].map((item, index) => (
                    <Text testID="mind-sweep-captured-item" key={`${item}-${index}`} style={[styles.capturedItem, { color: tc.text }]} numberOfLines={1}>
                      {'•'} {item}
                    </Text>
                  ))}
                </View>
              )}
              <View style={styles.navRow}>
                <TouchableOpacity
                  testID="mind-sweep-back"
                  onPress={() => setStepIndex((index) => index - 1)}
                  disabled={stepIndex === 0}
                  accessibilityRole="button"
                  style={[styles.secondaryButton, { borderColor: tc.border, opacity: stepIndex === 0 ? 0.5 : 1 }]}
                >
                  <Text style={[styles.secondaryButtonText, { color: tc.text }]}>{t('mindSweep.back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="mind-sweep-next"
                  onPress={() => setStepIndex((index) => index + 1)}
                  accessibilityRole="button"
                  style={[styles.primaryButtonInline, { backgroundColor: filledButton.backgroundColor }]}
                >
                  <Text style={[styles.primaryButtonText, { color: filledButton.textColor ?? tc.onTint }]}>{t('mindSweep.next')}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {isSummary && (
            <View testID="mind-sweep-summary">
              <Text style={[styles.groupTitle, { color: tc.text }]}>{t('mindSweep.summaryTitle')}</Text>
              <Text style={[styles.bodyText, { color: tc.secondaryText }]}>
                {capturedCount > 0
                  ? t('mindSweep.summaryCount').replace('{{count}}', String(capturedCount))
                  : t('mindSweep.summaryEmpty')}
              </Text>
              {capturedCount > 0 && (
                <Text style={[styles.bodyText, { color: tc.secondaryText }]}>{t('mindSweep.summaryHint')}</Text>
              )}
              <TouchableOpacity
                testID="mind-sweep-finish"
                onPress={onClose}
                accessibilityRole="button"
                style={[styles.primaryButton, { backgroundColor: filledButton.backgroundColor }]}
              >
                <Text style={[styles.primaryButtonText, { color: filledButton.textColor ?? tc.onTint }]}>{t('mindSweep.finish')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  closeLabel: { fontSize: 15, fontWeight: '600' },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  bodyText: { fontSize: 15, lineHeight: 21 },
  sectionLabel: { fontSize: 15, fontWeight: '600', marginTop: 8 },
  scopeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scopeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  scopeButtonText: { fontSize: 14, fontWeight: '600', lineHeight: 18, textAlign: 'center' },
  primaryButton: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonInline: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: { fontSize: 15, fontWeight: '700' },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  groupTitle: { fontSize: 17, fontWeight: '700' },
  progress: { fontSize: 12 },
  prompt: { fontSize: 14, lineHeight: 20 },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  addButton: {
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capturedBlock: { marginTop: 8, gap: 2 },
  addFailed: { fontSize: 13, marginTop: 8 },
  capturedLabel: { fontSize: 12 },
  capturedItem: { fontSize: 14 },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  secondaryButtonText: { fontSize: 15, fontWeight: '600' },
});
