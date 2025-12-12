export interface CloudOptions {
    token?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
}

function buildHeaders(options: CloudOptions): Record<string, string> {
    const headers: Record<string, string> = { ...(options.headers || {}) };
    if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
    }
    return headers;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function isAbortError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && (error as any).name === 'AbortError';
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = abortController ? setTimeout(() => abortController.abort(), timeoutMs) : null;

    const signal = abortController ? abortController.signal : init.signal;
    const externalSignal = init.signal;
    if (abortController && externalSignal) {
        if (externalSignal.aborted) {
            abortController.abort();
        } else {
            externalSignal.addEventListener('abort', () => abortController.abort(), { once: true });
        }
    }

    try {
        return await fetch(url, { ...init, signal });
    } catch (error) {
        if (isAbortError(error)) {
            throw new Error('Cloud request timed out');
        }
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

export async function cloudGetJson<T>(
    url: string,
    options: CloudOptions = {},
): Promise<T | null> {
    const res = await fetchWithTimeout(
        url,
        {
            method: 'GET',
            headers: buildHeaders(options),
        },
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    if (res.status === 404) return null;
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Cloud GET failed (${res.status}): ${text || res.statusText}`);
    }

    const text = await res.text();
    return JSON.parse(text) as T;
}

export async function cloudPutJson(
    url: string,
    data: unknown,
    options: CloudOptions = {},
): Promise<void> {
    const headers = buildHeaders(options);
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';

    const res = await fetchWithTimeout(
        url,
        {
        method: 'PUT',
        headers,
        body: JSON.stringify(data, null, 2),
        },
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Cloud PUT failed (${res.status}): ${text || res.statusText}`);
    }
}
