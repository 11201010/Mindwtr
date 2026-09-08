#import <Foundation/Foundation.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

static NSNotificationName const MindwtrMacOSWidgetCaptureNotification =
    @"tech.dongdongbh.mindwtr.widget.quick-capture";
static id mindwtrMacOSWidgetCaptureObserver = nil;

typedef void (*MindwtrMacOSWidgetCaptureCallback)(void);

/// Installs one app-lifetime listener for the widget's payload-free capture
/// request. The App Group identifier is also the notification object, so a
/// same-named notification from unrelated software is not delivered by
/// accident. This is routing isolation, not authentication: a local process
/// can discover and reuse the identifier, which is safe because the request
/// carries no content and only opens a capture panel. Delivery is pinned to the
/// main queue because the Rust callback presents an AppKit panel.
bool mindwtr_macos_install_widget_capture_listener(
    const char *app_group_cstr,
    MindwtrMacOSWidgetCaptureCallback callback
) {
    if (!app_group_cstr || !callback) return false;

    NSString *groupId = [NSString stringWithUTF8String:app_group_cstr];
    if (!groupId) return false;

    NSDistributedNotificationCenter *center = [NSDistributedNotificationCenter defaultCenter];
    @synchronized(center) {
        if (mindwtrMacOSWidgetCaptureObserver) return true;

        mindwtrMacOSWidgetCaptureObserver = [center
            addObserverForName:MindwtrMacOSWidgetCaptureNotification
            object:groupId
            queue:[NSOperationQueue mainQueue]
            usingBlock:^(__unused NSNotification *notification) {
                callback();
            }];
    }

    return mindwtrMacOSWidgetCaptureObserver != nil;
}

/// Resolves the shared App Group container directory for `app_group_cstr`.
/// Returns a heap-allocated UTF-8 path string on success, or NULL when the
/// container is unavailable -- an unsigned dev build, a build missing the
/// `com.apple.security.application-groups` entitlement, or an app group the
/// OS has not (yet) provisioned. Callers must treat NULL as "skip, don't
/// error" (#1054 decision 4), never as a hard failure.
/// The caller must free a non-NULL result with `mindwtr_macos_widget_free_string`.
char *mindwtr_macos_widget_container_path(const char *app_group_cstr) {
    if (!app_group_cstr) return NULL;

    NSString *groupId = [NSString stringWithUTF8String:app_group_cstr];
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSURL *containerURL = [fileManager containerURLForSecurityApplicationGroupIdentifier:groupId];
    if (!containerURL) return NULL;

    const char *path = [[containerURL path] UTF8String];
    if (!path) return NULL;

    return strdup(path);
}

/// Free a string returned by `mindwtr_macos_widget_container_path`.
void mindwtr_macos_widget_free_string(char *ptr) {
    free(ptr);
}
