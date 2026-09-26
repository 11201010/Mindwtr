import { Modal, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { canSaveTaskListTag, getTaskListAddTagDialogText } from '@mindwtr/core';

import { styles } from './task-list.styles';

type ThemeColors = {
  border: string;
  cardBg: string;
  inputBg: string;
  secondaryText: string;
  text: string;
  tint: string;
};

type TaskListTagModalProps = {
  onChangeTag: (value: string) => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  t: (key: string) => string;
  tagInput: string;
  themeColors: ThemeColors;
  visible: boolean;
};

export function TaskListTagModal({
  onChangeTag,
  onClose,
  onSave,
  t,
  tagInput,
  themeColors,
  visible,
}: TaskListTagModalProps) {
  const text = getTaskListAddTagDialogText(t);
  const canSave = canSaveTaskListTag(tagInput);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable
          style={[styles.modalCard, { backgroundColor: themeColors.cardBg }]}
          onPress={(event) => event.stopPropagation()}
        >
          <Text style={[styles.modalTitle, { color: themeColors.text }]}>{text.title}</Text>
          <TextInput
            value={tagInput}
            onChangeText={onChangeTag}
            placeholder={text.placeholder}
            placeholderTextColor={themeColors.secondaryText}
            style={[
              styles.modalInput,
              { backgroundColor: themeColors.inputBg, color: themeColors.text, borderColor: themeColors.border },
            ]}
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity onPress={onClose} style={styles.modalButton}>
              <Text style={[styles.modalButtonText, { color: themeColors.secondaryText }]}>{text.cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onSave}
              disabled={!canSave}
              style={[styles.modalButton, !canSave && styles.modalButtonDisabled]}
            >
              <Text style={[styles.modalButtonText, { color: themeColors.tint }]}>{text.saveLabel}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
