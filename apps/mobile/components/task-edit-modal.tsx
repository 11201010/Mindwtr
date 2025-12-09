import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Modal, StyleSheet, TouchableOpacity, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Task, TaskStatus, useTaskStore } from '@focus-gtd/core';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

interface TaskEditModalProps {
    visible: boolean;
    task: Task | null;
    onClose: () => void;
    onSave: (taskId: string, updates: Partial<Task>) => void;
}

const STATUS_OPTIONS: TaskStatus[] = ['inbox', 'todo', 'next', 'in-progress', 'waiting', 'someday', 'done', 'archived'];

export function TaskEditModal({ visible, task, onClose, onSave }: TaskEditModalProps) {
    const { tasks } = useTaskStore();
    const [editedTask, setEditedTask] = useState<Partial<Task>>({});
    const [showDatePicker, setShowDatePicker] = useState<'start' | 'due' | null>(null);

    // Compute most frequent tags from all tasks
    const suggestedTags = React.useMemo(() => {
        const counts = new Map<string, number>();
        tasks.forEach(t => {
            t.contexts?.forEach(ctx => {
                counts.set(ctx, (counts.get(ctx) || 0) + 1);
            });
        });

        const sorted = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1]) // Sort desc by count
            .map(([tag]) => tag);

        // Add default tags if we don't have enough history
        const defaults = ['@home', '@work', '@errands', '@computer', '@phone'];
        const unique = new Set([...sorted, ...defaults]);

        return Array.from(unique).slice(0, 8);
    }, [tasks]);

    useEffect(() => {
        if (task) {
            setEditedTask({ ...task });
        }
    }, [task]);

    if (!task) return null;

    const handleSave = () => {
        if (task.id) {
            onSave(task.id, editedTask);
            onClose();
        }
    };

    const handleQuickDone = () => {
        if (task.id) {
            onSave(task.id, { ...editedTask, status: 'done' });
            onClose();
        }
    };

    const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
        const currentMode = showDatePicker;
        if (Platform.OS === 'android') {
            setShowDatePicker(null);
        }

        if (selectedDate && currentMode) {
            if (currentMode === 'start') {
                setEditedTask(prev => ({ ...prev, startTime: selectedDate.toISOString() }));
            } else {
                setEditedTask(prev => ({ ...prev, dueDate: selectedDate.toISOString() }));
            }
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return 'Not set';
        return new Date(dateStr).toLocaleDateString();
    };

    const toggleContext = (tag: string) => {
        const current = editedTask.contexts || [];
        const exists = current.includes(tag);

        let newContexts;
        if (exists) {
            newContexts = current.filter(t => t !== tag);
        } else {
            newContexts = [...current, tag];
        }
        setEditedTask(prev => ({ ...prev, contexts: newContexts }));
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <SafeAreaView style={styles.container} edges={['top']}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={onClose}>
                        <Text style={styles.headerBtn}>Cancel</Text>
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Edit Task</Text>
                    <View style={styles.headerRight}>
                        {(editedTask.status === 'next' || editedTask.status === 'todo') && (
                            <TouchableOpacity
                                onPress={() => {
                                    onSave(task.id, { ...editedTask, status: 'in-progress' });
                                    onClose();
                                }}
                                style={styles.startBtn}
                            >
                                <Text style={styles.startBtnText}>▶ Start</Text>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={handleSave}>
                            <Text style={[styles.headerBtn, styles.saveBtn]}>Save</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={{ flex: 1 }}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
                >
                    <ScrollView style={styles.content}>
                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Title</Text>
                            <TextInput
                                style={styles.input}
                                value={editedTask.title}
                                onChangeText={(text) => setEditedTask(prev => ({ ...prev, title: text }))}
                            />
                        </View>

                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Description</Text>
                            <TextInput
                                style={[styles.input, styles.textArea]}
                                value={editedTask.description || ''}
                                onChangeText={(text) => setEditedTask(prev => ({ ...prev, description: text }))}
                                multiline
                            />
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.formGroup, styles.flex1]}>
                                <Text style={styles.label}>Start Date</Text>
                                <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker('start')}>
                                    <Text>{formatDate(editedTask.startTime)}</Text>
                                </TouchableOpacity>
                            </View>
                            <View style={[styles.formGroup, styles.flex1]}>
                                <Text style={styles.label}>Due Date</Text>
                                <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker('due')}>
                                    <Text>{formatDate(editedTask.dueDate)}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {showDatePicker && (
                            <DateTimePicker
                                value={new Date(
                                    (showDatePicker === 'start' ? editedTask.startTime : editedTask.dueDate) || Date.now()
                                )}
                                mode="date"
                                display="default"
                                onChange={onDateChange}
                            />
                        )}

                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Status</Text>
                            <View style={styles.statusContainer}>
                                {STATUS_OPTIONS.map(status => (
                                    <TouchableOpacity
                                        key={status}
                                        style={[
                                            styles.statusChip,
                                            editedTask.status === status && styles.statusChipActive
                                        ]}
                                        onPress={() => setEditedTask(prev => ({ ...prev, status }))}
                                    >
                                        <Text style={[
                                            styles.statusText,
                                            editedTask.status === status && styles.statusTextActive
                                        ]}>
                                            {status}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Contexts (comma separated)</Text>
                            <TextInput
                                style={styles.input}
                                value={editedTask.contexts?.join(', ')}
                                onChangeText={(text) => setEditedTask(prev => ({
                                    ...prev,
                                    contexts: text.split(',').map(t => t.trim()).filter(Boolean)
                                }))}
                                placeholder="@home, @work"
                                autoCapitalize="none"
                            />
                            <View style={styles.suggestionsContainer}>
                                <Text style={styles.suggestionLabel}>Quick Add:</Text>
                                <View style={styles.suggestionTags}>
                                    {suggestedTags.map(tag => {
                                        const isActive = editedTask.contexts?.includes(tag);
                                        return (
                                            <TouchableOpacity
                                                key={tag}
                                                style={[
                                                    styles.suggestionChip,
                                                    isActive && styles.suggestionChipActive
                                                ]}
                                                onPress={() => toggleContext(tag)}
                                            >
                                                <Text style={[
                                                    styles.suggestionText,
                                                    isActive && styles.suggestionTextActive
                                                ]}>{tag}</Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>
                        </View>

                        {/* Add extra padding at bottom for scrolling past keyboard */}
                        <View style={{ height: 100 }} />
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f2f2f7' },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e5e5',
        alignItems: 'center',
    },
    headerBtn: { fontSize: 17, color: '#007AFF' },
    saveBtn: { fontWeight: '600' },
    headerTitle: { fontSize: 17, fontWeight: '600' },
    content: { padding: 20 },
    formGroup: { marginBottom: 20 },
    label: { fontSize: 14, color: '#666', marginBottom: 8, textTransform: 'uppercase' },
    input: {
        backgroundColor: '#fff',
        padding: 12,
        borderRadius: 10,
        fontSize: 16,
        borderWidth: 1,
        borderColor: '#e5e5e5',
    },
    textArea: { minHeight: 100, textAlignVertical: 'top' },
    row: { flexDirection: 'row', gap: 12 },
    flex1: { flex: 1 },
    dateBtn: {
        backgroundColor: '#fff',
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e5e5e5',
    },
    statusContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statusChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: '#e5e5e5',
        borderRadius: 16,
    },
    statusChipActive: { backgroundColor: '#007AFF' },
    statusText: { fontSize: 14, color: '#333' },
    statusTextActive: { color: '#fff' },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    startBtn: { backgroundColor: '#34C759', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
    startBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    doneBtn: { backgroundColor: '#007AFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
    doneBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    suggestionsContainer: { marginTop: 12 },
    suggestionLabel: { fontSize: 12, color: '#888', marginBottom: 8 },
    suggestionTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    suggestionChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: '#e1e1e6',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#d1d1d6',
    },
    suggestionChipActive: {
        backgroundColor: '#e8f2ff',
        borderColor: '#007AFF',
    },
    suggestionText: {
        fontSize: 13,
        color: '#555',
    },
    suggestionTextActive: {
        color: '#007AFF',
        fontWeight: '500',
    },
});
