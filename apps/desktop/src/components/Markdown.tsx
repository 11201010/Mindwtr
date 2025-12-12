import React from 'react';

import { cn } from '../lib/utils';

function isSafeLink(href: string): boolean {
    try {
        const url = new URL(href);
        return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
    } catch {
        return false;
    }
}

function renderInline(text: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const tokenRe = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRe.exec(text)) !== null) {
        if (match.index > lastIndex) {
            nodes.push(text.slice(lastIndex, match.index));
        }

        const boldA = match[2];
        const boldB = match[3];
        const italicA = match[4];
        const italicB = match[5];
        const code = match[6];
        const linkText = match[7];
        const linkHref = match[8];

        if (code) {
            nodes.push(
                <code key={`code-${match.index}`} className="px-1 py-0.5 rounded bg-muted font-mono text-[0.9em]">
                    {code}
                </code>
            );
        } else if (boldA || boldB) {
            nodes.push(<strong key={`bold-${match.index}`}>{boldA || boldB}</strong>);
        } else if (italicA || italicB) {
            nodes.push(<em key={`italic-${match.index}`}>{italicA || italicB}</em>);
        } else if (linkText && linkHref) {
            if (isSafeLink(linkHref)) {
                nodes.push(
                    <a
                        key={`link-${match.index}`}
                        href={linkHref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-2 hover:opacity-90"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {linkText}
                    </a>
                );
            } else {
                nodes.push(linkText);
            }
        }

        lastIndex = tokenRe.lastIndex;
    }

    if (lastIndex < text.length) {
        nodes.push(text.slice(lastIndex));
    }

    return nodes;
}

export function Markdown({ markdown, className }: { markdown: string; className?: string }) {
    const source = (markdown || '').replace(/\r\n/g, '\n');
    const lines = source.split('\n');
    const blocks: React.ReactNode[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
            i += 1;
            continue;
        }

        if (line.trim().startsWith('```')) {
            const start = i + 1;
            let end = start;
            while (end < lines.length && !lines[end].trim().startsWith('```')) end += 1;
            const code = lines.slice(start, end).join('\n');
            blocks.push(
                <pre key={`codeblock-${i}`} className="rounded bg-muted p-3 overflow-x-auto text-xs">
                    <code className="font-mono">{code}</code>
                </pre>
            );
            i = Math.min(end + 1, lines.length);
            continue;
        }

        const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
        if (headingMatch) {
            const level = headingMatch[1].length;
            const text = headingMatch[2];
            const HeadingTag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
            blocks.push(
                <HeadingTag key={`h-${i}`} className={cn('font-semibold', level === 1 ? 'text-base' : 'text-sm')}>
                    {renderInline(text)}
                </HeadingTag>
            );
            i += 1;
            continue;
        }

        const listMatch = /^[-*]\s+(.+)$/.exec(line);
        if (listMatch) {
            const items: string[] = [];
            while (i < lines.length) {
                const m = /^[-*]\s+(.+)$/.exec(lines[i]);
                if (!m) break;
                items.push(m[1]);
                i += 1;
            }
            blocks.push(
                <ul key={`ul-${i}`} className="list-disc pl-5 space-y-1">
                    {items.map((item, idx) => (
                        <li key={idx}>{renderInline(item)}</li>
                    ))}
                </ul>
            );
            continue;
        }

        const paragraph: string[] = [];
        while (i < lines.length && lines[i].trim()) {
            paragraph.push(lines[i]);
            i += 1;
        }
        const text = paragraph.join(' ').trim();
        if (text) {
            blocks.push(
                <p key={`p-${i}`} className="leading-relaxed">
                    {renderInline(text)}
                </p>
            );
        }
    }

    return <div className={cn('space-y-2 whitespace-pre-wrap break-words', className)}>{blocks}</div>;
}

