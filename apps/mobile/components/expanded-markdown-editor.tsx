import React from 'react';
import {
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useThemeColors } from '@/hooks/use-theme-colors';

import { expandedMarkdownEditorStyles as styles } from './expanded-markdown-editor.styles';
import { MarkdownText } from './markdown-text';

type ExpandedMarkdownEditorProps = {
    isOpen: boolean;
    onClose: () => void;
    value: string;
    onChange: (value: string) => void;
    onCommit?: () => void;
    title: string;
    placeholder: string;
    t: (key: string) => string;
    initialMode?: 'edit' | 'preview';
    direction?: 'ltr' | 'rtl';
};

export function ExpandedMarkdownEditor({
    isOpen,
    onClose,
    value,
    onChange,
    onCommit,
    title,
    placeholder,
    t,
    initialMode = 'edit',
    direction,
}: ExpandedMarkdownEditorProps) {
    const tc = useThemeColors();
    const inputRef = React.useRef<TextInput | null>(null);
    const focusTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [mode, setMode] = React.useState<'edit' | 'preview'>(initialMode);
    const directionStyle = direction
        ? {
            writingDirection: direction,
            textAlign: direction === 'rtl' ? 'right' : 'left',
        }
        : undefined;

    React.useEffect(() => {
        if (!isOpen) return;
        setMode(initialMode);
    }, [initialMode, isOpen]);

    React.useEffect(() => {
        if (!isOpen || mode !== 'edit') return;
        focusTimerRef.current = setTimeout(() => {
            inputRef.current?.focus();
        }, 30);
        return () => {
            if (focusTimerRef.current) {
                clearTimeout(focusTimerRef.current);
                focusTimerRef.current = null;
            }
        };
    }, [isOpen, mode]);

    const handleClose = React.useCallback(() => {
        onCommit?.();
        onClose();
    }, [onClose, onCommit]);

    const handleToggleMode = React.useCallback(() => {
        setMode((prev) => {
            const next = prev === 'edit' ? 'preview' : 'edit';
            if (next === 'preview') {
                Keyboard.dismiss();
            }
            return next;
        });
    }, []);

    return (
        <Modal
            visible={isOpen}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={handleClose}
        >
            <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['top', 'bottom']}>
                <View style={[styles.header, { borderBottomColor: tc.border }]}>
                    <TouchableOpacity
                        onPress={handleClose}
                        style={[
                            styles.closeButton,
                            direction === 'rtl' ? { left: undefined, right: 16 } : null,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={t('markdown.collapse')}
                    >
                        <Ionicons name="close" size={24} color={tc.text} />
                    </TouchableOpacity>

                    <Text style={[styles.title, { color: tc.text }]} numberOfLines={1}>
                        {title}
                    </Text>

                    <TouchableOpacity
                        onPress={handleToggleMode}
                        style={[
                            styles.modeButton,
                            direction === 'rtl' ? { right: undefined, left: 16 } : null,
                            { backgroundColor: tc.cardBg, borderColor: tc.border },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={mode === 'edit' ? t('markdown.preview') : t('markdown.edit')}
                    >
                        <Text style={[styles.modeButtonText, { color: tc.tint }]}>
                            {mode === 'edit' ? t('markdown.preview') : t('markdown.edit')}
                        </Text>
                    </TouchableOpacity>
                </View>

                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={0}
                    style={styles.body}
                >
                    {mode === 'edit' ? (
                        <View style={styles.content}>
                            <TextInput
                                ref={inputRef}
                                style={[
                                    styles.editorInput,
                                    directionStyle,
                                    { color: tc.text, backgroundColor: tc.inputBg, borderColor: tc.border },
                                ]}
                                value={value}
                                onChangeText={onChange}
                                placeholder={placeholder}
                                placeholderTextColor={tc.secondaryText}
                                multiline
                                accessibilityLabel={title}
                                accessibilityHint={placeholder}
                            />
                        </View>
                    ) : (
                        <ScrollView
                            style={styles.previewScroll}
                            contentContainerStyle={styles.previewContent}
                            keyboardShouldPersistTaps="handled"
                        >
                            <View style={[styles.previewSurface, { backgroundColor: tc.filterBg, borderColor: tc.border }]}>
                                <MarkdownText markdown={value} tc={tc} direction={direction} />
                            </View>
                        </ScrollView>
                    )}
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Modal>
    );
}
