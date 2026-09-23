/**
 * Host APIs the core expects that a plain ECMAScript engine does not have.
 *
 * This file is loaded BEFORE the core bundle. It is plain ES2020 so QuickJS can
 * run it as-is. Every polyfill counts its own use, so the experiment can report
 * which host APIs the core really touches (`__hostUse`).
 *
 * Rule from the repo: never construct TextEncoder/TextDecoder at module scope.
 * Only the classes are defined here; nothing is instantiated.
 */
(function installHostPolyfills(global) {
    var used = Object.create(null);
    var mark = function (name) { used[name] = (used[name] || 0) + 1; };
    global.__hostUse = used;

    var native = function () {
        var bridge = global.__mindwtrNative;
        if (!bridge) throw new Error('host bridge missing: globalThis.__mindwtrNative');
        return bridge;
    };

    // --- timers -------------------------------------------------------------
    // The engine has no event loop. Timers go in a table the host drains between
    // calls (`__pumpTimers`), so a debounced save still fires.
    var timers = new Map();
    var nextTimerId = 1;

    if (typeof global.setTimeout !== 'function') {
        global.setTimeout = function (fn, delay) {
            mark('setTimeout');
            var id = nextTimerId++;
            var args = Array.prototype.slice.call(arguments, 2);
            timers.set(id, { fn: fn, at: global.__nowMs() + (delay || 0), args: args, repeat: 0 });
            return id;
        };
        global.clearTimeout = function (id) { timers.delete(id); };
        global.setInterval = function (fn, delay) {
            mark('setInterval');
            var id = nextTimerId++;
            timers.set(id, { fn: fn, at: global.__nowMs() + (delay || 0), args: [], repeat: delay || 1 });
            return id;
        };
        global.clearInterval = function (id) { timers.delete(id); };
    }

    /** Runs every timer already due. Returns how many ran. */
    global.__pumpTimers = function () {
        var now = global.__nowMs();
        var ran = 0;
        var due = [];
        timers.forEach(function (timer, id) { if (timer.at <= now) due.push([id, timer]); });
        due.sort(function (a, b) { return a[1].at - b[1].at; });
        for (var i = 0; i < due.length; i += 1) {
            var id = due[i][0];
            var timer = due[i][1];
            if (timer.repeat > 0) timer.at = now + timer.repeat; else timers.delete(id);
            try { timer.fn.apply(null, timer.args); } catch (error) { global.__hostLog('timer error: ' + error); }
            ran += 1;
        }
        return ran;
    };

    /** Milliseconds until the next timer is due, or -1 when none is waiting. */
    global.__nextTimerDelay = function () {
        var soonest = -1;
        var now = global.__nowMs();
        timers.forEach(function (timer) {
            var wait = Math.max(0, timer.at - now);
            if (soonest < 0 || wait < soonest) soonest = wait;
        });
        return soonest;
    };

    // --- clock and logging --------------------------------------------------
    global.__nowMs = function () { return native().nowMs(); };
    global.__hostLog = function (line) { native().log(String(line)); };

    if (typeof global.performance !== 'object' || typeof global.performance.now !== 'function') {
        global.performance = { now: function () { mark('performance.now'); return global.__nowMs(); } };
    }

    // --- crypto -------------------------------------------------------------
    if (typeof global.crypto !== 'object' || !global.crypto) global.crypto = {};
    if (typeof global.crypto.getRandomValues !== 'function') {
        global.crypto.getRandomValues = function (array) {
            mark('crypto.getRandomValues');
            var bytes = JSON.parse(native().randomBytes(array.length));
            for (var i = 0; i < array.length; i += 1) array[i] = bytes[i];
            return array;
        };
    }
    if (typeof global.crypto.randomUUID !== 'function') {
        global.crypto.randomUUID = function () {
            mark('crypto.randomUUID');
            var bytes = new Uint8Array(16);
            global.crypto.getRandomValues(bytes);
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            var hex = '';
            for (var i = 0; i < 16; i += 1) hex += (bytes[i] + 0x100).toString(16).slice(1);
            return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-'
                + hex.slice(16, 20) + '-' + hex.slice(20);
        };
    }

    // --- text encoding ------------------------------------------------------
    if (typeof global.TextEncoder !== 'function') {
        global.TextEncoder = function TextEncoder() { };
        global.TextEncoder.prototype.encode = function (input) {
            mark('TextEncoder');
            var text = String(input == null ? '' : input);
            var bytes = [];
            for (var i = 0; i < text.length; i += 1) {
                var code = text.charCodeAt(i);
                if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
                    var low = text.charCodeAt(i + 1);
                    if (low >= 0xdc00 && low <= 0xdfff) {
                        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                        i += 1;
                    }
                }
                if (code < 0x80) bytes.push(code);
                else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
                else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
                else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            }
            return new Uint8Array(bytes);
        };
    }
    if (typeof global.TextDecoder !== 'function') {
        global.TextDecoder = function TextDecoder() { };
        global.TextDecoder.prototype.decode = function (input) {
            mark('TextDecoder');
            if (!input) return '';
            var bytes = input instanceof Uint8Array ? input : new Uint8Array(input.buffer || input);
            var out = '';
            for (var i = 0; i < bytes.length;) {
                var byte = bytes[i++];
                var code;
                if (byte < 0x80) code = byte;
                else if (byte < 0xe0) code = ((byte & 0x1f) << 6) | (bytes[i++] & 0x3f);
                else if (byte < 0xf0) code = ((byte & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
                else code = ((byte & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
                if (code > 0xffff) {
                    code -= 0x10000;
                    out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
                } else {
                    out += String.fromCharCode(code);
                }
            }
            return out;
        };
    }

    // --- structuredClone ----------------------------------------------------
    if (typeof global.structuredClone !== 'function') {
        global.structuredClone = function (value) {
            mark('structuredClone');
            var seen = new Map();
            var clone = function (input) {
                if (input === null || typeof input !== 'object') return input;
                if (seen.has(input)) return seen.get(input);
                if (input instanceof Date) return new Date(input.getTime());
                if (input instanceof Map) {
                    var map = new Map();
                    seen.set(input, map);
                    input.forEach(function (v, k) { map.set(clone(k), clone(v)); });
                    return map;
                }
                if (input instanceof Set) {
                    var set = new Set();
                    seen.set(input, set);
                    input.forEach(function (v) { set.add(clone(v)); });
                    return set;
                }
                if (Array.isArray(input)) {
                    var list = [];
                    seen.set(input, list);
                    for (var i = 0; i < input.length; i += 1) list.push(clone(input[i]));
                    return list;
                }
                if (ArrayBuffer.isView(input)) return input.slice();
                var copy = {};
                seen.set(input, copy);
                Object.keys(input).forEach(function (key) { copy[key] = clone(input[key]); });
                return copy;
            };
            return clone(value);
        };
    }

    // --- AbortController ----------------------------------------------------
    if (typeof global.AbortController !== 'function') {
        global.AbortController = function AbortController() {
            mark('AbortController');
            var listeners = [];
            this.signal = {
                aborted: false,
                reason: undefined,
                addEventListener: function (_type, fn) { listeners.push(fn); },
                removeEventListener: function (_type, fn) {
                    var at = listeners.indexOf(fn);
                    if (at >= 0) listeners.splice(at, 1);
                },
                throwIfAborted: function () { if (this.aborted) throw this.reason; },
            };
            var signal = this.signal;
            this.abort = function (reason) {
                if (signal.aborted) return;
                signal.aborted = true;
                signal.reason = reason || new Error('Aborted');
                listeners.slice().forEach(function (fn) { try { fn({ type: 'abort' }); } catch (e) { } });
            };
        };
    }

    // --- URL ----------------------------------------------------------------
    // Enough for the sync ports: scheme, host, port, path, query. Not a full
    // WHATWG URL parser; the report says so.
    if (typeof global.URL !== 'function') {
        var URL_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(?:([^@/]*)@)?([^:/?#]*)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/;
        global.URL = function URL(input, base) {
            mark('URL');
            var text = String(input);
            if (base && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) {
                var baseText = String(base).replace(/[?#].*$/, '');
                text = text.charAt(0) === '/'
                    ? baseText.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*).*$/, '$1') + text
                    : baseText.replace(/[^/]*$/, '') + text;
            }
            var parts = URL_RE.exec(text);
            if (!parts) throw new TypeError('Invalid URL: ' + input);
            this.protocol = parts[1] + ':';
            var credentials = (parts[2] || '').split(':');
            this.username = credentials[0] || '';
            this.password = credentials[1] || '';
            this.hostname = parts[3] || '';
            this.port = parts[4] || '';
            this.host = this.hostname + (this.port ? ':' + this.port : '');
            this.pathname = parts[5] || '/';
            this.search = parts[6] || '';
            this.hash = parts[7] || '';
            this.origin = this.protocol + '//' + this.host;
            this.searchParams = new global.URLSearchParams(this.search);
        };
        global.URL.prototype.toString = function () {
            var credentials = this.username ? this.username + (this.password ? ':' + this.password : '') + '@' : '';
            return this.protocol + '//' + credentials + this.host + this.pathname
                + (this.searchParams ? this.searchParams.toString() : this.search) + this.hash;
        };
        global.URL.prototype.toJSON = function () { return this.toString(); };
    }

    if (typeof global.URLSearchParams !== 'function') {
        global.URLSearchParams = function URLSearchParams(init) {
            var pairs = [];
            if (typeof init === 'string') {
                init.replace(/^\?/, '').split('&').forEach(function (pair) {
                    if (!pair) return;
                    var at = pair.indexOf('=');
                    pairs.push(at < 0
                        ? [decodeURIComponent(pair), '']
                        : [decodeURIComponent(pair.slice(0, at)), decodeURIComponent(pair.slice(at + 1))]);
                });
            } else if (init && typeof init === 'object') {
                Object.keys(init).forEach(function (key) { pairs.push([key, String(init[key])]); });
            }
            this._pairs = pairs;
        };
        global.URLSearchParams.prototype.get = function (key) {
            for (var i = 0; i < this._pairs.length; i += 1) if (this._pairs[i][0] === key) return this._pairs[i][1];
            return null;
        };
        global.URLSearchParams.prototype.has = function (key) { return this.get(key) !== null; };
        global.URLSearchParams.prototype.set = function (key, value) {
            for (var i = 0; i < this._pairs.length; i += 1) {
                if (this._pairs[i][0] === key) { this._pairs[i][1] = String(value); return; }
            }
            this._pairs.push([key, String(value)]);
        };
        global.URLSearchParams.prototype.append = function (key, value) { this._pairs.push([key, String(value)]); };
        global.URLSearchParams.prototype.delete = function (key) {
            this._pairs = this._pairs.filter(function (pair) { return pair[0] !== key; });
        };
        global.URLSearchParams.prototype.forEach = function (fn) {
            this._pairs.forEach(function (pair) { fn(pair[1], pair[0]); });
        };
        global.URLSearchParams.prototype.toString = function () {
            if (this._pairs.length === 0) return '';
            return '?' + this._pairs.map(function (pair) {
                return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]);
            }).join('&');
        };
    }

    // --- localStorage -------------------------------------------------------
    // In-memory only. The core stores the chosen language here; the experiment
    // never relies on it surviving a restart.
    if (typeof global.localStorage !== 'object' || !global.localStorage) {
        var store = Object.create(null);
        global.localStorage = {
            getItem: function (key) { mark('localStorage'); return key in store ? store[key] : null; },
            setItem: function (key, value) { mark('localStorage'); store[key] = String(value); },
            removeItem: function (key) { delete store[key]; },
            clear: function () { store = Object.create(null); },
        };
    }

    // --- Intl ---------------------------------------------------------------
    // QuickJS has no Intl at all, and `packages/core/src/task-utils.ts` builds
    // three Intl.Collator objects while the bundle is being evaluated, so the
    // bundle does not even load without this. It is a fallback, not ICU:
    // ordering of non-ASCII text can differ from a real ICU collator. The
    // report records that as a parity risk.
    if (typeof global.Intl !== 'object' || !global.Intl) {
        var WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        var MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        var pad2 = function (value) { return (value < 10 ? '0' : '') + value; };

        var Collator = function Collator(_locales, options) {
            mark('Intl.Collator');
            var numeric = !!(options && options.numeric);
            var base = !!(options && options.sensitivity === 'base');
            this.compare = function (a, b) {
                var left = String(a);
                var right = String(b);
                if (base) { left = left.toLowerCase(); right = right.toLowerCase(); }
                if (numeric) {
                    var leftParts = left.match(/(\d+|\D+)/g) || [];
                    var rightParts = right.match(/(\d+|\D+)/g) || [];
                    for (var i = 0; i < Math.min(leftParts.length, rightParts.length); i += 1) {
                        var lp = leftParts[i];
                        var rp = rightParts[i];
                        var bothNumbers = /^\d/.test(lp) && /^\d/.test(rp);
                        if (bothNumbers) {
                            var diff = Number(lp) - Number(rp);
                            if (diff !== 0) return diff < 0 ? -1 : 1;
                        } else if (lp !== rp) {
                            return lp < rp ? -1 : 1;
                        }
                    }
                    return leftParts.length - rightParts.length;
                }
                if (left === right) return 0;
                return left < right ? -1 : 1;
            };
        };
        Collator.prototype.resolvedOptions = function () { return { locale: 'en' }; };

        var DateTimeFormat = function DateTimeFormat(locales, options) {
            mark('Intl.DateTimeFormat');
            this._options = options || {};
            this._locale = (Array.isArray(locales) ? locales[0] : locales) || 'en';
        };
        DateTimeFormat.prototype.resolvedOptions = function () {
            return { locale: this._locale, timeZone: 'UTC', calendar: 'gregory', numberingSystem: 'latn' };
        };
        DateTimeFormat.prototype.formatToParts = function (date) {
            var value = date instanceof Date ? date : new Date(date);
            var parts = [];
            var options = this._options;
            if (options.weekday) {
                var weekday = WEEKDAY_LONG[value.getDay()];
                parts.push({ type: 'weekday', value: options.weekday === 'long' ? weekday : weekday.slice(0, options.weekday === 'narrow' ? 1 : 3) });
            }
            if (options.month) {
                var month = MONTH_LONG[value.getMonth()];
                parts.push({ type: 'month', value: options.month === 'long' ? month
                    : options.month === 'numeric' ? String(value.getMonth() + 1)
                    : options.month === '2-digit' ? pad2(value.getMonth() + 1) : month.slice(0, 3) });
            }
            if (options.day) parts.push({ type: 'day', value: options.day === '2-digit' ? pad2(value.getDate()) : String(value.getDate()) });
            if (options.year) parts.push({ type: 'year', value: String(value.getFullYear()) });
            if (options.hour) parts.push({ type: 'hour', value: pad2(value.getHours()) });
            if (options.minute) parts.push({ type: 'minute', value: pad2(value.getMinutes()) });
            if (options.second) parts.push({ type: 'second', value: pad2(value.getSeconds()) });
            if (parts.length === 0) parts.push({ type: 'literal', value: value.toISOString() });
            return parts;
        };
        DateTimeFormat.prototype.format = function (date) {
            return this.formatToParts(date).map(function (part) { return part.value; }).join(' ');
        };

        var NumberFormat = function NumberFormat(_locales, options) {
            mark('Intl.NumberFormat');
            this._min = (options && options.minimumFractionDigits) || 0;
            this._max = options && options.maximumFractionDigits != null ? options.maximumFractionDigits : Math.max(3, this._min);
        };
        NumberFormat.prototype.format = function (value) {
            var text = Number(value).toFixed(this._max);
            if (this._max > this._min) text = text.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
            return text;
        };
        NumberFormat.prototype.resolvedOptions = function () { return { locale: 'en' }; };

        var Locale = function Locale(tag) {
            mark('Intl.Locale');
            var text = String(tag || 'en');
            var pieces = text.split('-');
            this.baseName = text;
            this.language = pieces[0];
            this.region = pieces.length > 1 ? pieces[pieces.length - 1] : undefined;
            this.calendar = undefined;
        };
        Locale.prototype.toString = function () { return this.baseName; };
        Locale.prototype.maximize = function () { return this; };

        global.Intl = {
            Collator: Collator,
            DateTimeFormat: DateTimeFormat,
            NumberFormat: NumberFormat,
            Locale: Locale,
            RelativeTimeFormat: function () {
                mark('Intl.RelativeTimeFormat');
                this.format = function (value, unit) { return value + ' ' + unit; };
            },
            getCanonicalLocales: function (tags) { return Array.isArray(tags) ? tags.slice() : [tags]; },
        };
    }

    // --- queueMicrotask -----------------------------------------------------
    if (typeof global.queueMicrotask !== 'function') {
        global.queueMicrotask = function (fn) { Promise.resolve().then(fn); };
    }

    // --- console ------------------------------------------------------------
    if (typeof global.console !== 'object' || !global.console) {
        global.console = {};
    }
    var describe = function (value) {
        if (value instanceof Error) return value.name + ': ' + value.message + '\n' + (value.stack || '');
        if (value && typeof value === 'object') {
            try {
                return JSON.stringify(value, function (_key, inner) {
                    return inner instanceof Error ? inner.name + ': ' + inner.message : inner;
                });
            } catch (error) {
                return String(value);
            }
        }
        return String(value);
    };
    ['log', 'warn', 'error', 'info', 'debug'].forEach(function (level) {
        // QuickJS's built-in methods throw when no platform stdout is set.
        global.console[level] = function () {
            var parts = [];
            for (var i = 0; i < arguments.length; i += 1) parts.push(describe(arguments[i]));
            try { global.__hostLog(level + ': ' + parts.join(' ')); } catch (_error) { /* logging cannot fail a save */ }
        };
    });
}(globalThis));
