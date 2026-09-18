import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ChevronLeft, MoreHorizontal, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

export type ListOverflowTheme = {
  border: string;
  cardBg: string;
  filterBg: string;
  secondaryText: string;
  text: string;
  tint: string;
};

type ListOverflowActionBase = {
  id: string;
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  icon?: (color: string) => React.ReactNode;
  selected?: boolean;
  testID?: string;
  value?: string;
};

export type ListOverflowLeafAction = ListOverflowActionBase & {
  onPress: () => void;
  submenu?: never;
};

export type ListOverflowSubmenu = {
  title: string;
  actions: readonly ListOverflowLeafAction[];
};

export type ListOverflowSubmenuAction = ListOverflowActionBase & {
  onPress?: never;
  submenu: ListOverflowSubmenu;
};

export type ListOverflowAction = ListOverflowLeafAction | ListOverflowSubmenuAction;

type ListOverflowMenuProps = {
  actions: readonly ListOverflowAction[];
  backLabel: string;
  closeLabel: string;
  moreLabel: string;
  themeColors: ListOverflowTheme;
  triggerStyle?: StyleProp<ViewStyle>;
  triggerTestID?: string;
};

export function ListOverflowMenu({
  actions,
  backLabel,
  closeLabel,
  moreLabel,
  themeColors,
  triggerStyle,
  triggerTestID,
}: ListOverflowMenuProps) {
  const [visible, setVisible] = useState(false);
  const [panel, setPanel] = useState<ListOverflowSubmenu | null>(null);
  const pendingActionRef = useRef<null | (() => void)>(null);
  const interactionTaskRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();

  const runPendingAction = useCallback(() => {
    const action = pendingActionRef.current;
    if (!action) return;
    pendingActionRef.current = null;
    interactionTaskRef.current = null;
    setPanel(null);
    action();
  }, []);

  useEffect(() => {
    return () => {
      interactionTaskRef.current?.cancel();
      pendingActionRef.current = null;
    };
  }, []);

  const close = () => {
    interactionTaskRef.current?.cancel();
    interactionTaskRef.current = null;
    pendingActionRef.current = null;
    setVisible(false);
    setPanel(null);
  };

  const closeThenRun = (action: () => void) => {
    pendingActionRef.current = action;
    setVisible(false);
    if (Platform.OS !== 'ios') {
      interactionTaskRef.current?.cancel();
      if (InteractionManager?.runAfterInteractions) {
        interactionTaskRef.current = InteractionManager.runAfterInteractions(runPendingAction);
      } else {
        runPendingAction();
      }
    }
  };

  const renderAction = (action: ListOverflowAction) => {
    const iconColor = action.selected ? themeColors.tint : themeColors.secondaryText;
    return (
      <TouchableOpacity
        key={action.id}
        accessibilityLabel={action.accessibilityLabel ?? action.label}
        accessibilityRole="button"
        accessibilityState={{ disabled: action.disabled, selected: action.selected }}
        disabled={action.disabled}
        onPress={() => {
          if (action.submenu) {
            setPanel(action.submenu);
            return;
          }
          closeThenRun(action.onPress);
        }}
        style={[
          styles.action,
          { borderBottomColor: themeColors.border },
          action.disabled ? styles.disabled : null,
        ]}
        testID={action.testID}
      >
        {action.icon ? (
          <View style={[styles.actionIcon, { backgroundColor: action.selected ? `${themeColors.tint}20` : themeColors.filterBg }]}>
            {action.icon(iconColor)}
          </View>
        ) : null}
        <Text style={[styles.actionLabel, { color: themeColors.text }]} numberOfLines={2}>
          {action.label}
        </Text>
        {action.value ? (
          <Text style={[styles.actionValue, { color: themeColors.secondaryText }]} numberOfLines={1}>
            {action.value}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  const title = panel?.title ?? moreLabel;

  return (
    <>
      <TouchableOpacity
        accessibilityLabel={moreLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded: visible }}
        hitSlop={8}
        onPress={() => {
          setPanel(null);
          setVisible(true);
        }}
        style={[
          styles.trigger,
          { backgroundColor: themeColors.filterBg, borderColor: themeColors.border },
          triggerStyle,
        ]}
        testID={triggerTestID}
      >
        <MoreHorizontal size={20} color={themeColors.secondaryText} strokeWidth={2} />
      </TouchableOpacity>

      <Modal
        accessibilityViewIsModal
        animationType={reducedMotion ? 'none' : 'fade'}
        onDismiss={runPendingAction}
        onRequestClose={() => {
          if (panel) {
            setPanel(null);
            return;
          }
          close();
        }}
        transparent
        visible={visible}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel={closeLabel}
            accessibilityRole="button"
            onPress={close}
            style={styles.backdrop}
          />
          <View
            style={[
              styles.card,
              {
                backgroundColor: themeColors.cardBg,
                borderColor: themeColors.border,
                paddingBottom: Math.max(12, insets.bottom + 8),
              },
            ]}
          >
            <View style={styles.header}>
              {panel ? (
                <TouchableOpacity
                  accessibilityLabel={backLabel}
                  accessibilityRole="button"
                  onPress={() => setPanel(null)}
                  style={styles.headerButton}
                >
                  <ChevronLeft size={22} color={themeColors.secondaryText} strokeWidth={2} />
                </TouchableOpacity>
              ) : null}
              <Text accessibilityRole="header" style={[styles.title, { color: themeColors.text }]} numberOfLines={2}>
                {title}
              </Text>
              <TouchableOpacity
                accessibilityLabel={closeLabel}
                accessibilityRole="button"
                onPress={close}
                style={styles.headerButton}
              >
                <X size={20} color={themeColors.secondaryText} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <View style={[styles.section, { borderColor: themeColors.border }]}>
                {(panel?.actions ?? actions).map(renderAction)}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    alignSelf: 'center',
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: '82%',
    maxWidth: 440,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingTop: 8,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    minHeight: 52,
  },
  headerButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    paddingHorizontal: 8,
  },
  content: {
    gap: 14,
    paddingBottom: 4,
  },
  section: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  action: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  disabled: {
    opacity: 0.45,
  },
  actionIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  actionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    minWidth: 0,
  },
  actionValue: {
    flexShrink: 1,
    fontSize: 13,
    maxWidth: '45%',
  },
});
