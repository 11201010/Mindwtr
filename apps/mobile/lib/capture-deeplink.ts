export type ShortcutCapturePayload = {
    title: string;
    note?: string;
    project?: string;
    tags: string[];
};

const trimOrUndefined = (value: string | null | undefined): string | undefined => {
    const trimmed = String(value ?? '').trim();
    return trimmed ? trimmed : undefined;
};

const normalizeRouteFromUrl = (url: URL): string => {
    // mindwtr://capture -> hostname "capture"
    // mindwtr:///capture -> pathname "/capture"
    const route = trimOrUndefined(url.hostname) ?? trimOrUndefined(url.pathname.replace(/^\/+/, '')) ?? '';
    return route.toLowerCase();
};

export function parseShortcutCaptureUrl(rawUrl: string): ShortcutCapturePayload | null {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return null;
    }

    if ((parsed.protocol || '').toLowerCase() !== 'mindwtr:') return null;
    if (normalizeRouteFromUrl(parsed) !== 'capture') return null;

    const title = trimOrUndefined(parsed.searchParams.get('title')) ?? trimOrUndefined(parsed.searchParams.get('text'));
    if (!title) return null;

    const note =
        trimOrUndefined(parsed.searchParams.get('note')) ??
        trimOrUndefined(parsed.searchParams.get('description'));
    const project = trimOrUndefined(parsed.searchParams.get('project'));

    const tagsRaw = trimOrUndefined(parsed.searchParams.get('tags'));
    const tags = tagsRaw
        ? tagsRaw.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [];

    return {
        title,
        ...(note ? { note } : {}),
        ...(project ? { project } : {}),
        tags,
    };
}
