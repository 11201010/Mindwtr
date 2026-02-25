import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { TasksWidgetPayload } from '../lib/widget-data';

export function buildTasksWidgetTree(payload: TasksWidgetPayload) {
    const { headerTitle, subtitle, items, emptyMessage, captureLabel, focusUri, quickCaptureUri, palette } = payload;
    const contentChildren: React.ReactElement[] = [
        React.createElement(TextWidget, {
            key: 'header',
            text: headerTitle,
            style: { color: palette.text, fontSize: 13, fontWeight: '600' },
            maxLines: 1,
            truncate: 'END',
            clickAction: 'OPEN_URI',
            clickActionData: { uri: focusUri },
        }),
        React.createElement(TextWidget, {
            key: 'subtitle',
            text: subtitle,
            style: { color: palette.mutedText, fontSize: 10, marginTop: 2 },
            clickAction: 'OPEN_URI',
            clickActionData: { uri: focusUri },
        }),
    ];

    if (items.length > 0) {
        items.forEach((item, index) => {
            contentChildren.push(
                React.createElement(TextWidget, {
                    key: `item-${item.id}`,
                    text: `• ${item.title}`,
                    style: {
                        color: palette.text,
                        fontSize: 11,
                        marginTop: index === 0 ? 7 : 4,
                    },
                    maxLines: 1,
                    truncate: 'END',
                    clickAction: 'OPEN_URI',
                    clickActionData: { uri: focusUri },
                })
            );
        });
    } else {
        contentChildren.push(
            React.createElement(TextWidget, {
                key: 'empty',
                text: emptyMessage,
                style: {
                    color: palette.mutedText,
                    fontSize: 11,
                    marginTop: 7,
                },
                clickAction: 'OPEN_URI',
                clickActionData: { uri: focusUri },
            })
        );
    }

    return React.createElement(
        FlexWidget,
        {
            style: {
                width: 'match_parent',
                height: 'match_parent',
                padding: 12,
                backgroundColor: palette.background,
                justifyContent: 'space-between',
            },
        },
        React.createElement(
            FlexWidget,
            {
                key: 'content',
                style: {
                    width: 'match_parent',
                    flex: 1,
                },
            },
            ...contentChildren
        ),
        React.createElement(TextWidget, {
            key: 'capture-bottom',
            text: captureLabel,
            style: {
                color: palette.onAccent,
                fontSize: 11,
                fontWeight: '600',
                backgroundColor: palette.accent,
                paddingVertical: 5,
                paddingHorizontal: 9,
                marginTop: 8,
                borderRadius: 999,
                textAlign: 'center',
            },
            clickAction: 'OPEN_URI',
            clickActionData: { uri: quickCaptureUri },
        })
    );
}
