/**
 * Minimal, safe Markdown helpers.
 *
 * These are intentionally conservative and avoid HTML rendering.
 * Apps can use `stripMarkdown` for previews and notifications.
 */

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const INLINE_TOKEN_RE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;

export type InlineToken =
    | { type: 'text'; text: string }
    | { type: 'bold'; text: string }
    | { type: 'italic'; text: string }
    | { type: 'code'; text: string }
    | { type: 'link'; text: string; href: string };

const sanitizeLinkHref = (href: string): string | null => {
    const trimmed = href.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
        return null;
    }
    if (trimmed.startsWith('#')) {
        return trimmed;
    }
    try {
        const url = new URL(trimmed);
        if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
            return trimmed;
        }
    } catch {
        return null;
    }
    return null;
};

export function parseInlineMarkdown(text: string): InlineToken[] {
    const tokens: InlineToken[] = [];
    if (!text) return tokens;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = INLINE_TOKEN_RE.exec(text)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) });
        }

        const boldA = match[2];
        const boldB = match[3];
        const italicA = match[4];
        const italicB = match[5];
        const code = match[6];
        const linkText = match[7];
        const linkHref = match[8];

        if (code) {
            tokens.push({ type: 'code', text: code });
        } else if (boldA || boldB) {
            tokens.push({ type: 'bold', text: boldA || boldB });
        } else if (italicA || italicB) {
            tokens.push({ type: 'italic', text: italicA || italicB });
        } else if (linkText && linkHref) {
            const safeHref = sanitizeLinkHref(linkHref);
            if (safeHref) {
                tokens.push({ type: 'link', text: linkText, href: safeHref });
            } else {
                tokens.push({ type: 'text', text: linkText });
            }
        }

        lastIndex = INLINE_TOKEN_RE.lastIndex;
    }

    if (lastIndex < text.length) {
        tokens.push({ type: 'text', text: text.slice(lastIndex) });
    }

    return tokens;
}

export function stripMarkdown(markdown: string): string {
    if (!markdown) return '';

    let text = markdown;

    // Remove fenced code blocks but keep their contents.
    text = text.replace(CODE_BLOCK_RE, (block) => block.replace(/```/g, ''));

    // Inline code.
    text = text.replace(INLINE_CODE_RE, '$1');

    // Links: keep label.
    text = text.replace(LINK_RE, '$1');

    // Remove block-level markers.
    text = text.replace(/^\s{0,3}>\s?/gm, '');
    text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    text = text.replace(/^\s{0,3}[-*+]\s+/gm, '');
    text = text.replace(/^\s{0,3}\d+\.\s+/gm, '');

    // Remove emphasis markers.
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    text = text.replace(/(\*|_)(.*?)\1/g, '$2');
    text = text.replace(/~~(.*?)~~/g, '$1');

    // Normalize whitespace.
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/[ \t]{2,}/g, ' ');

    return text.trim();
}
