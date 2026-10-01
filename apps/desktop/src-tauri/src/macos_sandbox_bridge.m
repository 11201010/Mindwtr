#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <stdlib.h>
#include <string.h>

/// Create a security-scoped bookmark for the given file-system path.
/// Returns a heap-allocated base64-encoded C string on success, or NULL.
/// The caller must free the result with `mindwtr_macos_free_bookmark_string`.
char *mindwtr_macos_create_security_bookmark(const char *path_cstr) {
    if (!path_cstr) return NULL;

    NSString *pathString = [NSString stringWithUTF8String:path_cstr];
    NSURL *url = [NSURL fileURLWithPath:pathString isDirectory:YES];

    NSError *error = nil;
    NSData *bookmarkData =
        [url bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope
          includingResourceValuesForKeys:nil
                           relativeToURL:nil
                                   error:&error];
    if (!bookmarkData) {
        NSLog(@"[Mindwtr] Failed to create security bookmark for %@: %@",
              pathString, error);
        return NULL;
    }

    NSString *base64 = [bookmarkData base64EncodedStringWithOptions:0];
    const char *utf8 = [base64 UTF8String];
    if (!utf8) return NULL;

    return strdup(utf8);
}

/// Resolve a previously stored security-scoped bookmark (base64-encoded).
/// On success calls `startAccessingSecurityScopedResource` and returns the
/// resolved path as a heap-allocated C string.  Returns NULL on failure.
/// The caller must free the result with `mindwtr_macos_free_bookmark_string`.
char *mindwtr_macos_resolve_security_bookmark(const char *base64_cstr) {
    if (!base64_cstr) return NULL;

    NSString *base64String = [NSString stringWithUTF8String:base64_cstr];
    NSData *bookmarkData =
        [[NSData alloc] initWithBase64EncodedString:base64String options:0];
    if (!bookmarkData) {
        NSLog(@"[Mindwtr] Failed to decode bookmark base64 data");
        return NULL;
    }

    BOOL isStale = NO;
    NSError *error = nil;
    NSURL *resolvedURL =
        [NSURL URLByResolvingBookmarkData:bookmarkData
                                  options:NSURLBookmarkResolutionWithSecurityScope
                            relativeToURL:nil
                      bookmarkDataIsStale:&isStale
                                    error:&error];
    if (!resolvedURL) {
        NSLog(@"[Mindwtr] Failed to resolve security bookmark: %@", error);
        return NULL;
    }

    if (isStale) {
        NSLog(@"[Mindwtr] Security bookmark is stale — the app may need to "
              @"re-select the folder to refresh it");
    }

    BOOL started = [resolvedURL startAccessingSecurityScopedResource];
    if (!started) {
        NSLog(@"[Mindwtr] startAccessingSecurityScopedResource failed for %@",
              resolvedURL);
    }

    const char *path = [[resolvedURL path] UTF8String];
    if (!path) return NULL;

    return strdup(path);
}

/// Open a bookmarked path with its default app (Finder for a folder). The
/// security scope lasts only for the hand-off to Launch Services; Finder
/// does not need it once the open request is accepted.
/// Returns 1 when opened, 0 when the bookmark is unusable or no longer
/// points at `expected_path_cstr` (the caller then takes its normal open
/// path), and -1 when the open itself failed.
int mindwtr_macos_open_security_bookmark(const char *base64_cstr,
                                         const char *expected_path_cstr) {
    if (!base64_cstr || !expected_path_cstr) return 0;

    NSData *bookmarkData = [[NSData alloc]
        initWithBase64EncodedString:[NSString stringWithUTF8String:base64_cstr]
                            options:0];
    if (!bookmarkData) return 0;

    BOOL isStale = NO;
    NSError *error = nil;
    NSURL *resolvedURL =
        [NSURL URLByResolvingBookmarkData:bookmarkData
                                  options:NSURLBookmarkResolutionWithSecurityScope
                            relativeToURL:nil
                      bookmarkDataIsStale:&isStale
                                    error:&error];
    if (!resolvedURL) {
        NSLog(@"[Mindwtr] Failed to resolve link folder bookmark: %@", error);
        return 0;
    }

    // The link may have been edited to another path since the bookmark was
    // made; the bookmark only vouches for the folder the user picked.
    NSString *expected = [[[NSURL
        fileURLWithPath:[NSString stringWithUTF8String:expected_path_cstr]]
        URLByStandardizingPath] path];
    NSString *resolved = [[resolvedURL URLByStandardizingPath] path];
    if (![expected isEqualToString:resolved]) return 0;

    BOOL started = [resolvedURL startAccessingSecurityScopedResource];
    __block BOOL opened = NO;
    void (^openBlock)(void) = ^{
        opened = [[NSWorkspace sharedWorkspace] openURL:resolvedURL];
    };
    if ([NSThread isMainThread]) {
        openBlock();
    } else {
        dispatch_sync(dispatch_get_main_queue(), openBlock);
    }
    if (started) [resolvedURL stopAccessingSecurityScopedResource];
    return opened ? 1 : -1;
}

/// Free a string returned by the bookmark helper functions.
void mindwtr_macos_free_bookmark_string(char *ptr) {
    free(ptr);
}
