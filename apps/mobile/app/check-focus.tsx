import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    applyFocusChecklistEdit,
    buildFocusChecklistPageModel,
    generateUUID,
    useTaskStore,
    type FocusChecklistEdit,
    type Task,
} from '@mindwtr/core';
import { Check, Trash2, Plus } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../contexts/language-context';
import { useToast } from '../contexts/toast-context';
import { settleStoreAction } from '../components/store-action-result';
import { useThemeColors } from '../hooks/use-theme-colors';

export default function FocusChecklistPage() {
    const { id } = useLocalSearchParams();
    const taskId = Array.isArray(id) ? id[0] : id;
    const router = useRouter();
    const { t } = useLanguage();
    const tc = useThemeColors();
    const storeTask = useTaskStore(useCallback(
        (state) => state.tasks.find((candidate) => candidate.id === taskId),
        [taskId]
    ));
    const updateTask = useTaskStore((state) => state.updateTask);
    const [task, setTask] = useState(storeTask);
    // The store's task as of the latest render: a failed write shows it (not the list from before that edit, which a
    // later saved edit may have moved past).
    const latestStoreTask = useRef(storeTask);
    latestStoreTask.current = storeTask;
    const { showToast } = useToast();

    // Local state for immediate feedback
    const [checklist, setChecklist] = useState(task?.checklist || []);
    // The labels and each edit come from core, as the native host shows and applies them.
    const page = buildFocusChecklistPageModel({ task, checklist, t });

    const showChecklistError = (message?: string) => {
        showToast({
            title: page.error.title,
            message: message || page.error.fallbackMessage,
            tone: 'error',
            durationMs: 4200,
        });
    };

    useEffect(() => {
        if (storeTask) {
            setTask(storeTask);
            setChecklist(storeTask.checklist || []);
        }
    }, [storeTask]);

    // The list renders local state for immediate feedback, and the store→local
    // effect only fires when the store actually changes. So a rejected write
    // (which resolves `{ success: false }` rather than throwing) would otherwise
    // leave the edit on screen forever as if it had saved: show the store's list instead.
    const commitChecklist = (newList: NonNullable<Task['checklist']>) => {
        if (!task) return;
        setChecklist(newList);
        void settleStoreAction(() => updateTask(task.id, { checklist: newList }))
            .then((outcome) => {
                if (outcome.ok) return;
                setChecklist(latestStoreTask.current?.checklist || []);
                showChecklistError(outcome.message);
            });
    };

    const edit = (change: FocusChecklistEdit) => commitChecklist(applyFocusChecklistEdit(checklist, change));
    const handleToggle = (index: number) => edit({ kind: 'toggle', index });
    const handleAddItem = () => edit({ kind: 'add', id: generateUUID() });
    const handleUpdateItem = (index: number, text: string) => edit({ kind: 'rename', index, text });
    const handleDeleteItem = (index: number) => edit({ kind: 'remove', index });

    // The route has no navigation header: the missing-task state needs this Back too.
    const header = (
        <View style={[styles.header, { borderBottomColor: tc.border }]}>
            <TouchableOpacity
                onPress={() => router.back()}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel={page.backLabel}
                hitSlop={10}
            >
                <Ionicons name="chevron-back" color={tc.text} size={24} />
            </TouchableOpacity>
        </View>
    );

    if (!task) return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]}>
            {header}
            <Text style={[styles.missingText, { color: tc.text }]}>
                {page.missingText}
            </Text>
        </SafeAreaView>
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]}>
            {header}

            <View style={styles.titleContainer}>
                <Text style={[styles.taskTitle, { color: tc.text }]}>{task.title}</Text>
            </View>

            <ScrollView style={styles.content}>
                <View style={styles.checklistContainer}>
                    {page.emptyText && (
                        <Text style={[styles.emptyText, { color: tc.secondaryText }]}>
                            {page.emptyText}
                        </Text>
                    )}

                    {page.items.map((item, index) => (
                        <View key={item.id || index} style={[styles.itemRow, { borderBottomColor: tc.border }]}>
                            <TouchableOpacity
                                onPress={() => handleToggle(index)}
                                style={[
                                    styles.checkbox,
                                    { borderColor: tc.tint },
                                    item.isCompleted && { backgroundColor: tc.tint },
                                ]}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                activeOpacity={0.6}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: item.isCompleted }}
                                accessibilityLabel={item.checkboxLabel}
                            >
                                {item.isCompleted && <Check color={tc.onTint} size={18} />}
                            </TouchableOpacity>

                            <TextInput
                                style={[
                                    styles.input,
                                    { color: item.isCompleted ? tc.secondaryText : tc.text },
                                    item.isCompleted && styles.inputCompleted,
                                ]}
                                value={item.title}
                                onChangeText={(text) => handleUpdateItem(index, text)}
                                placeholder={item.placeholder}
                                placeholderTextColor={tc.secondaryText}
                                accessibilityLabel={item.inputLabel}
                                multiline
                            />

                            <TouchableOpacity
                                onPress={() => handleDeleteItem(index)}
                                style={styles.deleteBtn}
                                accessibilityRole="button"
                                accessibilityLabel={item.deleteLabel}
                            >
                                <Trash2 color={tc.secondaryText} size={20} />
                            </TouchableOpacity>
                        </View>
                    ))}

                    <TouchableOpacity
                        style={styles.addBtn}
                        onPress={handleAddItem}
                        accessibilityRole="button"
                        accessibilityLabel={page.addLabel}
                    >
                        <Plus color={tc.tint} size={20} />
                        <Text style={[styles.addBtnText, { color: tc.tint }]}>{page.addLabel}</Text>
                    </TouchableOpacity>
                </View>

                {/* Bottom spacer */}
                <View style={{ height: 100 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    missingText: {
        padding: 20,
        fontSize: 16,
    },
    header: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
    },
    backBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    titleContainer: {
        padding: 20,
        paddingBottom: 10,
    },
    taskTitle: {
        fontSize: 28,
        fontWeight: 'bold',
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
    },
    checklistContainer: {
        marginTop: 10,
    },
    emptyText: {
        fontStyle: 'italic',
        marginTop: 10,
    },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    checkbox: {
        width: 28,
        height: 28,
        borderRadius: 6,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    input: {
        flex: 1,
        fontSize: 18,
        paddingVertical: 0, // Fix alignment
    },
    inputCompleted: {
        textDecorationLine: 'line-through',
    },
    deleteBtn: {
        padding: 12,
    },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 20,
    },
    addBtnText: {
        fontSize: 16,
        fontWeight: '500',
    },
});
