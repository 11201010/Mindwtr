export interface CloudOptions {
    token?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    fetcher?: typeof fetch;
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

function isAllowedInsecureUrl(rawUrl: string): boolean {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:') return true;
        if (parsed.protocol !== 'http:') return false;
        const host = parsed.hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '10.0.2.2';
    } catch {
        return false;
    }
}

function assertSecureUrl(url: string) {
    if (!isAllowedInsecureUrl(url)) {
        throw new Error('Cloud sync requires HTTPS (except localhost).');
    }
}

async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    fetcher: typeof fetch,
): Promise<Response> {
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
        return await fetcher(url, { ...init, signal });
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
    assertSecureUrl(url);
    const fetcher = options.fetcher ?? fetch;
    const res = await fetchWithTimeout(
        url,
        {
            method: 'GET',
            headers: buildHeaders(options),
        },
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        fetcher,
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
    assertSecureUrl(url);
    const fetcher = options.fetcher ?? fetch;
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
        fetcher,
    );

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Cloud PUT failed (${res.status}): ${text || res.statusText}`);
    }
}
