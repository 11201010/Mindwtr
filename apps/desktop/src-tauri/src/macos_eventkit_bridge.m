#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>
#include <dispatch/dispatch.h>
#include <stdlib.h>
#include <string.h>

static NSString *mindwtr_permission_status_string(EKAuthorizationStatus status) {
    switch (status) {
        case EKAuthorizationStatusNotDetermined:
            return @"undetermined";
        case EKAuthorizationStatusRestricted:
        case EKAuthorizationStatusDenied:
            return @"denied";
#ifdef EKAuthorizationStatusFullAccess
        case EKAuthorizationStatusFullAccess:
            return @"granted";
#endif
#ifdef EKAuthorizationStatusWriteOnly
        case EKAuthorizationStatusWriteOnly:
            return @"denied";
#endif
        case EKAuthorizationStatusAuthorized:
            return @"granted";
        default:
            return @"denied";
    }
}

static char *mindwtr_copy_json(id object) {
    if (!object || ![NSJSONSerialization isValidJSONObject:object]) {
        return strdup("{\"error\":\"invalid-json\"}");
    }
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:&error];
    if (!data || error) {
        return strdup("{\"error\":\"json-encode-failed\"}");
    }
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!json) {
        return strdup("{\"error\":\"json-encode-failed\"}");
    }
    const char *utf8 = [json UTF8String];
    return utf8 ? strdup(utf8) : strdup("{\"error\":\"json-encode-failed\"}");
}

static NSDate *mindwtr_parse_iso_date(const char *raw) {
    if (!raw) return nil;
    NSString *text = [NSString stringWithUTF8String:raw];
    if (!text || [text length] == 0) return nil;

    NSISO8601DateFormatter *fractional = [[NSISO8601DateFormatter alloc] init];
    fractional.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
    NSDate *parsed = [fractional dateFromString:text];
    if (parsed) return parsed;

    NSISO8601DateFormatter *basic = [[NSISO8601DateFormatter alloc] init];
    basic.formatOptions = NSISO8601DateFormatWithInternetDateTime;
    return [basic dateFromString:text];
}

char *mindwtr_macos_calendar_permission_status_json(void) {
    @autoreleasepool {
        NSString *status = mindwtr_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        return mindwtr_copy_json(@{@"status": status ?: @"denied"});
    }
}

char *mindwtr_macos_calendar_request_permission_json(void) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        __block NSError *requestError = nil;
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

        if (@available(macOS 14.0, *)) {
            [store requestFullAccessToEventsWithCompletion:^(BOOL granted, NSError *_Nullable error) {
                requestError = error;
                dispatch_semaphore_signal(semaphore);
            }];
        } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            [store requestAccessToEntityType:EKEntityTypeEvent completion:^(BOOL granted, NSError *_Nullable error) {
                requestError = error;
                dispatch_semaphore_signal(semaphore);
            }];
#pragma clang diagnostic pop
        }

        dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(20 * NSEC_PER_SEC)));

        NSMutableDictionary *payload = [NSMutableDictionary dictionary];
        NSString *status = mindwtr_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        payload[@"status"] = status ?: @"denied";
        if (requestError) {
            payload[@"error"] = [requestError localizedDescription] ?: @"permission-request-failed";
        }
        return mindwtr_copy_json(payload);
    }
}

char *mindwtr_macos_calendar_events_json(const char *range_start, const char *range_end) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        NSString *permission = mindwtr_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        if (![permission isEqualToString:@"granted"]) {
            return mindwtr_copy_json(@{
                @"permission": permission ?: @"denied",
                @"calendars": @[],
                @"events": @[]
            });
        }

        NSDate *startDate = mindwtr_parse_iso_date(range_start);
        NSDate *endDate = mindwtr_parse_iso_date(range_end);
        if (!startDate || !endDate) {
            return mindwtr_copy_json(@{
                @"permission": permission ?: @"granted",
                @"calendars": @[],
                @"events": @[],
                @"error": @"invalid-range"
            });
        }

        NSArray<EKCalendar *> *allCalendars = [store calendarsForEntityType:EKEntityTypeEvent];
        NSMutableArray<EKCalendar *> *selectedCalendars = [NSMutableArray array];
        NSMutableArray<NSDictionary *> *calendarPayload = [NSMutableArray array];
        for (EKCalendar *calendar in allCalendars) {
            NSString *identifier = [calendar.calendarIdentifier stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!identifier || [identifier length] == 0) continue;
            [selectedCalendars addObject:calendar];

            NSString *title = [calendar.title stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!title || [title length] == 0) title = @"Calendar";
            NSString *encoded = [identifier stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet URLPathAllowedCharacterSet]];
            if (!encoded) encoded = identifier;
            [calendarPayload addObject:@{
                @"id": [@"system:" stringByAppendingString:identifier],
                @"name": title,
                @"url": [@"system://" stringByAppendingString:encoded],
                @"enabled": @YES
            }];
        }

        NSPredicate *predicate = [store predicateForEventsWithStartDate:startDate endDate:endDate calendars:selectedCalendars];
        NSArray<EKEvent *> *events = [store eventsMatchingPredicate:predicate];

        NSISO8601DateFormatter *iso = [[NSISO8601DateFormatter alloc] init];
        iso.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;

        NSMutableArray<NSDictionary *> *eventPayload = [NSMutableArray arrayWithCapacity:[events count]];
        for (EKEvent *event in events) {
            NSDate *start = event.startDate;
            if (!start) continue;
            NSDate *end = event.endDate;
            NSTimeInterval fallback = event.allDay ? 24 * 60 * 60 : 60 * 60;
            if (!end) end = [start dateByAddingTimeInterval:fallback];
            if ([end timeIntervalSinceDate:start] <= 0) end = [start dateByAddingTimeInterval:fallback];

            NSString *calendarId = [event.calendar.calendarIdentifier stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!calendarId || [calendarId length] == 0) continue;

            NSString *sourceId = [@"system:" stringByAppendingString:calendarId];
            NSString *eventId = [[event eventIdentifier] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!eventId || [eventId length] == 0) eventId = [[NSUUID UUID] UUIDString];
            NSString *startIso = [iso stringFromDate:start];
            NSString *title = [[event title] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!title || [title length] == 0) title = @"Event";

            NSMutableDictionary *item = [NSMutableDictionary dictionary];
            item[@"id"] = [NSString stringWithFormat:@"%@:%@:%@", sourceId, eventId, startIso];
            item[@"sourceId"] = sourceId;
            item[@"title"] = title;
            item[@"start"] = startIso;
            item[@"end"] = [iso stringFromDate:end];
            item[@"allDay"] = @(event.allDay);

            NSString *notes = [[event notes] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (notes && [notes length] > 0) item[@"description"] = notes;
            NSString *location = [[event location] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (location && [location length] > 0) item[@"location"] = location;

            [eventPayload addObject:item];
        }

        [eventPayload sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
            NSString *aStart = a[@"start"] ?: @"";
            NSString *bStart = b[@"start"] ?: @"";
            NSComparisonResult result = [aStart compare:bStart];
            if (result != NSOrderedSame) return result;
            NSString *aTitle = a[@"title"] ?: @"";
            NSString *bTitle = b[@"title"] ?: @"";
            return [aTitle compare:bTitle];
        }];

        return mindwtr_copy_json(@{
            @"permission": permission ?: @"granted",
            @"calendars": calendarPayload,
            @"events": eventPayload
        });
    }
}

void mindwtr_macos_calendar_free_string(char *value) {
    if (value) free(value);
}
