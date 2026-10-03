/** Validate external Markdown targets without normalizing or opening them. */
export function isSafeMarkdownExternalHref(href: string): boolean {
    return /^(?:https?:\/\/|mailto:|tel:|upnote:\/\/)/i.test(href);
}
