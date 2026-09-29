import Foundation
import MindwtrNativeCore
import SwiftUI
import UIKit

typealias CoreObject = [String: Any]

extension Dictionary where Key == String, Value == Any {
    func text(_ key: String) -> String { self[key] as? String ?? "" }
    func object(_ key: String) -> CoreObject { self[key] as? CoreObject ?? [:] }
    func objects(_ key: String) -> [CoreObject] { self[key] as? [CoreObject] ?? [] }
    func flag(_ key: String) -> Bool { self[key] as? Bool ?? false }
    func number(_ key: String) -> Int { self[key] as? Int ?? 0 }
}

@MainActor
final class CoreModel: ObservableObject {
    enum Surface: Equatable { case inbox, focus, review, calendar, board, search, projects, project, waiting, someday, reference, history, trash, contexts }

    @Published private(set) var selectedSurface: Surface = .inbox
    @Published private(set) var inbox: CoreObject = [:]
    @Published private(set) var processInboxPresented = false
    @Published private(set) var processInboxView: CoreObject = [:]
    @Published private(set) var processInboxNotice: CoreObject = [:]
    @Published private(set) var processInboxToast = ""
    @Published private(set) var processInboxError: String?
    @Published private(set) var processInboxReadError: String?
    @Published private(set) var processInboxInputs: [String: String] = [:]
    @Published private(set) var mindSweepGuide: CoreObject = [:]
    @Published private(set) var mindSweepPresented = false
    @Published private(set) var mindSweepStep = -1
    @Published private(set) var mindSweepDraft = ""
    @Published private(set) var mindSweepCaptured: [String: [String]] = [:]
    @Published private(set) var mindSweepAddFailed = false
    @Published private(set) var mindSweepGuideError: String?
    @Published private(set) var focus: CoreObject = [:]
    @Published private(set) var focusShowDetails = false
    @Published private(set) var collapsedFocusSections: Set<String> = []
    @Published private(set) var focusCurrent = false
    @Published private(set) var focusLoading = false
    @Published private(set) var focusError: String?
    @Published private(set) var reviewOverview: CoreObject = [:]
    @Published private(set) var reviewGuide: CoreObject = [:]
    @Published private(set) var reviewKind = ""
    @Published private(set) var reviewCurrent = false
    @Published private(set) var reviewError: String?
    @Published private(set) var reviewPickerPresented = false
    @Published private(set) var reviewGuidePresented = false
    @Published private(set) var reviewNested: [String: CoreObject] = [:]
    @Published private(set) var reviewExpandedContexts: Set<String> = []
    @Published private(set) var reviewExpandedScheduled: Set<String> = []
    @Published private(set) var boardView: CoreObject = [:]
    @Published private(set) var boardCurrent = false
    @Published private(set) var boardLoading = false
    @Published private(set) var boardError: String?
    @Published private(set) var boardSearchText = ""
    @Published private(set) var boardFiltersPresented = false
    @Published private(set) var boardPickerQuery = ""
    @Published private(set) var boardScrollGeneration = 0
    var boardScrollAnchor = "board-top"
    @Published private(set) var calendarView: CoreObject = [:]
    @Published private(set) var calendarCurrent = false
    @Published private(set) var calendarError: String?
    @Published private(set) var calendarQuery = ""
    @Published private(set) var calendarItemSheet: CoreObject = [:]
    @Published private(set) var calendarItemPresented = false
    @Published private(set) var calendarItemError: String?
    @Published private(set) var calendarComposerView: CoreObject = [:]
    @Published private(set) var calendarComposerPresented = false
    @Published private(set) var calendarComposerError: String?
    @Published private(set) var calendarNotice: String?
    @Published var calendarComposerQueryInput = ""
    @Published var calendarComposerTitleInput = ""
    @Published var calendarComposerStartInput = ""
    @Published var calendarComposerEndInput = ""
    @Published private(set) var focusPanel = ""
    @Published private(set) var focusLocationText = ""
    @Published private(set) var focusPickerName = ""
    @Published private(set) var focusPickerQuery = ""
    @Published private(set) var focusPicker: CoreObject = [:]
    @Published private(set) var focusPickerCurrent = false
    @Published private(set) var searchView: CoreObject = [:]
    @Published private(set) var searchQuery = ""
    @Published private(set) var searchFilters: CoreObject = [:]
    @Published private(set) var searchLoading = false
    @Published private(set) var searchError: String?
    @Published private(set) var moreMenu: CoreObject = [:]
    @Published private(set) var morePresented = false
    @Published private(set) var projects: CoreObject = [:]
    @Published private(set) var selectedProjectTagFilter = "__all__"
    @Published private(set) var projectTagFilterShown = false
    @Published private(set) var projectCreateOptions: CoreObject = [:]
    @Published private(set) var projectCreateTitle = ""
    @Published private(set) var projectCreateAreaID: String?
    @Published private(set) var projectCreateError: String?
    @Published private(set) var projectCreateReadError: String?
    @Published private(set) var focusOrderPresented = false
    @Published private(set) var focusOrderShowHint = true
    @Published private(set) var focusOrderView: CoreObject = [:]
    @Published private(set) var focusOrderError: String?
    private var focusOrderCurrent = false
    private var focusOrderRequest: String?
    @Published private(set) var focusSavedFilterOperation: CoreObject = [:]
    @Published private(set) var focusSavedFilterDialog: CoreObject = [:]
    @Published var focusSavedFilterName = ""
    @Published private(set) var focusSavedFilterError: String?
    private var focusSavedFilterOptions: CoreObject = [:]
    private var focusSavedFilterRequest: String?
    @Published private(set) var focusGroupError: String?
    private var focusGroupRequest: String?
    private var focusGroupExpectedResult: CoreObject?
    @Published private(set) var taskFocusNotice: CoreObject = [:]
    private var taskFocusRequest: String?
    private var taskFocusExpectedID: String?
    private var taskFocusDesired: Bool?
    @Published private(set) var projectFocusError: String?
    @Published private(set) var projectFocusReadError: String?
    @Published private(set) var projectRenameEditing = false
    @Published private(set) var projectRenameTitle = ""
    @Published private(set) var projectRenameError: String?
    @Published private(set) var projectRenameReadError: String?
    @Published private(set) var projectFlowError: String?
    @Published private(set) var projectFlowReadError: String?
    @Published private(set) var projectTaskOrderPresented = false
    @Published private(set) var projectTaskOrderView: CoreObject = [:]
    @Published private(set) var projectTaskOrderError: String?
    private var projectTaskOrderRequest: String?
    private var projectTaskOrderCurrent = false
    @Published private(set) var projectTaskSortOptions: CoreObject = [:]
    @Published private(set) var projectTaskSortPresented = false
    @Published private(set) var projectTaskSortError: String?
    @Published private(set) var projectTaskSortReadError: String?
    @Published private(set) var projectStatusOpen = false
    @Published private(set) var projectStatusError: String?
    @Published private(set) var projectStatusReadError: String?
    @Published private(set) var projectDateField: String?
    @Published private(set) var projectDatePicker: CoreObject = [:]
    @Published private(set) var projectDateOpeningTimeZone: TimeZone?
    @Published private(set) var projectDateError: String?
    @Published private(set) var projectDateReadError: String?
    @Published private(set) var projectAreaPresented = false
    @Published private(set) var projectAreaOptions: CoreObject = [:]
    @Published private(set) var projectAreaError: String?
    @Published private(set) var projectAreaReadError: String?
    @Published private(set) var projectAreaCreatePresented = false
    @Published private(set) var projectAreaCreateName = ""
    @Published private(set) var projectAreaCreateColor = ""
    @Published private(set) var projectAreaCreateNameTaken = false
    @Published private(set) var projectAreaCreateNameChecking = false
    @Published private(set) var projectAreaCreateNameValid = false
    @Published private(set) var projectAreaCreatedID: String?
    @Published private(set) var projectTagsPresented = false
    @Published private(set) var projectTagsAddPresented = false
    @Published private(set) var projectTagsOptions: CoreObject = [:]
    @Published private(set) var projectTagsDraft = ""
    @Published private(set) var projectTagsError: String?
    @Published private(set) var projectTagsReadError: String?
    @Published private(set) var projectSectionsPresented = false
    @Published private(set) var projectSectionEditing = false
    @Published private(set) var projectSectionEditID: String?
    @Published private(set) var projectSectionTitle = ""
    @Published private(set) var projectSectionOptions: CoreObject = [:]
    @Published private(set) var projectSectionOrderOptions: CoreObject = [:]
    @Published private(set) var projectSectionError: String?
    @Published private(set) var projectSectionReadError: String?
    @Published private(set) var areaManagerPresented = false
    @Published private(set) var areaManagerProjectID: String?
    @Published private(set) var areaCreateOptions: CoreObject = [:]
    @Published private(set) var areaCreateName = ""
    @Published private(set) var areaCreateColor = ""
    @Published private(set) var areaCreateNameTaken = false
    @Published private(set) var areaCreateNameChecking = false
    @Published private(set) var areaCreateError: String?
    @Published private(set) var areaCreateReadError: String?
    @Published private(set) var areaColorOptions: CoreObject = [:]
    @Published private(set) var expandedAreaColorID: String?
    @Published private(set) var areaColorIntentID: String?
    @Published private(set) var areaColorIntentColor: String?
    @Published private(set) var areaColorError: String?
    @Published private(set) var areaColorReadError: String?
    @Published private(set) var areaOrderOptions: CoreObject = [:]
    @Published private(set) var areaOrderIntent: CoreObject?
    @Published private(set) var areaOrderError: String?
    @Published private(set) var areaOrderReadError: String?
    @Published private(set) var areaRenameEditingID: String?
    @Published private(set) var areaRenameOriginalName = ""
    @Published private(set) var areaRenameDraft = ""
    @Published private(set) var areaRenameError: String?
    @Published private(set) var areaRenameReadError: String?
    @Published private(set) var areaDeleteOptions: CoreObject = [:]
    @Published private(set) var areaDeleteIntentID: String?
    @Published private(set) var areaDeleteError: String?
    @Published private(set) var areaDeleteReadError: String?
    @Published private(set) var projectHeader: CoreObject = [:]
    @Published private(set) var projectDetail: CoreObject = [:]
    @Published private(set) var projectCurrent = false
    @Published private(set) var projectError: String?
    @Published private(set) var projectViewOptionsPresented = false
    @Published private(set) var projectFiltersPresented = false
    @Published private(set) var projectFilterSearchText = ""
    @Published private(set) var projectFilterLocationText = ""
    @Published private(set) var projectFilterPickerName = ""
    @Published private(set) var projectFilterPickerQuery = ""
    @Published private(set) var projectFilterPicker: CoreObject = [:]
    @Published private(set) var projectFilterPickerCurrent = false
    @Published private(set) var projectFilterError: String?
    @Published private(set) var projectFilterPickerError: String?
    private var projectFilterPickerDepth = 100
    private var projectFilterPublishedSheetOpen = false
    private var projectFilterPendingEdit: CoreObject?
    private var projectFilterTextEdits: [String: CoreObject] = [:]
    private var projectFilterNeedsRead = false
    private var projectFilterPickerNeedsRead = false
    private var projectFilterReadTask: Task<Void, Never>?
    private var projectFilterSession = 0
    private var projectShowCompleted = false
    private var projectCompletedCollapsed = true
    private var pendingProjectView: (showCompleted: Bool, collapsed: Bool)?
    private var projectShowCompletedPreference = "nativeFoundation.project.showCompleted"
    private var initialProjectShowCompleted = false
    private var focusShowDetailsPreference = "nativeFoundation.focus.showDetails"
    private var initialFocusShowDetails = false
    private var focusExpandedSectionsPreference = "nativeFoundation.focus.expandedSections"
    private var initialFocusExpandedSections: [String: Bool] = [:]
    private var referenceViewPreference = "nativeFoundation.reference.view"
    private var initialReferenceGroupBy: String?
    private var initialReferenceCollapsedGroups: [String: [String]] = [:]
    private var historyViewPreferences = ["done": "nativeFoundation.history.done.view",
                                          "archive": "nativeFoundation.history.archived.view"]
    private var initialHistoryViews: [String: CoreObject] = [:]
    private let focusSectionKeys = ["focus", "schedule", "next", "upcoming", "reviewDue", "reviewProjects"]
    @Published private(set) var projectNotes: CoreObject = [:]
    @Published private(set) var projectNotesExpanded = false
    @Published private(set) var projectNotesCurrent = false
    @Published private(set) var projectNotesError: String?
    @Published private(set) var projectNotesEditMode = false
    @Published private(set) var projectNotesDraft = ""
    @Published private(set) var projectNotesDraftDirection = ""
    @Published private(set) var projectNotesEditError: String?
    @Published private(set) var projectNotesEditReadError: String?
    @Published private(set) var projectNotesEditConflict = false
    @Published var collapsedProjectAreas: Set<String> = []
    @Published var expandedProjectSections: Set<String> = []
    @Published private(set) var contexts: CoreObject = [:]
    @Published private(set) var contextsSearchText = ""
    @Published private(set) var contextsCurrent = false
    @Published private(set) var contextsLoading = false
    @Published private(set) var contextsError: String?
    @Published private(set) var waiting: CoreObject = [:]
    @Published private(set) var waitingPerson = ""
    @Published private(set) var waitingCurrent = false
    @Published private(set) var waitingError: String?
    @Published var waitingProjectsExpanded = true
    @Published private(set) var someday: CoreObject = [:]
    @Published private(set) var somedayCurrent = false
    @Published private(set) var somedayError: String?
    @Published var somedayPanel = ""
    @Published var somedayProjectsExpanded = true
    @Published private(set) var somedaySearchText = ""
    @Published private(set) var somedayLocationText = ""
    @Published private(set) var somedayPickerName = ""
    @Published private(set) var somedayPickerQuery = ""
    @Published private(set) var somedayPicker: CoreObject = [:]
    @Published private(set) var somedayPickerCurrent = false
    @Published private(set) var somedayPickerError: String?
    @Published private(set) var reference: CoreObject = [:]
    @Published private(set) var referenceCurrent = false
    @Published private(set) var referenceError: String?
    @Published var referencePanel = ""
    @Published private(set) var referenceSortOptions: CoreObject = [:]
    @Published private(set) var referenceSortError: String?
    private var referenceSortRequest: String?
    private var referenceSortExpectedResult: CoreObject?
    @Published private(set) var referenceSearchText = ""
    @Published private(set) var referenceLocationText = ""
    @Published private(set) var referencePickerName = ""
    @Published private(set) var referencePickerQuery = ""
    @Published private(set) var referencePicker: CoreObject = [:]
    @Published private(set) var referencePickerCurrent = false
    @Published private(set) var referencePickerError: String?
    @Published private(set) var historyTabs: CoreObject = [:]
    @Published private(set) var history: CoreObject = [:]
    @Published private(set) var historyCurrent = false
    @Published private(set) var historyError: String?
    @Published private(set) var historyPanel = ""
    @Published private(set) var historySearchText = ""
    @Published private(set) var historyLocationText = ""
    @Published private(set) var historyPickerName = ""
    @Published private(set) var historyPickerQuery = ""
    @Published private(set) var historyPicker: CoreObject = [:]
    @Published private(set) var historyPickerCurrent = false
    @Published private(set) var historyPickerError: String?
    @Published private(set) var trash: CoreObject = [:]
    @Published private(set) var trashCurrent = false
    @Published private(set) var trashError: String?
    @Published private(set) var theme: CoreObject = [:]
    @Published private(set) var area: CoreObject = [:]
    @Published private(set) var strings: CoreObject = [:]
    @Published private(set) var capture: CoreObject = [:]
    @Published private(set) var ready = false
    @Published private(set) var busy = false
    @Published private(set) var retryNeeded = false
    @Published private(set) var error: String?
    @Published var capturePresented = false
    @Published private(set) var areaPickerPresented = false
    @Published private(set) var taskPresented = false
    private(set) var taskInitialTab = "view"
    @Published private(set) var taskView: CoreObject = [:]
    @Published private(set) var taskError: String?
    @Published private(set) var taskEditor: CoreObject = [:]
    @Published private(set) var taskDestination: CoreObject = [:]
    @Published private(set) var taskDestinationKind = ""
    @Published private(set) var taskDestinationQuery = ""
    @Published private(set) var taskDestinationCurrent = false
    @Published private(set) var taskDestinationError: String?
    @Published var taskTitleDraft = ""
    @Published var taskNoteDraft = ""
    @Published var taskEstimateInput = ""
    @Published private(set) var taskChecklist: [CoreObject] = []
    @Published private(set) var taskChecklistField: CoreObject = [:]
    @Published private(set) var taskChecklistInputs: [Int: String] = [:]
    @Published var taskChecklistAppendInput = ""
    @Published private(set) var taskChecklistFocusIndex: Int?
    @Published private(set) var taskScheduleUpdating = false
    @Published private(set) var taskSchedulePending = false
    @Published private(set) var taskRelativeAmountInput = ""
    @Published private(set) var taskRelativeUnitInput = ""
    @Published private(set) var taskRecurrenceInputs: [String: String] = [:]
    @Published private(set) var taskTokenInputs: [String: String] = [:]
    @Published private(set) var taskTokenSuggestions: [String: CoreObject] = [:]
    @Published private(set) var taskTokenErrors: [String: String] = [:]
    @Published var draft = ""
    @Published var noteDraft = ""
    @Published var contextQuery = ""
    @Published private(set) var contextPickerPresented = false
    @Published private(set) var notice: String?
    @Published var bulkConfirm: CoreObject = [:]

    private var host: CoreHost?
    private var reviewOverviewParams: CoreObject = ["scope": "due"]
    private var reviewOverviewDepth = 50
    private var reviewGuideDepth = 50
    private var reviewNestedDepth: [String: Int] = [:]
    private var reviewCheckpointInput: String?
    private var reviewExpandedProject: String?
    private var reviewFinishPending = false
    private let reviewPreferencePrefix = "nativeFoundation.review."
    private var preferenceDefaults: UserDefaults = .standard
    private var boardFilters: CoreObject = [:]
    private var boardPendingEdit: CoreObject?
    @Published private var boardActionRequest: String?
    private var boardRecoveredResult: CoreObject?
    private var boardDepth: [String: Int] = [:]
    private var boardPickerName = ""
    private var boardGeneration = 0
    private var boardReadTask: Task<Void, Never>?
    private var boardNeedsRead = false
    private var calendarState: CoreObject = [:]
    private var calendarLoadedDepth = 50
    private var calendarNeedsRead = false
    private var calendarReadTask: Task<Void, Never>?
    private var calendarItemTaskID = ""
    private var calendarPreferenceValues: CoreObject = [:]
    private var calendarPreferencePending = false
    private var calendarPreferenceTarget: CoreObject?
    @Published private var calendarComposerEdits: [CoreObject] = []
    @Published private var calendarComposerEditing = false
    private var calendarComposerGeneration = 0
    private var calendarComposerSaveRequest: String?
    private var calendarComposerRecoveredResult: CoreObject?
    private var calendarComposerNavigation: (state: CoreObject, minute: Double)?
    // Native scroll position only; core state remains the source of dates/modes.
    var calendarScrollAnchor = ""
    var calendarViewportAnchors: [String: Double] = [:]
    private(set) var calendarViewportGeneration = 0
    private var previewTask: Task<Void, Never>?
    private var previewGeneration = 0
    private var previewedText = ""
    private var captureID = UUID().uuidString
    private var capturePending = false
    private var mindSweepRequest: String?
    private var mindSweepRequestID: String?
    private var mindSweepRequestGroup: String?
    private var mindSweepCountedIDs: Set<String> = []
    private var mindSweepRecoveredResult: CoreObject?
    private var mindSweepRequestedScope = "all"
    private var mindSweepCaller: Surface?
    private var processInboxCaller: Surface?
    private var processInboxSessionID: String?
    private var processInboxRequest: String?
    private var processInboxRequestMethod: String?
    private var processInboxRequestID: String?
    private var processInboxRequestTaskID: String?
    private var processInboxAfterRequestID: String?
    private var processInboxPendingEdits: [CoreObject] = []
    private var processInboxEditTask: Task<Void, Never>?
    private var processInboxTransitioning = false
    private var refreshRequested = false
    private var viewedTaskID = ""
    private var taskSavePending = false
    private var taskChecklistLoaded = false
    private var taskOriginalChecklist: [CoreObject] = []
    private var taskChecklistSession = 0
    private var taskChecklistWriteKind: String?
    private var taskChecklistWriteRequest: String?
    private var taskChecklistResetAcknowledgment: CoreObject?
    @Published private(set) var taskChecklistReadPending = false
    private var taskOriginalDraft: CoreObject = [:]
    private var taskOriginalSchedule: CoreObject = [:]
    private var taskOriginalRecurrence: CoreObject = [:]
    private var taskScheduleSession = 0
    private var taskScheduleSequence = 0
    private var taskScheduleEdits: [TaskScheduleEdit] = []
    private var taskScheduleTask: Task<Void, Never>?
    private var taskScheduleFailure: Error?
    private var taskScheduleFailedID: Int?
    private var taskRelativeInputOwned = false
    private var taskRelativeInputCommitRequested = false
    private var taskRecurrenceInputOwned: Set<String> = []
    private var taskRecurrenceInputCommitRequested: Set<String> = []
    private let taskRecurrenceFields = ["recurrence", "recurrenceStrategy", "recurrenceRRule", "showFutureRecurrence"]
    private let taskDateFields = ["startTime", "dueDate", "reviewAt"]
    private var taskEstimateResolvedInput = ""
    private let taskSaveFields = ["title", "description", "priority", "energyLevel", "timeEstimate", "projectId", "areaId", "sectionId", "contexts", "tags", "startTime", "dueDate", "reviewAt"]
    private let taskTokenFields = ["contexts", "tags"]
    private var taskTokenCanonical: [String: String] = [:]
    private var taskTokenResolvedInputs: [String: String] = [:]
    private var taskTokenSuggestionInputs: [String: String] = [:]
    private var taskTokenReadTasks: [String: Task<Void, Never>] = [:]
    private var taskTokenGenerations: [String: Int] = [:]
    private var taskTokenGeneration = 0
    private var taskTokenNeedsRead: Set<String> = []
    private var taskTokenCommitDisplay: Set<String> = []
    private var taskTokenEdited: Set<String> = []
    private var taskDestinationGeneration = 0
    private var taskDestinationReadTask: Task<Void, Never>?
    private var taskDestinationNeedsRead = false
    private var taskDestinationDraftIdentity = ""
    private var focusState: CoreObject = [:]
    private var focusEdits: [CoreObject] = []
    private var focusEditSequence = 0
    @Published private var focusRefusedLocationID: Int?
    #if DEBUG && targetEnvironment(simulator)
    // Response faults are enabled only for an explicitly isolated UI-test library.
    private var projectAreaTestReadFailure = false
    private var projectAreaTestBlockedWrite = false
    private var projectTagTestReadFailure = false
    private var projectViewTestReadFailures = 0
    private var projectFilterTestReadFailures = 0
    private var referenceSortTestReadFailure = false
    private var referenceViewTestReadFailures = 0
    private var historyViewTestReadFailures = 0
    private var boardPickerTestReadFailures = 0
    // Exercise the empty-snapshot error and Retry through the real UI. Both
    // initial attempts fail; the explicit retry then uses the real core read.
    private var focusInitialReadFailures = ProcessInfo.processInfo.arguments.contains("--native-focus-initial-read-failure") ? 2 : 0
    #endif
    private var focusGeneration = 0
    private var focusReadTask: Task<Void, Never>?
    private var focusNeedsRead = false
    private var focusLoadedDepth: [String: Int] = [:]
    private var focusSavedDepth = 100
    private var focusPickerDepth = 100
    private var focusPickerPublishedName = ""
    private var focusPickerPublishedQuery = ""
    private var searchCaller: Surface = .inbox
    private var searchTask: Task<Void, Never>?
    private var searchGeneration = 0
    private var publishedSearchGeneration = -1
    private var searchNeedsRead = false
    private var projectCaller: Surface = .projects
    private var projectLoadedDepth = 50
    private var projectNotesLoadedDepth = 50
    private var projectNotesEditOptions: CoreObject = [:]
    private var projectNotesEditOptionsCurrent = false
    private var projectNotesEditLoaded = false
    private var projectNotesEditBaseRaw: String?
    private var projectNotesWriteRequest: String?
    private var projectNotesExpectedRaw: String?
    private var projectNotesFlushTask: Task<Bool, Never>?
    private var projectNotesFlushID: UUID?
    private var projectCreateAreaFilterValue: String?
    private var pendingProjectTagFilter: String?
    private var projectCreateRequest: String?
    private var projectCreateRequestID: String?
    private var projectCreateOptionsCurrent = false
    private var projectFocusRequest: String?
    private var projectFocusExpectedID: String?
    private var projectFocusDesired: Bool?
    private var projectRenameOptions: CoreObject = [:]
    private var projectRenameOptionsCurrent = false
    private var projectRenameRequest: String?
    private var projectRenameExpectedID: String?
    private var projectFlowRequest: String?
    private var projectFlowExpectedResult: CoreObject?
    private var projectTaskSortRequest: String?
    private var projectTaskSortExpectedResult: CoreObject?
    private var projectStatusOptions: CoreObject = [:]
    private var projectStatusOptionsCurrent = false
    private var projectStatusRequest: String?
    private var projectStatusExpectedID: String?
    private var projectStatusExpectedStatus: String?
    private var projectDateOptions: CoreObject = [:]
    private var projectDateOptionsField: String?
    private var projectDateOptionsCurrent = false
    private var projectDateRequest: String?
    private var projectDateExpectedID: String?
    private var projectDateExpectedField: String?
    private var projectDateExpectedValue: Any?
    private var projectReviewOpeningRaw: String?
    private var projectAreaOptionsCurrent = false
    private var projectAreaOpeningAssociation: (id: String?, title: String?)?
    private var projectAreaRequest: String?
    private var projectAreaHasRequestedChoice = false
    private var projectAreaRequestedID: String?
    private var projectAreaExpectedID: String?
    private var projectAreaExpectedAreaID: String?
    private var projectAreaCreateProjectID: String?
    private var projectAreaCreateDurableChange = false
    private var projectTagsOptionsCurrent = false
    private var projectTagsOpeningRaw: [String]?
    private var projectTagsRequest: String?
    private var projectTagsExpectedID: String?
    private var projectSectionOptionsCurrent = false
    private var projectSectionRequest: String?
    private var projectSectionExpectedID: String?
    private var projectSectionExpectedProjectID: String?
    private var projectSectionRenameOptions: CoreObject = [:]
    private var projectSectionRenameOptionsCurrent = false
    private var projectSectionRenameRequest: String?
    private var projectSectionRenameExpectedID: String?
    private var projectSectionRenameExpectedProjectID: String?
    private var projectSectionDeleteOptions: CoreObject = [:]
    private var projectSectionDeleteOptionsCurrent = false
    private var projectSectionDeleteReadyID: String?
    private var projectSectionDeleteRequest: String?
    private var projectSectionDeleteExpectedID: String?
    private var projectSectionDeleteExpectedProjectID: String?
    private var projectSectionOrderOptionsCurrent = false
    private var projectSectionOrderRequest: String?
    private var projectSectionOrderExpectedProjectID: String?
    private var projectSectionOrderExpectedIDs: [String]?
    private var areaCreateRequest: String?
    private var areaCreateExpectedID: String?
    private var areaCreateOptionsCurrent = false
    private var areaCreateNameGeneration = 0
    private var areaColorRequest: String?
    private var areaColorExpectedID: String?
    private var areaColorOptionsCurrent = false
    private var areaOrderRequest: String?
    private var areaOrderExpectedIDs: [String]?
    private var areaOrderOptionsCurrent = false
    private var areaRenameOpeningExpected: CoreObject?
    private var areaRenameRequest: String?
    private var areaRenameExpectedSourceID: String?
    private var areaRenameCloseAfterRefresh = false
    private var areaDeleteRequest: String?
    private var areaDeleteExpectedID: String?
    private var areaDeleteOptionsCurrent = false
    private var contextsCaller: Surface = .inbox
    private var contextsSelection: CoreObject = [:]
    private var contextsLoadedDepth = 50
    private var contextsGeneration = 0
    private var contextsReadTask: Task<Void, Never>?
    private var contextsNeedsRead = false
    private var contextsIntents: [CoreObject] = []
    private var waitingCaller: Surface = .inbox
    private var waitingLoadedDepth = 50
    private var waitingCollectionDepth: [String: Int] = [:]
    private var somedayCaller: Surface = .inbox
    private var somedayParams: CoreObject = [:]
    private var somedayLoadedDepth = 50
    private var somedayDeferredDepth = 100
    private var somedayTextEdits: [String: CoreObject] = [:]
    private var somedayPendingEdit: CoreObject?
    private var somedayTextNeedsRead = false
    private var somedayReadTask: Task<Void, Never>?
    private var somedayPickerDepth = 100
    private var somedayPickerNeedsRead = false
    private var referenceCaller: Surface = .inbox
    private var referenceParams: CoreObject = [:]
    private var referenceCollapsedGroups: [String: [String]] = [:]
    private var referenceViewPreferencePending = false
    private var referenceLoadedDepth = 50
    private var referenceTextEdits: [String: CoreObject] = [:]
    private var referencePendingEdit: CoreObject?
    private var referenceTextNeedsRead = false
    private var referenceReadTask: Task<Void, Never>?
    private var referencePickerDepth = 100
    private var referencePickerNeedsRead = false
    private var historyCaller: Surface = .inbox
    private var historyParamsByTab: [String: CoreObject] = [:]
    private var historyCollapsedGroupsByTab: [String: [String: [String]]] = [:]
    private var historyViewPreferencePending: Set<String> = []
    private var historyDepthByTab: [String: Int] = [:]
    private var historyTextEdits: [String: CoreObject] = [:]
    private var historyPendingEdit: CoreObject?
    private var historyNeedsRead = false
    private var historyReadTask: Task<Void, Never>?
    private var historyPickerDepth = 100
    private var historyPickerNeedsRead = false
    private var trashCaller: Surface = .inbox
    private var trashLoadedDepth = 50
    private let pageSize = 50
    private var preference = "nativeFoundation.capture.addAnother"
    private var storedLanguage = ""
    private var storedTheme = ""
    private var initialAddAnother = false

    var focusControlsEnabled: Bool {
        ready && selectedSurface == .focus && !focus.isEmpty && !busy && !retryNeeded && !taskPresented && !areaPickerPresented && !focusOrderPresented && !focusSavedFilterPresented
    }
    var focusSavedFilterPresented: Bool { !focusSavedFilterOperation.isEmpty }
    var focusSavedFilterCanConfirm: Bool {
        !busy && !retryNeeded && focusSavedFilterRequest == nil && !focusSavedFilterOptions.isEmpty
            && (focusSavedFilterOperation.text("type") != "save" || !focusSavedFilterName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
    var focusOrderInputEnabled: Bool {
        ready && selectedSurface == .focus && focusOrderPresented && focusOrderCurrent
            && focusOrderView.flag("canReorder") && !busy && !retryNeeded && focusOrderRequest == nil
            && !taskPresented && !capturePresented && !areaPickerPresented && !morePresented
    }
    var reviewActionsEnabled: Bool {
        ready && selectedSurface == .review && reviewCurrent && !busy && !retryNeeded
            && !taskPresented && !areaPickerPresented && !reviewPickerPresented && !mindSweepPresented
            && !processInboxPresented
    }
    var reviewRows: [CoreObject] {
        (reviewGuidePresented ? reviewGuide : reviewOverview).objects("items").compactMap {
            let row = $0.object("row")
            return row.isEmpty ? nil : row
        }
    }
    private var reviewTaskIDs: Set<String> {
        var ids = Set(reviewRows.map { $0.text("id") })
        if reviewGuidePresented {
            ids.formUnion(reviewGuide.object("content").objects("tasks").map { $0.text("taskId") })
            for item in reviewGuide.objects("items") where item.text("type") == "context" {
                ids.formUnion(reviewNestedWindow("contextTasks", key: item.text("context"), fallback: item.object("tasks"))
                    .objects("items").map { $0.text("id") })
            }
        }
        return ids
    }
    var boardControlsEnabled: Bool {
        ready && selectedSurface == .board && !boardView.isEmpty && !boardLoading && !busy && !retryNeeded
            && !taskPresented && !areaPickerPresented
    }
    var boardActionsEnabled: Bool { boardControlsEnabled && boardCurrent && !boardFiltersPresented }
    var boardActionPending: Bool { boardActionRequest != nil }
    var mindSweepControlsEnabled: Bool {
        guard let caller = mindSweepCaller else { return false }
        return ready && mindSweepPresented && selectedSurface == caller && !busy && !retryNeeded
            && mindSweepRequest == nil && (caller != .review || (reviewGuidePresented && reviewKind == "weekly"))
    }
    var processInboxControlsEnabled: Bool {
        guard let caller = processInboxCaller else { return false }
        return ready && processInboxPresented && selectedSurface == caller && !processInboxView.isEmpty
            && !busy && !retryNeeded && !processInboxTransitioning && processInboxRequest == nil
            && processInboxAfterRequestID == nil && processInboxReadError == nil
    }
    var processInboxCloseEnabled: Bool {
        processInboxPresented && !busy && !retryNeeded && processInboxRequest == nil
            && !processInboxTransitioning
    }
    var mindSweepCanAdd: Bool {
        mindSweepControlsEnabled && !mindSweepCurrentGroup.isEmpty
            && !mindSweepDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var mindSweepCurrentGroup: CoreObject {
        let groups = mindSweepGuide.objects("groups")
        return groups.indices.contains(mindSweepStep) ? groups[mindSweepStep] : [:]
    }
    var mindSweepCapturedCount: Int { mindSweepCaptured.values.reduce(0) { $0 + $1.count } }
    var calendarActionsEnabled: Bool {
        ready && selectedSurface == .calendar && calendarCurrent && !busy && !retryNeeded
            && !taskPresented && !areaPickerPresented && !calendarItemPresented && !calendarComposerPresented
            && !capturePresented && !morePresented
    }
    var calendarComposerCanSave: Bool {
        let composer = calendarComposerView.object("composer")
        return calendarComposerPresented && !composer.isEmpty && !calendarComposerView.flag("saveDisabled")
            && !calendarComposerEditing && calendarComposerEdits.isEmpty && calendarComposerError == nil
            && calendarComposerQueryInput == composer.text("query")
            && calendarComposerTitleInput == composer.text("title")
            && calendarComposerStartInput == composer.text("startTimeValue")
            && calendarComposerEndInput == composer.text("endTimeValue")
            && !busy && !retryNeeded && calendarComposerSaveRequest == nil
    }
    var calendarComposerEditPending: Bool { calendarComposerEditing || !calendarComposerEdits.isEmpty }
    var calendarItems: [CoreObject] {
        calendarView.objects("items").compactMap { $0.text("type") == "item" ? $0.object("item") : nil }
    }
    private func calendarEditableTask(_ id: String) -> Bool {
        calendarItems.contains { $0.text("taskId") == id && $0.flag("pressable") && !$0.flag("projected")
            && $0.object("row").text("id") == id && !$0.object("row").flag("readOnly") }
    }
    var focusActionsEnabled: Bool { focusControlsEnabled && focusCurrent && focusPanel.isEmpty }
    var focusPickerMatchesQuery: Bool {
        focusPickerPublishedName == focusPickerName && focusPickerPublishedQuery == focusPickerQuery
    }
    var focusPickerActionsEnabled: Bool { focusControlsEnabled && focusPickerMatchesQuery && !focusPicker.isEmpty }
    var focusLocationRefused: Bool { focusRefusedLocationID != nil }
    var items: [CoreObject] { inbox.objects("items") }
    var searchCurrent: Bool { publishedSearchGeneration == searchGeneration && !searchLoading }
    var searchActionsEnabled: Bool {
        ready && selectedSurface == .search && searchCurrent && !busy && !retryNeeded && !taskPresented
    }
    var projectActionsEnabled: Bool {
        ready && selectedSurface == .project && projectCurrent && !busy && !retryNeeded && !taskPresented
            && !projectRenameEditing && !projectTaskOrderPresented
    }
    var projectViewOpenEnabled: Bool {
        projectActionsEnabled && pendingProjectView == nil && projectFilterPendingEdit == nil
            && !projectFilterNeedsRead && !capturePresented && !areaPickerPresented
            && !areaManagerPresented && !morePresented && !projectSectionsPresented && !projectAreaPresented
            && !projectTagsPresented && projectDateField == nil && !projectStatusOpen
    }
    var projectViewReadPending: Bool {
        pendingProjectView != nil || projectFilterPendingEdit != nil || projectFilterNeedsRead
            || (!projectDetail.isEmpty && projectError != nil)
    }
    var projectFilterActionsEnabled: Bool {
        projectViewOpenEnabled && projectFilterError == nil && !projectTaskSortPresented
    }
    var projectFilterPickerActionsEnabled: Bool {
        projectFilterActionsEnabled && projectFiltersPresented && projectFilterPickerName == "tokens"
            && projectFilterPickerCurrent
            && projectFilterPicker.text("query").utf8.elementsEqual(projectFilterPickerQuery.utf8)
            && projectFilterPicker.text("viewRevision") == projectDetail.text("revision")
    }
    var projectTaskOrderPending: Bool { projectTaskOrderRequest != nil }
    var projectTaskOrderOpenEnabled: Bool {
        projectViewOpenEnabled && !projectDetail.flag("readOnly")
            && projectDetail.object("controls").flag("hasReorderTargets")
            && projectTaskSortOptions.text("effectiveSortBy") == "default"
    }
    var projectTaskOrderInputEnabled: Bool {
        ready && selectedSurface == .project && projectCurrent && projectTaskOrderPresented
            && projectTaskOrderCurrent && projectTaskOrderView.flag("canReorder")
            && !projectTaskOrderView.text("orderToken").isEmpty
            && !busy && !retryNeeded && !projectTaskOrderPending
    }
    func projectTaskOrderItemID(_ item: CoreObject) -> Data {
        Data((item.text("type") + ":" + (item.text("type") == "task"
            ? item.object("row").text("id") : item.text("id"))).utf8)
    }
    var projectTaskSortPending: Bool { projectTaskSortRequest != nil }
    var projectTaskSortInputEnabled: Bool {
        projectViewOpenEnabled && projectTaskSortOptions.flag("canEdit")
            && projectTaskSortOptions.text("revision") == projectDetail.text("mutationRevision")
            && projectTaskSortReadError == nil && projectTaskSortRequest == nil
    }
    var projectTaskViewActive: Bool {
        projectDetail.object("controls").flag("showCompleted")
            || projectTaskSortOptions.text("effectiveSortBy") != "default"
            || projectDetail.object("filters").flag("hasActive")
    }
    var projectRenameOpenEnabled: Bool {
        projectActionsEnabled && !projectDetail.flag("readOnly") && !capturePresented
            && !areaPickerPresented && !areaManagerPresented && !morePresented
            && projectRenameRequest == nil
    }
    var projectRenameInputEnabled: Bool {
        ready && selectedSurface == .project && projectRenameEditing && projectRenameOptionsCurrent
            && projectRenameOptions.flag("canRename") && projectRenameReadError == nil
            && !busy && !retryNeeded && projectRenameRequest == nil
    }
    var projectRenameCanSave: Bool { projectRenameInputEnabled && !projectRenameTitle.isEmpty }
    var projectRenamePending: Bool { projectRenameRequest != nil }
    var projectFlowPending: Bool { projectFlowRequest != nil }
    var projectStatusPending: Bool { projectStatusRequest != nil }
    var projectDatePending: Bool { projectDateRequest != nil }
    var projectAreaPending: Bool { projectAreaRequest != nil }
    var projectSectionPending: Bool {
        projectSectionRequest != nil || projectSectionRenameRequest != nil || projectSectionDeleteRequest != nil
            || projectSectionOrderRequest != nil
    }
    var projectSectionRows: [CoreObject] { projectSectionOptions.objects("sections") }
    var projectSectionCloseEnabled: Bool { !busy && !retryNeeded && !projectSectionPending }
    private var projectSectionOptionsFresh: Bool {
        projectSectionOptionsCurrent && selectedSurface == .project && projectCurrent
            && projectSectionOptions.object("project").text("id") == projectHeader.text("id")
            && projectSectionOptions.text("revision") == projectDetail.text("mutationRevision")
    }
    private var projectSectionOrderOptionsFresh: Bool {
        projectSectionOrderOptionsCurrent && projectSectionOptionsFresh
            && projectSectionOrderOptions.object("project").text("id") == projectHeader.text("id")
            && projectSectionOrderOptions.text("revision") == projectDetail.text("mutationRevision")
            && projectSectionOrderOptions.objects("sections").map { $0.text("id") } == projectSectionRows.map { $0.text("id") }
    }
    private var projectSectionRenameOptionsFresh: Bool {
        guard let sectionID = projectSectionEditID else { return false }
        return projectSectionRenameOptionsCurrent && projectSectionOptionsFresh
            && projectSectionRenameOptions.text("revision") == projectDetail.text("mutationRevision")
            && projectSectionRenameOptions.object("project").text("id") == projectHeader.text("id")
            && projectSectionRenameOptions.object("section").text("id") == sectionID
    }
    private var projectSectionDeleteOptionsFresh: Bool {
        guard let sectionID = projectSectionDeleteReadyID else { return false }
        return projectSectionDeleteOptionsCurrent && projectSectionOptionsFresh
            && projectSectionDeleteOptions.text("revision") == projectDetail.text("mutationRevision")
            && projectSectionDeleteOptions.object("project").text("id") == projectHeader.text("id")
            && projectSectionDeleteOptions.object("section").text("id") == sectionID
            && projectSectionDeleteOptions.flag("canDelete")
    }
    var projectSectionAddEnabled: Bool {
        projectSectionsPresented && !projectSectionEditing && projectSectionOptionsFresh
            && projectSectionOptions.flag("canCreate") && projectSectionCloseEnabled
    }
    func projectSectionEditEnabled(_ id: String) -> Bool {
        projectSectionsPresented && !projectSectionEditing && projectSectionOptionsFresh
            && projectSectionOptions.flag("canCreate") && projectSectionCloseEnabled
            && projectSectionRows.contains { $0.text("id") == id }
    }
    func projectSectionDeleteEnabled(_ id: String) -> Bool {
        projectSectionsPresented && !projectSectionEditing && projectSectionOptionsFresh
            && projectSectionOptions.flag("canCreate") && projectSectionCloseEnabled
            && projectSectionRows.contains { $0.text("id") == id }
    }
    func projectSectionMoveEnabled(_ id: String, direction: String) -> Bool {
        guard ["up", "down"].contains(direction), projectSectionsPresented, !projectSectionEditing,
              projectSectionCloseEnabled, projectSectionOrderOptionsFresh,
              projectSectionOrderOptions.flag("canReorder"),
              let row = projectSectionOrderOptions.objects("sections").first(where: { $0.text("id") == id }) else {
            return false
        }
        return row.flag(direction == "up" ? "canMoveUp" : "canMoveDown")
    }
    func projectSectionDeleteConfirmationReady(_ id: String) -> Bool {
        projectSectionDeleteReadyID == id && projectSectionDeleteOptionsFresh
            && projectSectionsPresented && !projectSectionEditing && projectSectionCloseEnabled
    }
    var projectSectionReadRetryVisible: Bool {
        projectSectionsPresented && !projectSectionPending
            && (!projectSectionOptionsFresh || !projectSectionOrderOptionsFresh
                || (projectSectionEditID != nil && !projectSectionRenameOptionsFresh)
                || projectSectionReadError != nil)
    }
    var projectSectionInputEnabled: Bool {
        projectSectionsPresented && projectSectionEditing && projectSectionOptionsFresh
            && projectSectionOptions.flag("canCreate") && projectSectionReadError == nil
            && (projectSectionEditID == nil ||
                (projectSectionRenameOptionsFresh && projectSectionRenameOptions.flag("canRename")))
            && !busy && !retryNeeded && !projectSectionPending
    }
    var projectSectionCanSave: Bool {
        let title = projectSectionTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        return projectSectionInputEnabled && !title.isEmpty && title.utf16.count <= 100_000
    }
    var projectSectionOpenTapEnabled: Bool {
        ready && selectedSurface == .project && projectCurrent && !retryNeeded && !taskPresented
            && !projectRenameEditing && !capturePresented && !areaPickerPresented
            && !areaManagerPresented && !morePresented && !projectSectionsPresented
            && !projectSectionPending
    }
    var projectDateTapEnabled: Bool {
        ready && selectedSurface == .project && !retryNeeded && !taskPresented
            && !projectRenameEditing && !projectDetail.flag("readOnly") && !capturePresented
            && !areaPickerPresented && !areaManagerPresented && !morePresented
            && projectDateRequest == nil
    }
    var projectDateOpenEnabled: Bool { projectDateTapEnabled && projectActionsEnabled }
    var projectDateDoneEnabled: Bool {
        projectDateField != nil && projectDateOptionsCurrent && projectDateOptions.flag("canEdit")
            && projectDateReadError == nil && projectDateRequest == nil && !busy && !retryNeeded
            && projectCurrent && projectDateOptions.text("revision") == projectDetail.text("mutationRevision")
            && (projectDateField != "reviewAt" || projectDateOpeningTimeZone != nil)
    }
    var projectAreaOpenEnabled: Bool {
        projectActionsEnabled && !projectDetail.flag("readOnly") && !capturePresented
            && !areaPickerPresented && !areaManagerPresented && !morePresented
            && !projectAreaPresented && !projectSectionsPresented && projectDateField == nil
            && projectAreaRequest == nil
    }
    var projectAreaCloseEnabled: Bool {
        if areaManagerPresented {
            return areaManagerProjectID != nil && areaManagerCloseEnabled
        }
        return !projectAreaCreatePresented && !busy && !retryNeeded && projectAreaRequest == nil
            && areaCreateRequest == nil
    }
    var projectAreaChoiceEnabled: Bool {
        projectAreaPresented && projectAreaOptionsCurrent && projectAreaOptions.flag("canEdit")
            && projectAreaReadError == nil && !busy && !retryNeeded && projectAreaRequest == nil
            && projectCurrent && projectAreaOptions.text("revision") == projectDetail.text("mutationRevision")
    }
    var projectAreaNeedsRead: Bool {
        projectAreaPresented && projectAreaRequest == nil && !projectAreaOptions.isEmpty
            && (!projectAreaOptionsCurrent
                || projectAreaOptions.text("revision") != projectDetail.text("mutationRevision"))
    }
    var projectAreaSelectedID: String? {
        if projectAreaHasRequestedChoice { return projectAreaRequestedID }
        return projectAreaOptions.object("project")["areaId"] as? String
    }
    var projectAreaAddEnabled: Bool {
        projectAreaChoiceEnabled && !projectAreaCreatePresented && projectAreaCreatedID == nil
            && areaCreateRequest == nil
    }
    var projectAreaManagerOpenEnabled: Bool {
        projectAreaChoiceEnabled && !projectAreaCreatePresented && projectAreaCreatedID == nil
            && !areaManagerPresented && areaCreateRequest == nil && areaColorRequest == nil
            && areaOrderRequest == nil && areaRenameRequest == nil && areaDeleteRequest == nil
    }
    var projectAreaCreateInputEnabled: Bool {
        ready && selectedSurface == .project && projectAreaPresented && projectAreaCreatePresented
            && projectAreaOptionsCurrent && projectAreaOptions.flag("canEdit")
            && projectAreaOptions.text("revision") == projectDetail.text("mutationRevision")
            && projectAreaReadError == nil && projectCurrent && areaCreateOptionsCurrent
            && !busy && !retryNeeded && areaCreateRequest == nil && projectAreaRequest == nil
    }
    var projectAreaCreateCanSubmit: Bool {
        projectAreaCreateInputEnabled && areaCreateReadError == nil
            && !projectAreaCreateNameChecking && !projectAreaCreateNameTaken
            && projectAreaCreateNameValid
            && (areaCreateOptions["colors"] as? [String])?.contains(projectAreaCreateColor) == true
    }
    var projectAreaCreatedStatusVisible: Bool {
        projectAreaPresented && projectAreaCreatedID != nil && projectAreaRequest == nil && !busy
            && !projectAreaCreatePresented
    }
    var projectTagsPending: Bool { projectTagsRequest != nil }
    var projectTagsOpenEnabled: Bool {
        projectActionsEnabled && !projectDetail.flag("readOnly") && !capturePresented
            && !areaPickerPresented && !areaManagerPresented && !morePresented
            && !projectTagsPresented && !projectAreaPresented && !projectSectionsPresented
            && projectDateField == nil && projectTagsRequest == nil
    }
    var projectTagsCloseEnabled: Bool {
        projectTagsPresented && !projectTagsAddPresented && !busy && !retryNeeded
            && projectTagsRequest == nil
    }
    var projectTagsChoiceEnabled: Bool {
        projectTagsPresented && !projectTagsAddPresented && projectTagsOptionsCurrent
            && projectTagsOptions.flag("canEdit") && projectTagsReadError == nil
            && !busy && !retryNeeded && projectTagsRequest == nil && projectCurrent
            && projectTagsOptions.text("revision") == projectDetail.text("mutationRevision")
    }
    var projectTagsAddInputEnabled: Bool {
        projectTagsPresented && projectTagsAddPresented && projectTagsOptionsCurrent
            && projectTagsOptions.flag("canEdit") && projectTagsReadError == nil
            && !busy && !retryNeeded && projectTagsRequest == nil && projectCurrent
            && projectTagsOptions.text("revision") == projectDetail.text("mutationRevision")
    }
    var projectTagsAddCanSubmit: Bool { projectTagsAddInputEnabled && !projectTagsDraft.isEmpty }
    var projectTagsNeedsRead: Bool {
        projectTagsPresented && projectTagsRequest == nil && !projectTagsOptions.isEmpty
            && (!projectTagsOptionsCurrent
                || projectTagsOptions.text("revision") != projectDetail.text("mutationRevision"))
    }
    func projectTagsChoiceSelected(_ index: Int) -> Bool {
        let suggestions = projectTagsOptions["suggestions"] as? [String] ?? []
        guard suggestions.indices.contains(index),
              let selected = projectTagsOptions.object("project")["tagIds"] as? [String] else { return false }
        let raw = Data(suggestions[index].utf8)
        return selected.contains { Data($0.utf8) == raw }
    }
    var projectStatusSelectedStatus: String { projectStatusOptions.object("project").text("status") }
    var projectStatusOpenTapEnabled: Bool {
        ready && selectedSurface == .project && !retryNeeded && !taskPresented
            && !projectRenameEditing && !projectDetail.flag("readOnly") && !capturePresented
            && !areaPickerPresented && !areaManagerPresented && !morePresented
            && projectStatusRequest == nil
    }
    var projectStatusPickTapEnabled: Bool {
        projectStatusOpen && projectStatusReadError == nil && !retryNeeded
            && projectStatusRequest == nil && !projectStatusOptions.object("project").isEmpty
    }
    var projectStatusOpenEnabled: Bool {
        projectActionsEnabled && !projectDetail.flag("readOnly") && !capturePresented
            && !areaPickerPresented && !areaManagerPresented && !morePresented
            && projectStatusRequest == nil
    }
    var projectNotesWritePending: Bool { projectNotesWriteRequest != nil }
    var projectNotesEditReady: Bool { projectNotesEditLoaded }
    var projectNotesDirty: Bool { projectNotesEditLoaded && projectNotesDraft != (projectNotesEditBaseRaw ?? "") }
    var projectNotesEditInputEnabled: Bool {
        projectActionsEnabled && projectNotesExpanded && projectNotesEditMode
            && projectNotesEditOptionsCurrent && projectNotesEditOptions.flag("canEdit")
            && projectNotesWriteRequest == nil && projectNotesEditReadError == nil
            && !projectNotesEditConflict
    }
    var projectNotesCanDiscard: Bool {
        projectNotesDirty && (projectNotesEditError != nil || projectNotesEditConflict)
            && projectNotesWriteRequest == nil && !retryNeeded && !busy
    }
    var projectFlowInputEnabled: Bool {
        projectActionsEnabled && !projectDetail.flag("readOnly") && !capturePresented
            && !areaPickerPresented && !areaManagerPresented && !morePresented
            && projectFlowRequest == nil && projectFlowReadError == nil
    }
    var projectCreateInputEnabled: Bool {
        ready && selectedSurface == .projects && !busy && !retryNeeded && projectCreateRequest == nil
            && projectFocusRequest == nil
            && areaCreateRequest == nil && areaColorRequest == nil && areaOrderRequest == nil
            && areaRenameRequest == nil && areaDeleteRequest == nil && !areaManagerPresented
            && !taskPresented && !capturePresented && !areaPickerPresented && !morePresented
    }
    var projectCreateCanSubmit: Bool {
        projectCreateInputEnabled && projectCreateOptionsCurrent && projectCreateReadError == nil
            && !projectCreateTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (projectCreateAreaID.map { id in projectCreateOptions.objects("areas")
                .contains(where: { $0.text("id") == id }) } ?? true)
    }
    var projectCreatePending: Bool { projectCreateRequest != nil }
    var projectTagValues: [String] { projects.object("tagInventory")["values"] as? [String] ?? [] }
    var projectTagHasUntagged: Bool { projects.object("tagInventory").flag("hasUntagged") }
    var projectTagFilterInputEnabled: Bool {
        projectCreateInputEnabled && projectCreateOptionsCurrent && projectCreateReadError == nil
            && pendingProjectTagFilter == nil && !projects.isEmpty
    }
    func projectTagIsSelected(_ value: String) -> Bool {
        selectedProjectTagFilter.utf8.elementsEqual(value.utf8)
    }
    var projectFocusPending: Bool { projectFocusRequest != nil }
    var projectFocusInputEnabled: Bool {
        projectCreateInputEnabled && projectFocusReadError == nil
    }
    var areaCreatePending: Bool { areaCreateRequest != nil }
    var areaColorPending: Bool { areaColorRequest != nil }
    var areaOrderPending: Bool { areaOrderRequest != nil }
    var areaRenamePending: Bool { areaRenameRequest != nil }
    var areaRenameEditing: Bool { areaRenameEditingID != nil }
    var areaDeletePending: Bool { areaDeleteRequest != nil }
    private var areaManagerOptionsCurrent: Bool {
        areaCreateOptionsCurrent && areaColorOptionsCurrent && areaOrderOptionsCurrent && areaDeleteOptionsCurrent
    }
    private var areaManagerProjectOriginCurrent: Bool {
        guard let id = areaManagerProjectID else { return false }
        return selectedSurface == .project && projectAreaPresented && projectCurrent
            && !projectDetail.flag("readOnly") && projectHeader.text("id") == id
            && projectDetail.text("projectId") == id
    }
    private var areaManagerContextCurrent: Bool {
        if let id = areaManagerProjectID {
            return areaManagerProjectOriginCurrent && projectAreaOptionsCurrent
                && projectAreaOptions.flag("canEdit")
                && projectAreaOptions.object("project").text("id") == id
                && projectAreaOptions.text("revision") == projectDetail.text("mutationRevision")
        }
        return selectedSurface == .projects
    }
    private var areaManagerProjectCompositionIdle: Bool {
        areaManagerProjectID == nil || (projectAreaRequest == nil && projectAreaCreatedID == nil)
    }
    var areaManagerCloseEnabled: Bool {
        areaManagerPresented && !busy && !retryNeeded && areaCreateRequest == nil
            && areaColorRequest == nil && areaOrderRequest == nil && areaRenameRequest == nil
            && areaDeleteRequest == nil && projectAreaRequest == nil && !areaRenameEditing
    }
    var areaCreateInputEnabled: Bool {
        ready && areaManagerPresented && areaManagerContextCurrent && !busy && !retryNeeded
            && areaCreateRequest == nil && areaColorRequest == nil && areaOrderRequest == nil
            && areaRenameRequest == nil && areaDeleteRequest == nil && !areaRenameEditing
            && areaManagerOptionsCurrent && areaManagerProjectCompositionIdle
    }
    var areaCreateCanSubmit: Bool {
        areaCreateInputEnabled && areaCreateOptionsCurrent && areaCreateReadError == nil
            && !areaCreateNameChecking && !areaCreateNameTaken
            && !areaCreateName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (areaCreateOptions["colors"] as? [String])?.contains(areaCreateColor) == true
    }
    var areaManagerAreas: [CoreObject] {
        areaDeleteOptionsCurrent ? areaDeleteOptions.objects("areas")
            : areaOrderOptionsCurrent ? areaOrderOptions.objects("areas")
            : areaColorOptionsCurrent ? areaColorOptions.objects("areas") : areaCreateOptions.objects("areas")
    }
    var areaColorInputEnabled: Bool {
        ready && areaManagerPresented && areaManagerContextCurrent && !busy && !retryNeeded
            && areaCreateRequest == nil && areaColorRequest == nil && areaOrderRequest == nil
            && areaRenameRequest == nil && areaDeleteRequest == nil && !areaRenameEditing
            && areaManagerOptionsCurrent && areaColorReadError == nil && areaManagerProjectCompositionIdle
    }
    var areaOrderInputEnabled: Bool {
        ready && areaManagerPresented && areaManagerContextCurrent && !busy && !retryNeeded
            && areaCreateRequest == nil && areaColorRequest == nil && areaOrderRequest == nil
            && areaRenameRequest == nil && areaDeleteRequest == nil && !areaRenameEditing
            && areaManagerOptionsCurrent && areaOrderReadError == nil && areaManagerProjectCompositionIdle
    }
    var areaRenameOpenEnabled: Bool {
        ready && areaManagerPresented && areaManagerContextCurrent && !busy && !retryNeeded
            && areaCreateRequest == nil && areaColorRequest == nil && areaOrderRequest == nil
            && areaRenameRequest == nil && areaDeleteRequest == nil && !areaRenameEditing
            && areaManagerOptionsCurrent && areaOrderReadError == nil && areaManagerProjectCompositionIdle
    }
    var areaRenameInputEnabled: Bool {
        ready && areaManagerPresented && areaManagerContextCurrent && !busy && !retryNeeded
            && areaCreateRequest == nil && areaColorRequest == nil && areaOrderRequest == nil
            && areaRenameRequest == nil && areaDeleteRequest == nil && areaRenameEditing
            && areaManagerOptionsCurrent && areaRenameReadError == nil && areaManagerProjectCompositionIdle
    }
    var areaRenameCanSubmit: Bool {
        areaRenameInputEnabled && areaRenameOpeningExpected != nil
    }
    var areaDeleteInputEnabled: Bool {
        ready && areaManagerPresented && areaManagerContextCurrent && !busy && !retryNeeded
            && areaCreateRequest == nil && areaColorRequest == nil && areaOrderRequest == nil
            && areaRenameRequest == nil && areaDeleteRequest == nil && !areaRenameEditing
            && areaManagerOptionsCurrent && areaDeleteReadError == nil && areaManagerProjectCompositionIdle
    }
    var contextsControlsEnabled: Bool {
        ready && selectedSurface == .contexts && !contexts.isEmpty && !busy && !retryNeeded && !taskPresented && !areaPickerPresented
    }
    var contextsActionsEnabled: Bool { contextsControlsEnabled && contextsCurrent }
    var waitingActionsEnabled: Bool {
        ready && selectedSurface == .waiting && waitingCurrent && !busy && !retryNeeded && !taskPresented
    }
    var somedayActionsEnabled: Bool {
        ready && selectedSurface == .someday && somedayCurrent && !busy && !retryNeeded && !taskPresented
    }
    var somedayPickerActionsEnabled: Bool { somedayActionsEnabled && somedayPickerCurrent }
    var referenceActionsEnabled: Bool {
        ready && selectedSurface == .reference && referenceCurrent && !busy && !retryNeeded && !taskPresented
    }
    var referencePickerActionsEnabled: Bool { referenceActionsEnabled && referencePickerCurrent }
    var historyArchived: Bool { historyTabs.text("tab") == "archived" }
    var historyPrefix: String { historyArchived ? "archive" : "done" }
    private var historyReadName: String { historyArchived ? "archive" : "done" }
    var historyActionsEnabled: Bool {
        ready && selectedSurface == .history && historyCurrent && !busy && !retryNeeded && !taskPresented
    }
    var historyPickerActionsEnabled: Bool { historyActionsEnabled && historyPickerCurrent }
    var trashActionsEnabled: Bool {
        ready && selectedSurface == .trash && trashCurrent && !busy && !retryNeeded && !taskPresented
    }
    var quickAccessView: String { moreMenu.text("quickAccessView") }
    var quickAccessLabel: String {
        label(quickAccessView == "review" ? "tab.review" : quickAccessView == "projects" ? "projects.title" : "nav." + quickAccessView)
    }
    private var captureIsCurrent: Bool {
        previewedText == draft && capture.object("options").text("note") == noteDraft
    }
    var canSave: Bool { !busy && !retryNeeded && !contextPickerPresented && captureIsCurrent && capture.flag("canSave") }
    var contextPickerReady: Bool {
        !busy && !retryNeeded && captureIsCurrent && capture.object("picker").text("kind") == "context"
            && capture.object("picker").text("query") == contextQuery
    }
    func label(_ key: String) -> String { strings.text(key) }
    var taskDirty: Bool {
        !taskEditor.isEmpty && ((taskSaveFields + taskRecurrenceFields).contains { !taskDraftValuesEqual(taskDraft[$0], taskOriginalDraft[$0]) }
            || !taskDraftValuesEqual(taskDraft["relativeStartOffset"], taskOriginalDraft["relativeStartOffset"])
            || !taskDraftValuesEqual(taskDraft["status"], taskOriginalDraft["status"])
            || !taskDraftValuesEqual(taskChecklist, taskOriginalChecklist)
            || taskChecklistInputs.contains { entry in
                entry.key < taskChecklist.count && entry.value != taskChecklist[entry.key].text("title")
            }
            || !taskChecklistAppendInput.isEmpty
            || taskSchedulePending || taskEstimatePending || taskTokenFields.contains { taskTokenResolvedInputs[$0] != taskTokenInputs[$0] })
    }
    var taskDestinationActionsEnabled: Bool {
        taskPresented && !taskDestinationKind.isEmpty && taskDestinationCurrent && !busy && !retryNeeded
            && !taskEditor.flag("readOnly") && !taskDestination.flag("readOnly")
            && taskDestination.text("id") == viewedTaskID
            && taskDestination.text("query") == taskDestinationQuery
            && (try? json(taskDraft)) == taskDestinationDraftIdentity
    }
    private var taskDraft: CoreObject {
        var draft = taskEditor.object("draft")
        draft["title"] = taskTitleDraft
        draft["description"] = taskNoteDraft
        for field in taskTokenFields {
            if let canonical = taskTokenCanonical[field] { draft[field] = canonical }
        }
        return draft
    }
    private func taskEditRequest(_ edit: CoreObject? = nil) -> CoreObject {
        var request: CoreObject = ["id": viewedTaskID, "draft": taskDraft]
        if taskChecklistLoaded { request["checklist"] = taskChecklist }
        if let edit { request["edit"] = edit }
        return request
    }
    private var taskEstimatePending: Bool {
        taskEditor.object("fields").object("timeEstimate").flag("customSelected")
            && taskEstimateInput != taskEstimateResolvedInput
    }

    func start() async {
        guard !busy else { return }
        #if targetEnvironment(simulator) || (DEBUG && NATIVE_DEVICE_TEST)
        #if !targetEnvironment(simulator)
        // Device alpha builds must never open under the installed RN identity.
        guard Bundle.main.bundleIdentifier == "tech.dongdongbh.mindwtr.native.dev" else {
            error = "Physical testing requires the isolated native development app."
            return
        }
        #endif
        areaManagerPresented = false
        areaManagerProjectID = nil
        busy = true
        error = nil
        var boardTaskOpened = false
        defer {
            finishOperation()
            if boardTaskOpened { Task { await readTaskView() } }
        }
        do {
            if host == nil {
                guard let bundle = Bundle.main.url(forResource: "core-host", withExtension: "js") else {
                    throw CocoaError(.fileNoSuchFile)
                }
                let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                    appropriateFor: nil, create: true)
                #if DEBUG && targetEnvironment(simulator)
                let arguments = ProcessInfo.processInfo.arguments
                let testLibraryPositions = arguments.indices.filter { arguments[$0] == "--native-ui-test-library" }
                if let position = testLibraryPositions.first {
                    guard testLibraryPositions.count == 1, !arguments.contains("--native-rn-rehearsal"),
                          position + 1 < arguments.count,
                          let identifier = UUID(uuidString: arguments[position + 1]),
                          identifier.uuidString.lowercased() == arguments[position + 1] else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    let testRoot = support.appendingPathComponent("NativeUITests", isDirectory: true)
                    try FileManager.default.createDirectory(at: testRoot, withIntermediateDirectories: true)
                    guard try testRoot.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    let directory = testRoot.appendingPathComponent(identifier.uuidString.lowercased(), isDirectory: true)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    guard try directory.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    guard let isolatedDefaults = UserDefaults(suiteName: "nativeUITests.\(identifier.uuidString.lowercased())") else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    preferenceDefaults = isolatedDefaults
                    projectAreaTestReadFailure = arguments.contains("--native-project-area-read-failure")
                    projectAreaTestBlockedWrite = arguments.contains("--native-project-area-blocked-write")
                    projectTagTestReadFailure = arguments.contains("--native-project-tag-read-failure")
                    projectViewTestReadFailures = arguments.contains("--native-project-view-read-failure") ? 2 : 0
                    projectFilterTestReadFailures = arguments.contains("--native-project-filter-read-failure") ? 2 : 0
                    referenceSortTestReadFailure = arguments.contains("--native-reference-sort-read-failure")
                    referenceViewTestReadFailures = arguments.contains("--native-reference-view-read-failure") ? 2 : 0
                    historyViewTestReadFailures = arguments.contains("--native-history-view-read-failure") ? 2 : 0
                    boardPickerTestReadFailures = arguments.contains("--native-board-picker-read-failure") ? 2 : 0
                    host = CoreHost(databaseURL: directory.appendingPathComponent("mindwtr.sqlite"), bundleURL: bundle)
                } else if arguments.contains("--native-rn-rehearsal") {
                    // An explicitly staged copy only. Never select the live RN container.
                    let container = support.appendingPathComponent("NativeRNRehearsal", isDirectory: true)
                    let database = container.appendingPathComponent("Documents/SQLite/mindwtr.db")
                    guard try container.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true,
                          try database.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey]).isSymbolicLink != true,
                          try database.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true,
                          database.resolvingSymlinksInPath().path == container.resolvingSymlinksInPath()
                            .appendingPathComponent("Documents/SQLite/mindwtr.db").path,
                          let identifier = Bundle.main.bundleIdentifier else { throw CocoaError(.fileReadCorruptFile) }
                    let legacy = try LegacyRNStorage(containerURL: container, bundleIdentifier: identifier)
                    storedLanguage = try legacy.value(forKey: "mindwtr-language") ?? ""
                    storedTheme = try legacy.value(forKey: "@mindwtr_theme") ?? ""
                    initialAddAnother = try legacy.value(forKey: "mindwtr:quickCapture:addAnother") == "true"
                    preference = "nativeRNRehearsal.capture.addAnother"
                    initialProjectShowCompleted = try legacy.value(forKey: "mindwtr:view:project-detail:show-completed:v1") == "true"
                    projectShowCompletedPreference = "nativeRNRehearsal.project.showCompleted"
                    focusShowDetailsPreference = "nativeRNRehearsal.focus.showDetails"
                    focusExpandedSectionsPreference = "nativeRNRehearsal.focus.expandedSections"
                    referenceViewPreference = "nativeRNRehearsal.reference.view"
                    historyViewPreferences = ["done": "nativeRNRehearsal.history.done.view",
                                              "archive": "nativeRNRehearsal.history.archived.view"]
                    initialFocusShowDetails = false
                    initialFocusExpandedSections = [:]
                    if let raw = try legacy.value(forKey: "mindwtr:view:focus:v1"),
                       let data = raw.data(using: .utf8),
                       let state = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                        if let value = state["showDetails"] as? NSNumber,
                           CFGetTypeID(value) == CFBooleanGetTypeID() {
                            initialFocusShowDetails = value.boolValue
                        }
                        if let expanded = state["expandedSections"] as? [String: Any] {
                            for key in focusSectionKeys {
                                if let value = expanded[key] as? NSNumber,
                                   CFGetTypeID(value) == CFBooleanGetTypeID() {
                                    initialFocusExpandedSections[key] = value.boolValue
                                }
                            }
                            if initialFocusExpandedSections["next"] == nil,
                               let value = expanded["nextActions"] as? NSNumber,
                               CFGetTypeID(value) == CFBooleanGetTypeID() {
                                initialFocusExpandedSections["next"] = value.boolValue
                            }
                        }
                    }
                    initialReferenceGroupBy = try legacy.value(forKey: "mindwtr:view:reference:groupBy:v1")
                    if let raw = try legacy.value(forKey: "mindwtr:view:group-collapse:reference:v1"),
                       let data = raw.data(using: .utf8),
                       let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                        initialReferenceCollapsedGroups = referenceFoldMap(parsed, preserveEmpty: false)
                    }
                    for (name, viewKey, foldKey) in [
                        ("done", "mindwtr:view:done:v1", "mindwtr:view:group-collapse:done:v1"),
                        ("archive", "mindwtr:view:archived:v1", "mindwtr:view:group-collapse:archived:v1")
                    ] {
                        var view: CoreObject = [:]
                        if let raw = try legacy.value(forKey: viewKey), let data = raw.data(using: .utf8),
                           let parsed = (try? JSONSerialization.jsonObject(with: data)) as? CoreObject {
                            view = parsed
                        }
                        if let raw = try legacy.value(forKey: foldKey), let data = raw.data(using: .utf8),
                           let parsed = (try? JSONSerialization.jsonObject(with: data)) as? CoreObject {
                            view["collapsedGroups"] = referenceFoldMap(parsed, preserveEmpty: false)
                        }
                        initialHistoryViews[name] = view
                    }
                    host = CoreHost(databaseURL: database, bundleURL: bundle, legacyStorage: legacy)
                }
                #endif
                if host == nil {
                    let directory = support.appendingPathComponent("NativeFoundation", isDirectory: true)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    host = CoreHost(databaseURL: directory.appendingPathComponent("mindwtr.sqlite"), bundleURL: bundle)
                }
            }
            projectShowCompleted = (preferenceDefaults.object(forKey: projectShowCompletedPreference) as? Bool)
                ?? initialProjectShowCompleted
            focusShowDetails = (preferenceDefaults.object(forKey: focusShowDetailsPreference) as? Bool)
                ?? initialFocusShowDetails
            var expanded = initialFocusExpandedSections
            if let stored = preferenceDefaults.dictionary(forKey: focusExpandedSectionsPreference) {
                for key in focusSectionKeys {
                    if let value = stored[key] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() {
                        expanded[key] = value.boolValue
                    }
                }
            }
            collapsedFocusSections = Set(focusSectionKeys.filter { expanded[$0] == false })
            if let stored = preferenceDefaults.object(forKey: referenceViewPreference) {
                let view = stored as? [String: Any] ?? [:]
                initialReferenceGroupBy = view["groupBy"] as? String
                initialReferenceCollapsedGroups = referenceFoldMap(view["collapsedGroups"], preserveEmpty: true)
            }
            referenceCollapsedGroups = initialReferenceCollapsedGroups
            if let groupBy = initialReferenceGroupBy, validReferenceGroup(groupBy) {
                referenceParams["groupBy"] = groupBy
            }
            // An omitted groupBy lets core choose its default, currently Area.
            referenceParams["collapsedGroupIds"] = referenceCollapsedGroups[referenceParams.text("groupBy").isEmpty
                ? "area" : referenceParams.text("groupBy")] ?? []
            for name in ["done", "archive"] {
                guard let preferenceKey = historyViewPreferences[name] else { continue }
                let view: CoreObject
                if let stored = preferenceDefaults.object(forKey: preferenceKey) {
                    view = stored as? CoreObject ?? [:]
                } else { view = initialHistoryViews[name] ?? [:] }
                let groupBy = validHistoryGroup(view.text("groupBy")) ? view.text("groupBy") : "none"
                let folds = referenceFoldMap(view["collapsedGroups"], preserveEmpty: true)
                historyCollapsedGroupsByTab[name] = folds
                var params: CoreObject = ["groupBy": groupBy, "collapsedGroupIds": folds[groupBy] ?? []]
                if let sortBy = view["sortBy"] as? String, validHistorySort(sortBy) {
                    params["sortBy"] = sortBy
                }
                historyParamsByTab[name] = params
            }
            let startup = try decode(await host!.start())
            let recovery = startup.object("recovery")
            if recovery.text("method") == "boardCommit" {
                // Keep the durable acknowledgement if a later startup read fails.
                boardRecoveredResult = recovery.object("result")
            } else if ["calendarComposerCommit", "calendarComposerCreateCommit"].contains(recovery.text("method")) {
                calendarComposerRecoveredResult = recovery.object("result")
            } else if recovery.text("method") == "mindSweepCommit" {
                mindSweepRecoveredResult = recovery.object("result")
            } else if ["projectCreateCommit", "projectFocusCommit", "projectRenameCommit", "projectFlowCommit", "projectTaskSortCommit", "projectStatusCommit", "projectDateCommit", "projectAreaCommit", "projectTagsWriteCommit", "projectSectionCreateCommit", "projectSectionRenameCommit", "projectSectionDeleteCommit", "projectSectionOrderCommit", "projectTaskOrderCommit", "projectNotesWriteCommit", "areaCreateCommit", "areaColorCommit", "areaOrderCommit", "areaRenameCommit",
                       "areaDeleteCommit"].contains(recovery.text("method")) {
                // The host already verified the durable row. Reopen the list;
                // there is no project-detail navigation for quick add.
                selectedSurface = .projects
            } else if recovery.text("method") == "focusSavedFilterCommit" {
                selectedSurface = .focus
                focusState = recovery.object("result").object("controls")
            } else if ["taskFocusCommit", "focusGroupWrite", "focusOrderCommit"].contains(recovery.text("method")) {
                selectedSurface = .focus
            } else if recovery.text("method") == "taskListSortWrite" {
                selectedSurface = .reference
            } else if recovery.text("method") == "inboxPreparedCommit" {
                // The durable data recovered, but the in-memory queue did not.
                selectedSurface = .inbox
            }
            _ = try await query("language", [storedLanguage, Locale.preferredLanguages.first ?? Locale.current.identifier])
            let keys = ["tab.next", "tab.inbox", "tab.review", "tab.menu", "nav.addTask", "search.title",
                        "common.all", "common.close", "common.cancel", "common.done", "common.retry", "common.loading",
                        "task.aria.changeStatus", "task.aria.changeStatusHint", "quickAdd.audioRecord",
                        "common.more", "agenda.reviewDueProjects", "agenda.laterToday",
                        "agenda.addToFocus", "agenda.removeFromFocus",
                        "agenda.collapseOtherSections", "agenda.expandOtherSections", "markdown.expand", "markdown.collapse",
                        "projects.areaFilter", "filters.excluded", "taskEdit.tab.view", "common.notSet", "status.active", "status.waiting", "status.someday",
                        "common.save", "common.edit", "common.rename", "common.discard", "taskEdit.discardChanges", "taskEdit.discardChangesDesc",
                        "markdown.edit", "markdown.preview", "taskEdit.titleLabel", "taskEdit.descriptionLabel",
                        "taskEdit.descriptionPlaceholder", "search.placeholder", "search.noResults", "search.searching",
                        "search.resultProject", "search.resultTask", "search.inProjectSuffix", "search.showingFirst", "search.helpOperators",
                        "search.hiddenCompletedMatches", "filters.label", "common.clear", "review.markDone",
                        "nav.projects", "nav.review", "nav.calendar", "nav.board", "nav.contexts", "common.back", "common.tasks",
                        "task.aria.openContext", "task.aria.openTag",
                        "projects.title", "projects.activeSection", "projects.deferredSection", "projects.closed",
                        "projects.noArea", "projects.empty", "list.noTasks", "projects.noNextAction",
                        "projects.addPlaceholder", "projects.add", "projects.tagFilter", "projects.allTags", "projects.noTags", "projects.emptyTag",
                        "filters.show", "filters.hide", "projects.areaLabel",
                        "projects.areaAvailableSelectToAssign", "common.add",
                        "taskEdit.details", "projects.statusLabel", "projects.projectTypeLabel", "projects.sequentialScope",
                        "projects.sequentialAcrossSections", "projects.sequentialWithinSections",
                        "projects.projectTypeHelpText", "projects.sequentialScopeHelpText",
                        "projects.sectionsLabel", "projects.addSection", "projects.sectionPlaceholder", "projects.deleteSectionConfirm", "settings.manage", "taskEdit.tagsLabel", "taskEdit.startDateLabel", "taskEdit.dueDateLabel",
                        "projects.reviewAt", "common.none",
                        "project.notes",
                        "areas.manage", "areas.nameExists", "projects.manageAreas", "projects.changeColor", "projects.colorNone",
                        "projects.sortByName", "projects.sortByColor", "projects.moveUp", "projects.moveDown", "projects.areaInUse",
                        "common.delete",
                        "projects.addToFocus", "projects.removeFromFocus", "projects.actionsLabel", "waiting.title",
                        "someday.title", "common.search", "filters.contexts", "filters.projects", "filters.timeEstimate",
                        "filters.more", "filters.priority", "filters.remove", "filters.active", "filters.clear", "taskEdit.energyLevel",
                        "taskEdit.locationLabel", "taskEdit.locationPlaceholder", "reference.title", "nav.history", "nav.trash",
                        "filters.matchAny", "filters.contextMatchMode", "filters.tagMatchMode",
                        "sort.label", "list.groupBy", "taskEdit.moreOptions", "dailyReview.completeDesc",
                        "settings.feedback.saveFailed", "settings.feedback.actionFailed"]
            strings = try await query("strings", [try json(keys)]).object("strings")
            theme = try await query("theme", [storedTheme])
            if boardRecoveredResult != nil { selectedSurface = .board }
            if calendarComposerRecoveredResult != nil { selectedSurface = .calendar }
            if mindSweepRecoveredResult != nil { selectedSurface = .inbox }
            try await readSelectedSurface()
            ready = true
            retryNeeded = false
            if let result = boardRecoveredResult {
                boardTaskOpened = presentAcknowledgedBoardTask(result)
                boardRecoveredResult = nil
            }
            if let result = calendarComposerRecoveredResult {
                await acknowledgeCalendarComposerSave(result)
                calendarComposerRecoveredResult = nil
            }
            mindSweepRecoveredResult = nil
        } catch {
            self.error = error.localizedDescription
        }
        #else
        error = "This build is not enabled for physical-device testing."
        #endif
    }

    func refresh() async {
        if selectedSurface == .project { guard await flushProjectNotesEdit() else { return } }
        guard ready, !retryNeeded, !capturePresented, !taskPresented, !calendarItemPresented,
              !calendarComposerPresented, !mindSweepPresented, !processInboxPresented,
              !projectRenameEditing else { return }
        guard !busy else { refreshRequested = true; return }
        busy = true
        defer { finishOperation() }
        do {
            theme = try await query("theme", [storedTheme])
            try await readSelectedSurface()
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func selectSurface(_ surface: Surface) async {
        if selectedSurface == .project { guard await flushProjectNotesEdit() else { return } }
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented,
              !calendarComposerPresented, !mindSweepPresented, !processInboxPresented,
              !projectRenameEditing else { return }
        morePresented = false
        guard selectedSurface != surface else { return }
        projectTaskOrderPresented = false
        projectTaskOrderCurrent = false
        focusOrderPresented = false
        focusOrderCurrent = false
        selectedSurface = surface
        await refresh()
    }

    func toggleMore() async {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented,
              !calendarComposerPresented, !mindSweepPresented, !processInboxPresented,
              !projectRenameEditing else { return }
        if morePresented { morePresented = false; return }
        busy = true
        defer { finishOperation() }
        do {
            moreMenu = try await query("menuRead", ["more", "{}"])
            morePresented = true
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func closeMore() {
        guard !busy, !retryNeeded else { return }
        morePresented = false
    }

    func openProjects() async {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented,
              !projectRenameEditing else { return }
        morePresented = false
        selectedSurface = .projects
        await refresh()
    }

    func setProjectCreateTitle(_ value: String) {
        guard projectCreateInputEnabled else { return }
        projectCreateTitle = value
        projectCreateError = nil
    }

    func selectProjectCreateArea(_ id: String?) {
        guard projectCreateInputEnabled else { return }
        if let id {
            guard projectCreateOptions.objects("areas").contains(where: { $0.text("id") == id }) else { return }
        }
        projectCreateAreaID = id
        projectCreateError = nil
    }

    func toggleProjectTagFilter() {
        guard projectTagFilterInputEnabled else { return }
        projectTagFilterShown.toggle()
    }

    func selectProjectTagFilter(_ value: String) async {
        guard projectTagFilterInputEnabled,
              value == "__all__" || (value == "__none__" && projectTagHasUntagged)
                  || projectTagValues.contains(where: { $0.utf8.elementsEqual(value.utf8) }) else { return }
        guard !projectTagIsSelected(value) else { return }
        pendingProjectTagFilter = value
        busy = true
        defer { finishOperation() }
        do {
            try await readProjectsWithCreateOptions()
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func beginProjectCreate() -> Bool {
        guard projectCreateCanSubmit else { return false }
        let id = UUID().uuidString.lowercased()
        let request: String
        do {
            request = try json(["requestId": id, "title": projectCreateTitle,
                                "areaId": projectCreateAreaID as Any? ?? NSNull()])
        } catch {
            projectCreateError = error.localizedDescription
            return false
        }
        projectCreateRequest = request
        projectCreateRequestID = id
        busy = true
        projectCreateError = nil
        error = nil
        return true
    }

    func addProject() async {
        guard busy, let request = projectCreateRequest else { return }
        defer { finishOperation() }
        let result: CoreObject
        do { result = try await query("projectCreate", [request]) }
        catch { await handleProjectCreateWriteError(error); return }
        do { try acknowledgeProjectCreate(result, retrying: false) }
        catch { await handleProjectCreateWriteError(error); return }
        do { try await readSelectedSurface() }
        catch {
            // The write was acknowledged and its UUID must never be submitted
            // again merely because the subsequent list/options read failed.
            projectCreateReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    func retryProjectCreateRead() async {
        guard ready, selectedSurface == .projects, !busy, !retryNeeded, projectCreateRequest == nil else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await readSelectedSurface()
            projectCreateReadError = nil
            error = nil
        } catch {
            projectCreateReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeProjectCreate(_ result: CoreObject, retrying: Bool) throws {
        guard let id = projectCreateRequestID, projectCreateRequest != nil,
              result.count == 2, let created = result["created"] as? Bool,
              !result.text("id").isEmpty else {
            throw CocoaError(.coderReadCorrupt)
        }
        guard created ? result.text("id") == id : (!retrying || result.text("id") == id) else {
            throw CocoaError(.coderReadCorrupt)
        }
        projectCreateRequest = nil
        projectCreateRequestID = nil
        retryNeeded = false
        projectCreateTitle = ""
        projectCreateAreaID = projectCreateOptions["defaultAreaId"] as? String
        projectCreateError = nil
        projectCreateReadError = nil
        error = nil
    }

    private func handleProjectCreateWriteError(_ failure: Error) async {
        if projectCreateRequest != nil && isDefiniteRejection(failure) {
            projectCreateRequest = nil
            projectCreateRequestID = nil
            retryNeeded = false
            projectCreateError = failure.localizedDescription
            error = nil
            do { try await readProjectCreateOptions() }
            catch { projectCreateReadError = error.localizedDescription }
        } else {
            retryNeeded = projectCreateRequest != nil
            projectCreateError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    private func readProjectCreateOptions() async throws {
        projectCreateOptionsCurrent = false
        let options = try await query("projectCreateOptions")
        guard !options.text("revision").isEmpty, !options.text("areaFilterValue").isEmpty,
              !options.text("noAreaLabel").isEmpty,
              options["defaultAreaId"] is NSNull || options["defaultAreaId"] is String,
              let areas = options["areas"] as? [CoreObject],
              areas.allSatisfy({ !$0.text("id").isEmpty && !$0.text("label").isEmpty
                  && ($0["color"] is NSNull || $0["color"] is String) }) else {
            throw CocoaError(.coderReadCorrupt)
        }
        let token = options.text("areaFilterValue")
        if projectCreateAreaFilterValue == nil || projectCreateAreaFilterValue != token {
            projectCreateAreaID = options["defaultAreaId"] as? String
        }
        projectCreateAreaFilterValue = token
        projectCreateOptions = options
        projectCreateOptionsCurrent = true
        projectCreateReadError = nil
    }

    private func readProjectsWithCreateOptions() async throws {
        projectCreateOptionsCurrent = false
        do {
            let requested = pendingProjectTagFilter ?? selectedProjectTagFilter
            let next = try await query("menuRead", ["projects", try json(["tagFilter": requested])])
            let inventory = next.object("tagInventory")
            guard let returned = next["tagFilter"] as? String,
                  returned.utf16.count <= 100_000, returned.utf8.elementsEqual(requested.utf8),
                  inventory.count == 2, let values = inventory["values"] as? [String],
                  values.count <= 100_000, values.allSatisfy({ $0.utf16.count <= 100_000 }),
                  inventory["hasUntagged"] is Bool else { throw CocoaError(.coderReadCorrupt) }
            try await readProjectCreateOptions()
            projects = next
            selectedProjectTagFilter = requested
            pendingProjectTagFilter = nil
            projectFocusReadError = nil
        } catch {
            projectCreateReadError = error.localizedDescription
            throw error
        }
    }

    func dismissTaskFocusNotice() { taskFocusNotice = [:] }

    func taskFocusInputEnabled(_ row: CoreObject, checkingCurrentRow: Bool = false) -> Bool {
        guard ready, !busy, !retryNeeded, taskFocusRequest == nil, !taskPresented,
              !capturePresented, !areaPickerPresented, !morePresented, !projectRenameEditing,
              !row.flag("readOnly"), row.object("meta").flag("canFocus") else { return false }
        let rows: [CoreObject]
        switch selectedSurface {
        case .focus:
            guard focusActionsEnabled else { return false }
            rows = checkingCurrentRow ? focus.objects("sections").flatMap { $0.objects("rows") } : []
        case .review:
            guard reviewActionsEnabled, reviewGuidePresented, reviewKind == "daily",
                  reviewGuide.object("content").text("step") == "focus" else { return false }
            rows = checkingCurrentRow ? reviewRows : []
        default: return false
        }
        guard checkingCurrentRow else { return true }
        return rows.contains {
            $0.text("id").utf8.elementsEqual(row.text("id").utf8) && !$0.flag("readOnly")
                && $0.text("title").utf8.elementsEqual(row.text("title").utf8)
                && $0.text("status") == row.text("status")
                && $0.flag("isFocusedToday") == row.flag("isFocusedToday")
        }
    }

    func setTaskFocus(_ displayed: CoreObject) async {
        guard taskFocusInputEnabled(displayed, checkingCurrentRow: true) else { return }
        busy = true
        taskFocusNotice = [:]
        error = nil
        defer { finishOperation() }
        do {
            let id = displayed.text("id")
            let options = try await query("taskFocusOptions", [try json(["taskId": id])])
            let task = options.object("task")
            let action = options.object("action")
            let strictBool: (Any?) -> Bool = { value in
                guard let number = value as? NSNumber else { return false }
                return CFGetTypeID(number) == CFBooleanGetTypeID()
            }
            guard options.count == 4, !options.text("revision").isEmpty, strictBool(options["canChange"]),
                  task.count == 7, task.text("id").utf8.elementsEqual(id.utf8),
                  task["title"] is String, !task.text("status").isEmpty, strictBool(task["isFocusedToday"]),
                  task["rev"] is NSNull || (task["rev"] is Int && !strictBool(task["rev"])),
                  task["revBy"] is String || task["revBy"] is NSNull,
                  !task.text("updatedAt").isEmpty, action.count == 5, strictBool(action["canToggle"]),
                  action["blockedReason"] is String || action["blockedReason"] is NSNull,
                  action["blocked"] is String || action["blocked"] is NSNull,
                  action["label"] is String, action["blockedTitle"] is String else {
                throw CocoaError(.coderReadCorrupt)
            }
            guard options.flag("canChange"),
                  task.text("title").utf8.elementsEqual(displayed.text("title").utf8),
                  task.text("status") == displayed.text("status"),
                  task.flag("isFocusedToday") == displayed.flag("isFocusedToday") else {
                try await readSelectedSurface()
                return
            }
            guard action.flag("canToggle") else {
                taskFocusNotice = ["title": action.text("blockedTitle"), "message": action.text("blocked")]
                return
            }
            let desired = !task.flag("isFocusedToday")
            var expected = task
            expected.removeValue(forKey: "id")
            let request = try json(["requestId": UUID().uuidString.lowercased(), "taskId": id,
                                    "focused": desired, "expected": expected])
            taskFocusRequest = request
            taskFocusExpectedID = id
            taskFocusDesired = desired
            let result = try await query("taskFocusWrite", [request])
            try acknowledgeTaskFocus(result)
            try await readSelectedSurface()
        } catch { await handleTaskFocusWriteError(error) }
    }

    private func acknowledgeTaskFocus(_ result: CoreObject) throws {
        guard taskFocusRequest != nil, let id = taskFocusExpectedID, let desired = taskFocusDesired else {
            throw CocoaError(.coderReadCorrupt)
        }
        if result.count == 2, let blocked = result["blocked"] as? String,
           let title = result["blockedTitle"] as? String {
            taskFocusNotice = ["title": title, "message": blocked]
        } else {
            guard result.count == 2, result.text("id").utf8.elementsEqual(id.utf8),
                  let focused = result["focused"] as? NSNumber,
                  CFGetTypeID(focused) == CFBooleanGetTypeID(), focused.boolValue == desired else {
                throw CocoaError(.coderReadCorrupt)
            }
            focusCurrent = false
            focusNeedsRead = true
        }
        taskFocusRequest = nil
        taskFocusExpectedID = nil
        taskFocusDesired = nil
        retryNeeded = false
        error = nil
    }

    private func handleTaskFocusWriteError(_ failure: Error) async {
        if taskFocusRequest != nil && isDefiniteRejection(failure) {
            taskFocusRequest = nil
            taskFocusExpectedID = nil
            taskFocusDesired = nil
            retryNeeded = false
            do { try await readSelectedSurface() }
            catch { self.error = error.localizedDescription; return }
        } else { retryNeeded = taskFocusRequest != nil }
        error = failure.localizedDescription
    }

    func setProjectFocus(_ displayed: CoreObject) async {
        guard projectFocusInputEnabled, !displayed.text("id").isEmpty else { return }
        busy = true
        projectFocusError = nil
        defer { finishOperation() }
        let id = displayed.text("id")
        let selected: CoreObject
        do {
            let options = try await query("projectFocusOptions", [try json(["projectId": id])])
            let project = options.object("project")
            guard options.count == 4, !options.text("revision").isEmpty,
                  project.count == 7, project.text("id") == id,
                  project["title"] is String, !project.text("status").isEmpty,
                  !project.text("updatedAt").isEmpty,
                  let focused = project["isFocused"] as? NSNumber,
                  CFGetTypeID(focused) == CFBooleanGetTypeID(),
                  project["rev"] is Int || project["rev"] is NSNull,
                  project["revBy"] is String || project["revBy"] is NSNull,
                  let count = options["focusedProjectCount"] as? NSNumber,
                  let limit = options["limit"] as? NSNumber,
                  CFGetTypeID(count) != CFBooleanGetTypeID(),
                  CFGetTypeID(limit) != CFBooleanGetTypeID(),
                  count.doubleValue.isFinite, count.doubleValue >= 0,
                  count.doubleValue.rounded(.towardZero) == count.doubleValue,
                  limit.doubleValue.isFinite, limit.doubleValue > 0,
                  limit.doubleValue.rounded(.towardZero) == limit.doubleValue else {
                throw CocoaError(.coderReadCorrupt)
            }
            selected = project
        } catch {
            projectFocusReadError = error.localizedDescription
            do { try await readSelectedSurface() }
            catch { projectFocusReadError = error.localizedDescription }
            return
        }
        guard selected.text("title") == displayed.text("title"),
              selected.text("status") == displayed.text("status"),
              selected.flag("isFocused") == displayed.flag("isFocused") else {
            do { try await readSelectedSurface() }
            catch { projectFocusReadError = error.localizedDescription }
            return
        }
        let desired = !displayed.flag("isFocused")
        let request: String
        do {
            let expected: CoreObject = ["title": selected.text("title"), "status": selected.text("status"),
                                        "isFocused": selected["isFocused"]!, "rev": selected["rev"]!,
                                        "revBy": selected["revBy"]!, "updatedAt": selected.text("updatedAt")]
            request = try json(["requestId": UUID().uuidString.lowercased(), "projectId": id,
                                "focused": desired, "expected": expected])
            projectFocusRequest = request
            projectFocusExpectedID = id
            projectFocusDesired = desired
        } catch {
            projectFocusReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectFocusWrite", [request]) }
        catch { await handleProjectFocusWriteError(error); return }
        do { try acknowledgeProjectFocus(result) }
        catch { await handleProjectFocusWriteError(error); return }
        do { try await readSelectedSurface() }
        catch {
            projectFocusReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeProjectFocus(_ result: CoreObject) throws {
        guard projectFocusRequest != nil, let id = projectFocusExpectedID,
              let desired = projectFocusDesired else { throw CocoaError(.coderReadCorrupt) }
        let blocked = result.count == 1 && result["blocked"] as? String == ""
        if !blocked {
            guard result.count == 2, result.text("id") == id,
                  let focused = result["focused"] as? NSNumber,
                  CFGetTypeID(focused) == CFBooleanGetTypeID(), focused.boolValue == desired else {
                throw CocoaError(.coderReadCorrupt)
            }
            focusCurrent = false
            focusNeedsRead = true
        }
        projectFocusRequest = nil
        projectFocusExpectedID = nil
        projectFocusDesired = nil
        retryNeeded = false
        projectFocusError = nil
        projectFocusReadError = nil
        error = nil
    }

    private func handleProjectFocusWriteError(_ failure: Error) async {
        if projectFocusRequest != nil && isDefiniteRejection(failure) {
            projectFocusRequest = nil
            projectFocusExpectedID = nil
            projectFocusDesired = nil
            retryNeeded = false
            projectFocusError = failure.localizedDescription
            error = nil
            do { try await readSelectedSurface() }
            catch { projectFocusReadError = error.localizedDescription }
        } else {
            retryNeeded = projectFocusRequest != nil
            projectFocusError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    func retryProjectFocusRead() async {
        guard ready, selectedSurface == .projects, !areaManagerPresented, !busy, !retryNeeded,
              projectFocusRequest == nil else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await readSelectedSurface()
            projectFocusReadError = nil
            error = nil
        } catch { projectFocusReadError = error.localizedDescription }
    }

    func openProjectRename() async {
        guard await flushProjectNotesEdit() else { return }
        guard projectRenameOpenEnabled, !projectHeader.text("id").isEmpty else { return }
        busy = true
        projectRenameError = nil
        defer { finishOperation() }
        let visibleTitle = projectHeader.text("title")
        let visibleStatus = projectHeader.text("status")
        do {
            try await readProjectRenameOptions()
            if projectHeader.text("title") != visibleTitle
                || (!visibleStatus.isEmpty && projectHeader.text("status") != visibleStatus) {
                try await readSelectedSurface()
                return
            }
            guard projectRenameOptions.flag("canRename") else { return }
            projectRenameTitle = visibleTitle
            projectRenameEditing = true
        } catch {
            projectRenameReadError = error.localizedDescription
            do { try await readSelectedSurface() }
            catch { projectRenameReadError = error.localizedDescription }
        }
    }

    func setProjectRenameTitle(_ value: String) {
        guard projectRenameInputEnabled, value != projectRenameTitle else { return }
        projectRenameTitle = value
        projectRenameError = nil
    }

    func cancelProjectRename() {
        guard projectRenameEditing, !busy, !retryNeeded, projectRenameRequest == nil else { return }
        projectRenameEditing = false
        projectRenameTitle = ""
        projectRenameError = nil
        projectRenameOptionsCurrent = false
    }

    func saveProjectRename() async {
        guard projectRenameCanSave else { return }
        busy = true
        projectRenameError = nil
        defer { finishOperation() }
        let project = projectRenameOptions.object("project")
        let id = project.text("id")
        let request: String
        do {
            let expected: CoreObject = ["title": project.text("title"), "status": project.text("status"),
                                        "rev": project["rev"]!, "revBy": project["revBy"]!,
                                        "updatedAt": project.text("updatedAt")]
            request = try json(["requestId": UUID().uuidString.lowercased(), "projectId": id,
                                "title": projectRenameTitle, "expected": expected])
            projectRenameRequest = request
            projectRenameExpectedID = id
        } catch {
            projectRenameError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectRenameWrite", [request]) }
        catch { await handleProjectRenameWriteError(error); return }
        do { try acknowledgeProjectRename(result) }
        catch { await handleProjectRenameWriteError(error); return }
        do { try await refreshProjectRenameAfterWrite() }
        catch {
            projectRenameReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeProjectRename(_ result: CoreObject) throws {
        guard projectRenameRequest != nil, let id = projectRenameExpectedID else {
            throw CocoaError(.coderReadCorrupt)
        }
        let blocked = result.count == 1 && result["blocked"] as? String == ""
        if !blocked {
            guard result.count == 2, result.text("id") == id,
                  let title = result["title"] as? String else { throw CocoaError(.coderReadCorrupt) }
            projectHeader["title"] = title
        }
        projectRenameRequest = nil
        projectRenameExpectedID = nil
        projectRenameOptionsCurrent = false
        projectRenameEditing = false
        projectRenameTitle = ""
        retryNeeded = false
        projectRenameError = nil
        projectRenameReadError = nil
        error = nil
    }

    private func handleProjectRenameWriteError(_ failure: Error) async {
        if projectRenameRequest != nil && isDefiniteRejection(failure) {
            projectRenameRequest = nil
            projectRenameExpectedID = nil
            projectRenameOptionsCurrent = false
            retryNeeded = false
            projectRenameError = failure.localizedDescription
            error = nil
            do { try await refreshProjectRenameAfterWrite() }
            catch { projectRenameReadError = error.localizedDescription }
        } else {
            retryNeeded = projectRenameRequest != nil
            projectRenameError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    private func readProjectRenameOptions() async throws {
        projectRenameOptionsCurrent = false
        let id = projectHeader.text("id")
        let options = try await query("projectRenameOptions", [try json(["projectId": id])])
        let project = options.object("project")
        guard options.count == 3, !options.text("revision").isEmpty,
              let canRename = options["canRename"] as? NSNumber,
              CFGetTypeID(canRename) == CFBooleanGetTypeID(),
              project.count == 6, project.text("id") == id,
              project["title"] is String, !project.text("status").isEmpty,
              !project.text("updatedAt").isEmpty,
              project["rev"] is Int || project["rev"] is NSNull,
              project["revBy"] is String || project["revBy"] is NSNull else {
            throw CocoaError(.coderReadCorrupt)
        }
        projectHeader["title"] = project.text("title")
        projectHeader["status"] = project.text("status")
        projectRenameOptions = options
        projectRenameOptionsCurrent = true
        projectRenameReadError = nil
        if !canRename.boolValue && projectRenameEditing {
            projectRenameEditing = false
            projectRenameTitle = ""
        }
    }

    private func refreshProjectRenameAfterWrite() async throws {
        try await readProjectRenameOptions()
        try await readSelectedSurface()
    }

    func retryProjectRenameRead() async {
        guard ready, selectedSurface == .project, !busy, !retryNeeded,
              projectRenameRequest == nil else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await refreshProjectRenameAfterWrite()
            projectRenameReadError = nil
            error = nil
        } catch { projectRenameReadError = error.localizedDescription }
    }

    func toggleProjectType() async {
        await changeProjectFlow(["kind": "toggleType"])
    }

    func setProjectScope(_ scope: String) async {
        guard scope == "project" || scope == "section" else { return }
        await changeProjectFlow(["kind": "setScope", "scope": scope])
    }

    private func changeProjectFlow(_ action: CoreObject) async {
        guard await flushProjectNotesEdit() else { return }
        guard projectFlowInputEnabled else { return }
        let id = projectHeader.text("id")
        let visibleRevision = projectDetail.text("mutationRevision")
        guard !id.isEmpty, projectDetail.text("projectId") == id, !visibleRevision.isEmpty else { return }
        busy = true
        projectFlowError = nil
        defer { finishOperation() }
        let options: CoreObject
        let project: CoreObject
        do {
            options = try await query("projectFlowOptions", [try json(["projectId": id])])
            project = options.object("project")
            guard options.count == 3, !options.text("revision").isEmpty,
                  let canChange = options["canChange"] as? NSNumber,
                  CFGetTypeID(canChange) == CFBooleanGetTypeID(),
                  project.count == 8, project.text("id") == id,
                  project["title"] is String, !project.text("status").isEmpty,
                  !project.text("updatedAt").isEmpty,
                  project["rev"] is Int || project["rev"] is NSNull,
                  project["revBy"] is String || project["revBy"] is NSNull,
                  project["isSequential"] is NSNull ||
                    (project["isSequential"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true,
                  project["sequentialScope"] is NSNull ||
                    ["project", "section"].contains(project["sequentialScope"] as? String ?? "") else {
                throw CocoaError(.coderReadCorrupt)
            }
            guard options.text("revision") == visibleRevision,
                  projectDetail.text("mutationRevision") == visibleRevision,
                  projectDetail.text("projectId") == id,
                  projectHeader.text("id") == id, projectCurrent else {
                try await refreshProjectFlowAfterWrite()
                return
            }
            guard canChange.boolValue else {
                try await refreshProjectFlowAfterWrite()
                return
            }
        } catch {
            projectFlowReadError = error.localizedDescription
            return
        }
        let request: String
        do {
            let expected: CoreObject = [
                "title": project.text("title"), "status": project.text("status"),
                "isSequential": project["isSequential"]!, "sequentialScope": project["sequentialScope"]!,
                "rev": project["rev"]!, "revBy": project["revBy"]!, "updatedAt": project.text("updatedAt")
            ]
            let beforeSequential = (project["isSequential"] as? NSNumber)?.boolValue ?? false
            let afterSequential = action.text("kind") == "toggleType" ? !beforeSequential : beforeSequential
            let afterScope: Any = action.text("kind") == "setScope"
                ? action.text("scope") : project["sequentialScope"]!
            request = try json(["requestId": UUID().uuidString.lowercased(), "projectId": id,
                                "action": action, "expected": expected])
            projectFlowRequest = request
            projectFlowExpectedResult = ["id": id, "isSequential": afterSequential,
                                         "sequentialScope": afterScope]
        } catch {
            projectFlowReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectFlowWrite", [request]) }
        catch { await handleProjectFlowWriteError(error); return }
        do { try acknowledgeProjectFlow(result) }
        catch { await handleProjectFlowWriteError(error); return }
        do { try await refreshProjectFlowAfterWrite() }
        catch {
            projectFlowReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeProjectFlow(_ result: CoreObject) throws {
        guard projectFlowRequest != nil, let expected = projectFlowExpectedResult else {
            throw CocoaError(.coderReadCorrupt)
        }
        let blocked = result.count == 1 && result["blocked"] as? String == ""
        if !blocked {
            guard result.count == 3, result.text("id") == expected.text("id"),
                  let sequential = result["isSequential"] as? NSNumber,
                  CFGetTypeID(sequential) == CFBooleanGetTypeID(),
                  sequential.boolValue == expected.flag("isSequential"),
                  result["sequentialScope"] is NSNull ||
                    ["project", "section"].contains(result["sequentialScope"] as? String ?? ""),
                  (result["sequentialScope"] as? String) == (expected["sequentialScope"] as? String) else {
                throw CocoaError(.coderReadCorrupt)
            }
        }
        projectFlowRequest = nil
        projectFlowExpectedResult = nil
        retryNeeded = false
        projectFlowError = nil
        projectFlowReadError = nil
        error = nil
    }

    private func handleProjectFlowWriteError(_ failure: Error) async {
        if projectFlowRequest != nil && isDefiniteRejection(failure) {
            projectFlowRequest = nil
            projectFlowExpectedResult = nil
            retryNeeded = false
            projectFlowError = failure.localizedDescription
            error = nil
            do { try await refreshProjectFlowAfterWrite() }
            catch { projectFlowReadError = error.localizedDescription }
        } else {
            retryNeeded = projectFlowRequest != nil
            projectFlowError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    private func refreshProjectFlowAfterWrite() async throws {
        try await readSelectedSurface()
        guard selectedSurface == .project, projectCurrent,
              projectDetail.text("projectId") == projectHeader.text("id") else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    func retryProjectFlowRead() async {
        guard ready, selectedSurface == .project, !busy, !retryNeeded,
              projectFlowRequest == nil else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await refreshProjectFlowAfterWrite()
            projectFlowReadError = nil
            error = nil
        } catch { projectFlowReadError = error.localizedDescription }
    }

    func openProjectTaskOrder() async {
        guard await flushProjectNotesEdit(), projectViewOptionsPresented, projectTaskOrderOpenEnabled else { return }
        projectViewOptionsPresented = false
        projectTaskOrderPresented = true
        busy = true
        defer { finishOperation() }
        await readProjectTaskOrder()
    }

    func closeProjectTaskOrder() async {
        guard await flushProjectNotesEdit(), !busy, !retryNeeded, !projectTaskOrderPending else { return }
        projectTaskOrderPresented = false
        projectTaskOrderCurrent = false
        projectTaskOrderView = [:]
        projectTaskOrderError = nil
        await refresh()
    }

    func retryProjectTaskOrderRead() async {
        guard ready, selectedSurface == .project, projectTaskOrderPresented,
              !busy, !retryNeeded, !projectTaskOrderPending else { return }
        busy = true
        defer { finishOperation() }
        await readProjectDetail()
        await readProjectTaskOrder()
    }

    private func readProjectTaskOrder() async {
        projectTaskOrderCurrent = false
        let id = projectHeader.text("id")
        let session = projectFilterSession
        let filters = projectDetail.object("filters").object("state")
        for attempt in 0..<2 {
            do {
                func page(_ offset: Int, revision: String? = nil) async throws -> CoreObject {
                    var input: CoreObject = ["projectId": id, "offset": offset, "limit": pageSize,
                                            "showCompleted": projectShowCompleted, "filters": filters]
                    if let revision { input["revision"] = revision }
                    return try await query("menuRead", ["projectTaskOrderView", json(input)])
                }
                var first = try await page(0)
                guard first.text("projectId").utf8.elementsEqual(id.utf8), !first.text("revision").isEmpty,
                      first.number("total") >= 0, first["items"] is [CoreObject],
                      first.objects("items").count == min(pageSize, first.number("total")),
                      !first.text("label").isEmpty, !first.text("doneLabel").isEmpty,
                      !first.flag("canReorder") || !first.text("orderToken").isEmpty else {
                    throw CocoaError(.coderReadCorrupt)
                }
                var items = first.objects("items")
                while items.count < first.number("total") {
                    let next = try await page(items.count, revision: first.text("revision"))
                    guard next.text("revision") == first.text("revision"),
                          next.text("projectId").utf8.elementsEqual(id.utf8),
                          next.number("total") == first.number("total"),
                          next.objects("items").count == min(pageSize, first.number("total") - items.count),
                          next["orderToken"] is NSNull else { throw CocoaError(.coderReadCorrupt) }
                    items += next.objects("items")
                }
                guard Set(items.map(projectTaskOrderItemID)).count == items.count,
                      items.allSatisfy({ item in
                          if item.text("type") == "task" { return !item.object("row").text("id").isEmpty }
                          return item.text("type") == "section" && !item.text("id").isEmpty
                              && (item["sectionId"] is String || item["sectionId"] is NSNull)
                      }) else { throw CocoaError(.coderReadCorrupt) }
                guard projectTaskOrderPresented, selectedSurface == .project, session == projectFilterSession,
                      projectHeader.text("id").utf8.elementsEqual(id.utf8) else { return }
                first["items"] = items
                projectTaskOrderView = first
                projectTaskOrderCurrent = true
                projectTaskOrderError = nil
                return
            } catch {
                guard projectTaskOrderPresented, selectedSurface == .project, session == projectFilterSession,
                      projectHeader.text("id").utf8.elementsEqual(id.utf8) else { return }
                if attempt == 1 { projectTaskOrderError = error.localizedDescription }
            }
        }
    }

    func moveProjectTask(from source: IndexSet, to destination: Int) async {
        guard source.count == 1, let from = source.first, projectTaskOrderInputEnabled,
              await flushProjectNotesEdit() else { return }
        let items = projectTaskOrderView.objects("items")
        guard items.indices.contains(from), items[from].text("type") == "task",
              (0...items.count).contains(destination) else { return }
        var remaining = items
        let moved = remaining.remove(at: from)
        let target = destination > from ? destination - 1 : destination
        guard target != from else { return }
        let predecessor: Any
        if target == 0 { predecessor = NSNull() }
        else {
            let item = remaining[target - 1]
            predecessor = ["type": item.text("type"), "id": item.text("type") == "task"
                ? item.object("row").text("id") : item.text("id")]
        }
        busy = true
        projectTaskOrderError = nil
        defer { finishOperation() }
        do {
            projectTaskOrderRequest = try json(["requestId": UUID().uuidString.lowercased(),
                "projectId": projectHeader.text("id"), "taskId": moved.object("row").text("id"),
                "after": predecessor, "showCompleted": projectShowCompleted,
                "filters": projectTaskOrderView.object("filters"),
                "expectedOrder": projectTaskOrderView.text("orderToken")])
            let result = try await query("projectTaskOrderWrite", [projectTaskOrderRequest!])
            try acknowledgeProjectTaskOrder(result)
            await readProjectDetail()
            await readProjectTaskOrder()
        } catch { await handleProjectTaskOrderError(error) }
    }

    private func acknowledgeProjectTaskOrder(_ result: CoreObject) throws {
        guard let encoded = projectTaskOrderRequest, let data = encoded.data(using: .utf8),
              let request = try JSONSerialization.jsonObject(with: data) as? CoreObject,
              result.count == 3,
              result.text("projectId").utf8.elementsEqual(request.text("projectId").utf8),
              result.text("taskId").utf8.elementsEqual(request.text("taskId").utf8),
              result["sectionId"] is NSNull || result["sectionId"] is String else {
            throw CocoaError(.coderReadCorrupt)
        }
        projectTaskOrderRequest = nil
        projectTaskOrderCurrent = false
        projectTaskOrderError = nil
        retryNeeded = false
        error = nil
    }

    private func handleProjectTaskOrderError(_ failure: Error) async {
        if projectTaskOrderRequest != nil && isDefiniteRejection(failure) {
            projectTaskOrderRequest = nil
            retryNeeded = false
            await readProjectDetail()
            await readProjectTaskOrder()
            projectTaskOrderError = failure.localizedDescription
            error = nil
        } else {
            retryNeeded = projectTaskOrderRequest != nil
            projectTaskOrderError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    func openProjectTaskSort() async {
        guard await flushProjectNotesEdit(), projectViewOptionsPresented, projectTaskSortInputEnabled else { return }
        projectViewOptionsPresented = false
        projectTaskSortPresented = true
    }

    func closeProjectTaskSort() {
        guard !busy, !retryNeeded, !projectTaskSortPending else { return }
        projectTaskSortPresented = false
    }

    private func readProjectTaskSortOptions(projectID: String, revision: String) async throws -> CoreObject {
        let options = try await query("projectTaskSortOptions", [try json(["projectId": projectID])])
        let project = options.object("project")
        let choices = options.objects("choices")
        let sorts = ["default", "due", "start", "review", "timeEstimate", "title", "created", "created-desc"]
        guard options.count == 6, options.text("revision") == revision, !revision.isEmpty,
              let canEdit = options["canEdit"] as? NSNumber, CFGetTypeID(canEdit) == CFBooleanGetTypeID(),
              project.count == 7, project.text("id") == projectID, project["title"] is String,
              !project.text("status").isEmpty, !project.text("updatedAt").isEmpty,
              project["rev"] is Int || project["rev"] is NSNull,
              project["revBy"] is String || project["revBy"] is NSNull,
              project["taskSortBy"] is NSNull || (sorts + ["completed"]).contains(project.text("taskSortBy")),
              !choices.isEmpty, Set(choices.map { $0.text("id") }).count == choices.count,
              choices.allSatisfy({ choice in
                  choice.count == 3 && sorts.contains(choice.text("id")) && !choice.text("label").isEmpty
                    && (choice["selected"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true
              }), choices.filter({ $0.flag("selected") }).count == 1,
              choices.first(where: { $0.flag("selected") })?.text("id") == options.text("effectiveSortBy"),
              !options.text("label").isEmpty else { throw CocoaError(.coderReadCorrupt) }
        return options
    }

    func setProjectTaskSort(_ sortBy: String) async {
        guard await flushProjectNotesEdit(), projectTaskSortPresented, projectTaskSortInputEnabled,
              projectTaskSortOptions.objects("choices").contains(where: { $0.text("id") == sortBy }) else { return }
        busy = true
        projectTaskSortError = nil
        defer { finishOperation() }
        let id = projectHeader.text("id")
        do {
            let options = try await readProjectTaskSortOptions(projectID: id, revision: projectDetail.text("mutationRevision"))
            guard options.flag("canEdit"), options.objects("choices").contains(where: { $0.text("id") == sortBy }) else {
                try await refreshProjectFlowAfterWrite()
                return
            }
            var expected = options.object("project")
            expected.removeValue(forKey: "id")
            projectTaskSortRequest = try json(["requestId": UUID().uuidString.lowercased(), "projectId": id,
                                              "sortBy": sortBy, "expected": expected])
            projectTaskSortExpectedResult = ["id": id, "taskSortBy": sortBy == "default" ? NSNull() : sortBy as Any]
        } catch {
            projectTaskSortReadError = error.localizedDescription
            return
        }
        do {
            let result = try await query("projectTaskSortWrite", [projectTaskSortRequest!])
            try acknowledgeProjectTaskSort(result)
        } catch { await handleProjectTaskSortWriteError(error); return }
        do { try await refreshProjectFlowAfterWrite() }
        catch { projectTaskSortReadError = error.localizedDescription }
    }

    private func acknowledgeProjectTaskSort(_ result: CoreObject) throws {
        guard projectTaskSortRequest != nil, let expected = projectTaskSortExpectedResult else {
            throw CocoaError(.coderReadCorrupt)
        }
        let blocked = result.count == 1 && result["blocked"] as? String == ""
        if !blocked {
            guard result.count == 2, result.text("id") == expected.text("id"),
                  result["taskSortBy"] is String || result["taskSortBy"] is NSNull,
                  (result["taskSortBy"] as? String) == (expected["taskSortBy"] as? String) else {
                throw CocoaError(.coderReadCorrupt)
            }
        }
        projectTaskSortRequest = nil
        projectTaskSortExpectedResult = nil
        projectTaskSortPresented = false
        retryNeeded = false
        projectTaskSortError = nil
        projectTaskSortReadError = nil
        error = nil
    }

    private func handleProjectTaskSortWriteError(_ failure: Error) async {
        if projectTaskSortRequest != nil && isDefiniteRejection(failure) {
            projectTaskSortRequest = nil
            projectTaskSortExpectedResult = nil
            retryNeeded = false
            projectTaskSortError = failure.localizedDescription
            error = nil
            do { try await refreshProjectFlowAfterWrite() }
            catch { projectTaskSortReadError = error.localizedDescription }
        } else {
            retryNeeded = projectTaskSortRequest != nil
            projectTaskSortError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    func retryProjectTaskSortRead() async {
        guard ready, selectedSurface == .project, !busy, !retryNeeded, !projectTaskSortPending else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await refreshProjectFlowAfterWrite()
            projectTaskSortReadError = nil
            error = nil
        } catch { projectTaskSortReadError = error.localizedDescription }
    }

    func openProjectStatus() async {
        let id = projectHeader.text("id")
        let close = projectStatusOpen
        guard await flushProjectNotesEdit() else { return }
        guard projectStatusOpenEnabled, projectHeader.text("id") == id else { return }
        if close { projectStatusOpen = false; return }
        projectStatusOpen = true
        busy = true
        defer { finishOperation() }
        do { try await readProjectStatusOptions() }
        catch { projectStatusReadError = error.localizedDescription }
    }

    func closeProjectStatusSelector() { projectStatusOpen = false }

    private func readProjectStatusOptions() async throws {
        projectStatusOptionsCurrent = false
        let id = projectHeader.text("id")
        guard selectedSurface == .project, projectCurrent, projectDetail.text("projectId") == id,
              !id.isEmpty else { throw CocoaError(.coderReadCorrupt) }
        for attempt in 0..<2 {
            let options = try await query("projectStatusOptions", [try json(["projectId": id])])
            let canChange = try validatedProjectStatusOptions(options, id: id)
            if options.text("revision") == projectDetail.text("mutationRevision"), projectCurrent,
               projectDetail.text("projectId") == id, projectHeader.text("id") == id {
                projectStatusOptions = options
                projectStatusOptionsCurrent = true
                projectStatusReadError = nil
                projectStatusError = nil
                projectStatusOpen = canChange
                return
            }
            if attempt == 0 {
                await readProjectDetail()
                guard projectCurrent, projectDetail.text("projectId") == id else {
                    throw CocoaError(.coderReadCorrupt)
                }
            }
        }
        throw CocoaError(.coderReadCorrupt)
    }

    private func validatedProjectStatusOptions(_ options: CoreObject, id: String) throws -> Bool {
        let project = options.object("project")
        guard options.count == 3, !options.text("revision").isEmpty,
              let canChange = options["canChange"] as? NSNumber,
              CFGetTypeID(canChange) == CFBooleanGetTypeID(),
              project.count == 8, Data(project.text("id").utf8) == Data(id.utf8),
              project["title"] is String,
              ["active", "waiting", "someday", "archived"].contains(project.text("status")),
              project["isFocused"] is NSNull ||
                (project["isFocused"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true,
              project["cancelledAt"] is String || project["cancelledAt"] is NSNull,
              project["rev"] is Int || project["rev"] is NSNull,
              project["revBy"] is String || project["revBy"] is NSNull,
              !project.text("updatedAt").isEmpty else { throw CocoaError(.coderReadCorrupt) }
        return canChange.boolValue
    }

    func activateDeferredProject(_ id: String) async {
        let origin = selectedSurface
        guard (origin == .waiting && waitingActionsEnabled) || (origin == .someday && somedayActionsEnabled),
              projectStatusRequest == nil,
              let row = (origin == .waiting ? waiting : someday).object("deferred").object("rows")
                .objects("items").first(where: { Data($0.text("id").utf8) == Data(id.utf8) }),
              !id.isEmpty, let title = row["title"] as? String else { return }
        busy = true
        defer { finishOperation() }
        do {
            let options = try await query("projectStatusOptions", [try json(["projectId": id])])
            let canChange = try validatedProjectStatusOptions(options, id: id)
            let project = options.object("project")
            let current = (origin == .waiting ? waiting : someday).object("deferred").object("rows")
                .objects("items").first(where: { Data($0.text("id").utf8) == Data(id.utf8) })
            guard canChange, selectedSurface == origin,
                  (origin == .waiting ? waitingCurrent : somedayCurrent),
                  let current, let currentTitle = current["title"] as? String,
                  Data(currentTitle.utf8) == Data(title.utf8),
                  Data(project.text("title").utf8) == Data(title.utf8),
                  project.text("status") == (origin == .waiting ? "waiting" : "someday") else {
                throw CocoaError(.coderReadCorrupt)
            }
            let expected: CoreObject = [
                "title": project.text("title"), "status": project.text("status"),
                "isFocused": project["isFocused"]!, "cancelledAt": project["cancelledAt"]!,
                "rev": project["rev"]!, "revBy": project["revBy"]!,
                "updatedAt": project.text("updatedAt")
            ]
            projectStatusRequest = try json(["requestId": UUID().uuidString.lowercased(),
                                             "projectId": id, "status": "active", "expected": expected])
            projectStatusExpectedID = id
            projectStatusExpectedStatus = "active"
        } catch let failure {
            do { try await refreshProjectStatusAfterWrite() }
            catch { /* Preserve the original read or stale-target failure in the global banner. */ }
            self.error = failure.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectStatusWrite", [projectStatusRequest!]) }
        catch { await handleProjectStatusWriteError(error); return }
        do { try acknowledgeProjectStatus(result) }
        catch { await handleProjectStatusWriteError(error); return }
        do { try await refreshProjectStatusAfterWrite() }
        catch { self.error = error.localizedDescription }
    }

    func changeProjectStatus(_ status: String) async {
        let id = projectHeader.text("id")
        guard projectStatusOpen else { return }
        guard await flushProjectNotesEdit() else { return }
        guard ["active", "waiting", "someday"].contains(status), projectStatusOpenEnabled,
              projectHeader.text("id") == id else { return }
        busy = true
        projectStatusError = nil
        defer { finishOperation() }
        do {
            if !projectStatusOptionsCurrent ||
                projectStatusOptions.text("revision") != projectDetail.text("mutationRevision") {
                try await readProjectStatusOptions()
            }
            let project = projectStatusOptions.object("project")
            guard projectStatusOptionsCurrent, projectStatusOptions.flag("canChange"),
                  project.text("id") == id, projectDetail.text("projectId") == id,
                  projectStatusOptions.text("revision") == projectDetail.text("mutationRevision") else {
                throw CocoaError(.coderReadCorrupt)
            }
            if project.text("status") == status {
                projectStatusOpen = false
                return
            }
            let expected: CoreObject = [
                "title": project.text("title"), "status": project.text("status"),
                "isFocused": project["isFocused"]!, "cancelledAt": project["cancelledAt"]!,
                "rev": project["rev"]!, "revBy": project["revBy"]!,
                "updatedAt": project.text("updatedAt")
            ]
            projectStatusRequest = try json(["requestId": UUID().uuidString.lowercased(),
                                             "projectId": id, "status": status, "expected": expected])
            projectStatusExpectedID = id
            projectStatusExpectedStatus = status
        } catch {
            projectStatusReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectStatusWrite", [projectStatusRequest!]) }
        catch { await handleProjectStatusWriteError(error); return }
        do { try acknowledgeProjectStatus(result) }
        catch { await handleProjectStatusWriteError(error); return }
        do { try await refreshProjectStatusAfterWrite() }
        catch {
            projectStatusReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeProjectStatus(_ result: CoreObject) throws {
        guard projectStatusRequest != nil, let id = projectStatusExpectedID,
              let status = projectStatusExpectedStatus else { throw CocoaError(.coderReadCorrupt) }
        let blocked = result.count == 1 && result["blocked"] as? String == ""
        if !blocked {
            guard result.count == 3, result.text("id") == id, result.text("status") == status,
                  result["isFocused"] is NSNull ||
                    (result["isFocused"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true else {
                throw CocoaError(.coderReadCorrupt)
            }
        }
        projectStatusRequest = nil
        projectStatusExpectedID = nil
        projectStatusExpectedStatus = nil
        projectStatusOpen = false
        projectStatusOptionsCurrent = false
        retryNeeded = false
        projectStatusError = nil
        projectStatusReadError = nil
        error = nil
        if selectedSurface == .waiting || selectedSurface == .someday {
            if blocked { error = label("settings.feedback.actionFailed") }
            else { NSLog("Native iOS deferred Project reactivated releaseCheck=v1.3.4/ios-deferred-reactivate outcome=confirmed") }
        }
    }

    private func handleProjectStatusWriteError(_ failure: Error) async {
        if projectStatusRequest != nil && isDefiniteRejection(failure) {
            projectStatusRequest = nil
            projectStatusExpectedID = nil
            projectStatusExpectedStatus = nil
            projectStatusOptionsCurrent = false
            retryNeeded = false
            projectStatusError = failure.localizedDescription
            error = selectedSurface == .waiting || selectedSurface == .someday ? failure.localizedDescription : nil
            do { try await refreshProjectStatusAfterWrite() }
            catch { projectStatusReadError = error.localizedDescription }
        } else {
            retryNeeded = projectStatusRequest != nil
            projectStatusError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    private func refreshProjectStatusAfterWrite() async throws {
        try await readSelectedSurface()
        guard (selectedSurface == .project && projectCurrent &&
                projectDetail.text("projectId") == projectHeader.text("id")) ||
              (selectedSurface == .waiting && waitingCurrent) ||
              (selectedSurface == .someday && somedayCurrent) else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    func retryProjectStatusRead() async {
        guard ready, selectedSurface == .project, !busy, !retryNeeded,
              projectStatusRequest == nil else { return }
        let reopen = projectStatusOpen
        busy = true
        defer { finishOperation() }
        do {
            try await refreshProjectStatusAfterWrite()
            if reopen { try await readProjectStatusOptions() }
            projectStatusReadError = nil
            projectStatusError = nil
            error = nil
        } catch { projectStatusReadError = error.localizedDescription }
    }

    func openProjectSections() async {
        let id = projectHeader.text("id")
        guard projectSectionOpenTapEnabled,
              !projectDetail.flag("readOnly") || !projectDetail.object("metadata").objects("sections").isEmpty,
              await flushProjectNotesEdit(), projectHeader.text("id") == id,
              projectSectionOpenTapEnabled, !busy else { return }
        projectSectionsPresented = true
        projectSectionEditing = false
        projectSectionEditID = nil
        projectSectionTitle = ""
        projectSectionError = nil
        projectSectionReadError = nil
        projectSectionDeleteReadyID = nil
        projectSectionDeleteOptions = [:]
        projectSectionDeleteOptionsCurrent = false
        projectSectionOrderOptions = [:]
        projectSectionOrderOptionsCurrent = false
        busy = true
        defer { finishOperation() }
        do {
            try await readProjectSectionOptions(projectID: id)
            try await readProjectSectionOrderOptions(projectID: id)
        }
        catch { projectSectionReadError = error.localizedDescription }
    }

    func closeProjectSections() {
        guard projectSectionCloseEnabled else { return }
        projectSectionsPresented = false
        projectSectionEditing = false
        projectSectionEditID = nil
        projectSectionTitle = ""
        projectSectionError = nil
        projectSectionReadError = nil
        projectSectionOptions = [:]
        projectSectionOptionsCurrent = false
        projectSectionOrderOptions = [:]
        projectSectionOrderOptionsCurrent = false
        projectSectionRenameOptions = [:]
        projectSectionRenameOptionsCurrent = false
        projectSectionDeleteReadyID = nil
        projectSectionDeleteOptions = [:]
        projectSectionDeleteOptionsCurrent = false
    }

    func beginProjectSection() {
        guard projectSectionAddEnabled else { return }
        projectSectionDeleteReadyID = nil
        projectSectionDeleteOptionsCurrent = false
        projectSectionEditing = true
        projectSectionEditID = nil
        projectSectionTitle = ""
        projectSectionError = nil
    }

    func beginProjectSectionRename(_ sectionID: String) async {
        let id = projectHeader.text("id")
        guard projectSectionEditEnabled(sectionID),
              let row = projectSectionRows.first(where: { $0.text("id") == sectionID }) else { return }
        projectSectionDeleteReadyID = nil
        projectSectionDeleteOptionsCurrent = false
        projectSectionRenameOptions = [:]
        projectSectionRenameOptionsCurrent = false
        projectSectionEditID = sectionID
        projectSectionEditing = true
        projectSectionTitle = row.text("title")
        projectSectionError = nil
        projectSectionReadError = nil
        busy = true
        defer { finishOperation() }
        do {
            try await readProjectSectionRenameOptions(projectID: id, sectionID: sectionID)
            // This is the opening read, before the editor becomes enabled. A
            // later explicit Retry never replaces the user's draft.
            if projectSectionEditID == sectionID {
                projectSectionTitle = projectSectionRenameOptions.object("section").text("title")
            }
        } catch { projectSectionReadError = error.localizedDescription }
    }

    func cancelProjectSection() {
        guard projectSectionCloseEnabled else { return }
        projectSectionEditing = false
        projectSectionEditID = nil
        projectSectionTitle = ""
        projectSectionError = nil
        projectSectionReadError = nil
        projectSectionRenameOptions = [:]
        projectSectionRenameOptionsCurrent = false
    }

    func setProjectSectionTitle(_ title: String) {
        guard projectSectionInputEnabled, title != projectSectionTitle else { return }
        projectSectionTitle = String(title.prefix(100_000))
    }

    private func readProjectSectionOptions(projectID id: String) async throws {
        projectSectionOptionsCurrent = false
        guard selectedSurface == .project, projectCurrent,
              projectDetail.text("projectId") == id, projectHeader.text("id") == id,
              !id.isEmpty else { throw CocoaError(.coderReadCorrupt) }
        for attempt in 0..<2 {
            let options = try await query("projectSectionOptions", [try json(["projectId": id])])
            let project = options.object("project")
            guard options.count == 4, !options.text("revision").isEmpty,
                  project.count == 3, project.text("id") == id,
                  project["title"] is String,
                  ["active", "waiting", "someday", "archived"].contains(project.text("status")),
                  let canCreate = options["canCreate"] as? NSNumber,
                  CFGetTypeID(canCreate) == CFBooleanGetTypeID(),
                  canCreate.boolValue == (project.text("status") != "archived"),
                  let sections = options["sections"] as? [CoreObject],
                  sections.allSatisfy({ $0.count == 2 && !$0.text("id").isEmpty && $0["title"] is String }),
                  Set(sections.map { $0.text("id") }).count == sections.count else {
                throw CocoaError(.coderReadCorrupt)
            }
            if options.text("revision") == projectDetail.text("mutationRevision"), projectCurrent,
               projectDetail.text("projectId") == id, projectHeader.text("id") == id {
                projectSectionOptions = options
                projectSectionOptionsCurrent = true
                projectSectionReadError = nil
                return
            }
            if attempt == 0 {
                await readProjectDetail()
                guard projectCurrent, projectDetail.text("projectId") == id else {
                    throw CocoaError(.coderReadCorrupt)
                }
            }
        }
        throw CocoaError(.coderReadCorrupt)
    }

    private func readProjectSectionOrderOptions(projectID id: String) async throws {
        projectSectionOrderOptionsCurrent = false
        guard projectSectionsPresented, projectSectionOptionsFresh, !id.isEmpty else {
            throw CocoaError(.coderReadCorrupt)
        }
        for attempt in 0..<2 {
            let options = try await query("projectSectionOrderOptions", [try json(["projectId": id])])
            let project = options.object("project")
            guard options.count == 5, !options.text("revision").isEmpty,
                  project.count == 3, project.text("id") == id, project["title"] is String,
                  ["active", "waiting", "someday", "archived"].contains(project.text("status")),
                  let canReorder = options["canReorder"] as? NSNumber,
                  CFGetTypeID(canReorder) == CFBooleanGetTypeID(),
                  (!canReorder.boolValue || project.text("status") != "archived"),
                  let sections = options["sections"] as? [CoreObject],
                  let token = options["token"] as? [CoreObject],
                  token.count == sections.count,
                  Set(sections.map { $0.text("id") }).count == sections.count,
                  sections.enumerated().allSatisfy({ index, row in
                      let raw = token[index]
                      return row.count == 4 && !row.text("id").isEmpty && row["title"] is String
                          && (row["canMoveUp"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true
                          && (row["canMoveDown"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true
                          && raw.text("id") == row.text("id") && raw.text("projectId") == id
                          && raw.text("title") == row.text("title")
                          && (canReorder.boolValue || (!row.flag("canMoveUp") && !row.flag("canMoveDown")))
                  }) else { throw CocoaError(.coderReadCorrupt) }
            let visible = projectSectionRows
            if options.text("revision") == projectDetail.text("mutationRevision"),
               projectSectionOptionsFresh, projectHeader.text("id") == id,
               sections.count == visible.count,
               sections.enumerated().allSatisfy({ index, row in
                   row.text("id") == visible[index].text("id")
                       && row.text("title") == visible[index].text("title")
               }) {
                projectSectionOrderOptions = options
                projectSectionOrderOptionsCurrent = true
                projectSectionReadError = nil
                return
            }
            if attempt == 0 {
                await readProjectDetail()
                guard projectCurrent, projectDetail.text("projectId") == id else {
                    throw CocoaError(.coderReadCorrupt)
                }
                try await readProjectSectionOptions(projectID: id)
            }
        }
        throw CocoaError(.coderReadCorrupt)
    }

    private func readProjectSectionRenameOptions(projectID id: String, sectionID: String) async throws {
        projectSectionRenameOptionsCurrent = false
        guard projectSectionEditID == sectionID, projectSectionOptionsFresh,
              projectSectionRows.contains(where: { $0.text("id") == sectionID }) else {
            throw CocoaError(.coderReadCorrupt)
        }
        for attempt in 0..<2 {
            let options = try await query("projectSectionRenameOptions", [try json([
                "projectId": id, "sectionId": sectionID
            ])])
            let project = options.object("project")
            let section = options.object("section")
            let token = options.object("token")
            guard options.count == 5, !options.text("revision").isEmpty,
                  project.count == 3, project.text("id") == id, project["title"] is String,
                  ["active", "waiting", "someday", "archived"].contains(project.text("status")),
                  section.count == 2, section.text("id") == sectionID, section["title"] is String,
                  token.text("id") == sectionID, token.text("projectId") == id,
                  token["title"] is String, token.text("title") == section.text("title"),
                  let canRename = options["canRename"] as? NSNumber,
                  CFGetTypeID(canRename) == CFBooleanGetTypeID(),
                  !canRename.boolValue || project.text("status") != "archived" else {
                throw CocoaError(.coderReadCorrupt)
            }
            if options.text("revision") == projectDetail.text("mutationRevision"),
               projectSectionOptionsFresh, projectSectionEditID == sectionID,
               projectSectionRows.contains(where: { $0.text("id") == sectionID }) {
                projectSectionRenameOptions = options
                projectSectionRenameOptionsCurrent = true
                projectSectionReadError = nil
                return
            }
            if attempt == 0 {
                await readProjectDetail()
                guard projectCurrent, projectDetail.text("projectId") == id else {
                    throw CocoaError(.coderReadCorrupt)
                }
                try await readProjectSectionOptions(projectID: id)
            }
        }
        throw CocoaError(.coderReadCorrupt)
    }

    private func readProjectSectionDeleteOptions(projectID id: String, sectionID: String) async throws {
        projectSectionDeleteOptionsCurrent = false
        guard projectSectionsPresented, !projectSectionEditing, projectSectionOptionsFresh,
              projectSectionRows.contains(where: { $0.text("id") == sectionID }) else {
            throw CocoaError(.coderReadCorrupt)
        }
        for attempt in 0..<2 {
            let options = try await query("projectSectionDeleteOptions", [try json([
                "projectId": id, "sectionId": sectionID
            ])])
            let project = options.object("project")
            let section = options.object("section")
            let token = options.object("token")
            guard options.count == 5, !options.text("revision").isEmpty,
                  project.count == 3, project.text("id") == id, project["title"] is String,
                  ["active", "waiting", "someday", "archived"].contains(project.text("status")),
                  section.count == 2, section.text("id") == sectionID, section["title"] is String,
                  token.text("id") == sectionID, token.text("projectId") == id,
                  token["title"] is String, token.text("title") == section.text("title"),
                  let canDelete = options["canDelete"] as? NSNumber,
                  CFGetTypeID(canDelete) == CFBooleanGetTypeID(),
                  !canDelete.boolValue || project.text("status") != "archived" else {
                throw CocoaError(.coderReadCorrupt)
            }
            if options.text("revision") == projectDetail.text("mutationRevision"),
               projectSectionOptionsFresh, projectHeader.text("id") == id,
               projectSectionRows.contains(where: { $0.text("id") == sectionID }) {
                projectSectionDeleteOptions = options
                projectSectionDeleteOptionsCurrent = true
                projectSectionReadError = nil
                return
            }
            if attempt == 0 {
                await readProjectDetail()
                guard projectCurrent, projectDetail.text("projectId") == id else {
                    throw CocoaError(.coderReadCorrupt)
                }
                try await readProjectSectionOptions(projectID: id)
            }
        }
        throw CocoaError(.coderReadCorrupt)
    }

    func beginProjectSectionDelete(_ sectionID: String) async -> Bool {
        let id = projectHeader.text("id")
        guard projectSectionDeleteEnabled(sectionID) else { return false }
        projectSectionDeleteReadyID = nil
        projectSectionDeleteOptions = [:]
        projectSectionDeleteOptionsCurrent = false
        projectSectionError = nil
        projectSectionReadError = nil
        busy = true
        defer { finishOperation() }
        do {
            try await readProjectSectionDeleteOptions(projectID: id, sectionID: sectionID)
            guard projectSectionsPresented, !projectSectionEditing, projectHeader.text("id") == id,
                  projectSectionDeleteOptionsCurrent,
                  projectSectionDeleteOptions.flag("canDelete"),
                  projectSectionDeleteOptions.text("revision") == projectDetail.text("mutationRevision") else {
                throw CocoaError(.coderReadCorrupt)
            }
            projectSectionDeleteReadyID = sectionID
            return true
        } catch {
            projectSectionReadError = error.localizedDescription
            return false
        }
    }

    func cancelProjectSectionDelete() {
        guard !projectSectionPending else { return }
        projectSectionDeleteReadyID = nil
        projectSectionDeleteOptions = [:]
        projectSectionDeleteOptionsCurrent = false
    }

    func confirmProjectSectionDelete() async {
        guard let sectionID = projectSectionDeleteReadyID else { return }
        let id = projectHeader.text("id")
        guard projectSectionsPresented, !projectSectionEditing, projectSectionCloseEnabled,
              projectSectionDeleteOptionsFresh,
              projectSectionDeleteOptions.object("token").text("id") == sectionID else {
            cancelProjectSectionDelete()
            projectSectionReadError = CocoaError(.coderReadCorrupt).localizedDescription
            return
        }
        let token = projectSectionDeleteOptions.object("token")
        projectSectionDeleteReadyID = nil
        projectSectionDeleteOptionsCurrent = false
        busy = true
        projectSectionError = nil
        defer { finishOperation() }
        do {
            projectSectionDeleteRequest = try json([
                "requestId": UUID().uuidString.lowercased(), "projectId": id,
                "sectionId": sectionID, "expected": token
            ])
            projectSectionDeleteExpectedID = sectionID
            projectSectionDeleteExpectedProjectID = id
        } catch {
            projectSectionReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectSectionDelete", [projectSectionDeleteRequest!]) }
        catch { await handleProjectSectionDeleteWriteError(error); return }
        do { try acknowledgeProjectSectionDelete(result) }
        catch { await handleProjectSectionDeleteWriteError(error); return }
        do { try await refreshProjectSectionsAfterWrite() }
        catch {
            projectSectionReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeProjectSectionDelete(_ result: CoreObject) throws {
        guard projectSectionDeleteRequest != nil, let sectionID = projectSectionDeleteExpectedID,
              let projectID = projectSectionDeleteExpectedProjectID,
              result.count == 2, result.text("id") == sectionID,
              result.text("projectId") == projectID else { throw CocoaError(.coderReadCorrupt) }
        projectSectionDeleteRequest = nil
        projectSectionDeleteExpectedID = nil
        projectSectionDeleteExpectedProjectID = nil
        projectSectionDeleteReadyID = nil
        projectSectionDeleteOptions = [:]
        projectSectionDeleteOptionsCurrent = false
        projectSectionOptionsCurrent = false
        retryNeeded = false
        projectSectionError = nil
        projectSectionReadError = nil
        error = nil
    }

    private func handleProjectSectionDeleteWriteError(_ failure: Error) async {
        if projectSectionDeleteRequest != nil && isDefiniteRejection(failure) {
            projectSectionDeleteRequest = nil
            projectSectionDeleteExpectedID = nil
            projectSectionDeleteExpectedProjectID = nil
            projectSectionDeleteReadyID = nil
            projectSectionDeleteOptions = [:]
            projectSectionDeleteOptionsCurrent = false
            retryNeeded = false
            projectSectionError = failure.localizedDescription
            error = nil
            // A later attempt must read a new token and ask for confirmation again.
            do { try await refreshProjectSectionsAfterWrite() }
            catch { projectSectionReadError = error.localizedDescription }
        } else {
            retryNeeded = projectSectionDeleteRequest != nil
            projectSectionError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    func moveProjectSection(_ sectionID: String, direction: String) async {
        let id = projectHeader.text("id")
        guard projectSectionMoveEnabled(sectionID, direction: direction),
              await flushProjectNotesEdit(), projectHeader.text("id") == id,
              projectSectionMoveEnabled(sectionID, direction: direction) else { return }
        let rows = projectSectionOrderOptions.objects("sections")
        let token = projectSectionOrderOptions.objects("token")
        guard let index = rows.firstIndex(where: { $0.text("id") == sectionID }),
              token.count == rows.count else { return }
        let destination = index + (direction == "up" ? -1 : 1)
        guard rows.indices.contains(destination) else { return }
        var orderedIDs = rows.map { $0.text("id") }
        orderedIDs.swapAt(index, destination)
        busy = true
        projectSectionError = nil
        defer { finishOperation() }
        do {
            projectSectionOrderRequest = try json([
                "requestId": UUID().uuidString.lowercased(), "projectId": id,
                "sectionId": sectionID, "direction": direction, "expectedSections": token
            ])
            projectSectionOrderExpectedProjectID = id
            projectSectionOrderExpectedIDs = orderedIDs
        } catch {
            projectSectionReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectSectionOrder", [projectSectionOrderRequest!]) }
        catch { await handleProjectSectionOrderWriteError(error); return }
        do { try acknowledgeProjectSectionOrder(result) }
        catch { await handleProjectSectionOrderWriteError(error); return }
        do { try await refreshProjectSectionsAfterWrite() }
        catch {
            projectSectionReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeProjectSectionOrder(_ result: CoreObject) throws {
        guard projectSectionOrderRequest != nil, let projectID = projectSectionOrderExpectedProjectID,
              let expected = projectSectionOrderExpectedIDs,
              result.count == 2, result.text("projectId") == projectID,
              let ordered = result["orderedIds"] as? [String], ordered == expected else {
            throw CocoaError(.coderReadCorrupt)
        }
        projectSectionOrderRequest = nil
        projectSectionOrderExpectedProjectID = nil
        projectSectionOrderExpectedIDs = nil
        projectSectionOrderOptionsCurrent = false
        projectSectionOptionsCurrent = false
        retryNeeded = false
        projectSectionError = nil
        projectSectionReadError = nil
        error = nil
    }

    private func handleProjectSectionOrderWriteError(_ failure: Error) async {
        if projectSectionOrderRequest != nil && isDefiniteRejection(failure) {
            projectSectionOrderRequest = nil
            projectSectionOrderExpectedProjectID = nil
            projectSectionOrderExpectedIDs = nil
            projectSectionOrderOptionsCurrent = false
            retryNeeded = false
            projectSectionError = failure.localizedDescription
            error = nil
            do { try await refreshProjectSectionsAfterWrite() }
            catch { projectSectionReadError = error.localizedDescription }
        } else {
            retryNeeded = projectSectionOrderRequest != nil
            projectSectionError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    func saveProjectSection() async {
        if projectSectionEditID != nil { await saveProjectSectionRename(); return }
        let id = projectHeader.text("id")
        guard projectSectionCanSave else { return }
        let title = projectSectionTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard await flushProjectNotesEdit(), projectHeader.text("id") == id,
              projectSectionsPresented, projectSectionEditing, projectSectionCloseEnabled,
              !title.isEmpty, projectSectionEditID == nil, projectSectionRequest == nil else { return }
        busy = true
        projectSectionError = nil
        defer { finishOperation() }
        do {
            // Notes autosave can advance the Project token while this sheet is open.
            try await readProjectSectionOptions(projectID: id)
            guard projectSectionOptionsCurrent, projectSectionOptions.flag("canCreate"),
                  projectSectionOptions.text("revision") == projectDetail.text("mutationRevision") else {
                throw CocoaError(.coderReadCorrupt)
            }
            let requestID = UUID().uuidString.lowercased()
            projectSectionRequest = try json(["requestId": requestID, "projectId": id, "title": title])
            projectSectionExpectedID = requestID
            projectSectionExpectedProjectID = id
        } catch {
            projectSectionReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectSectionCreate", [projectSectionRequest!]) }
        catch { await handleProjectSectionWriteError(error); return }
        do { try acknowledgeProjectSection(result) }
        catch { await handleProjectSectionWriteError(error); return }
        do { try await refreshProjectSectionsAfterWrite() }
        catch {
            projectSectionReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func saveProjectSectionRename() async {
        let id = projectHeader.text("id")
        guard let sectionID = projectSectionEditID, projectSectionCanSave else { return }
        let title = projectSectionTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard await flushProjectNotesEdit(), projectHeader.text("id") == id,
              projectSectionEditID == sectionID, projectSectionsPresented, projectSectionEditing,
              projectSectionCloseEnabled, !title.isEmpty, projectSectionRenameRequest == nil else { return }
        guard projectSectionRenameOptionsFresh else {
            projectSectionRenameOptionsCurrent = false
            projectSectionReadError = CocoaError(.coderReadCorrupt).localizedDescription
            return
        }
        busy = true
        projectSectionError = nil
        defer { finishOperation() }
        do {
            let token = projectSectionRenameOptions.object("token")
            guard !token.isEmpty, projectSectionRenameOptions.flag("canRename"),
                  token.text("id") == sectionID, token.text("projectId") == id else {
                throw CocoaError(.coderReadCorrupt)
            }
            projectSectionRenameRequest = try json([
                "requestId": UUID().uuidString.lowercased(), "projectId": id,
                "sectionId": sectionID, "title": title, "expected": token
            ])
            projectSectionRenameExpectedID = sectionID
            projectSectionRenameExpectedProjectID = id
        } catch {
            projectSectionReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectSectionRename", [projectSectionRenameRequest!]) }
        catch { await handleProjectSectionRenameWriteError(error); return }
        do { try acknowledgeProjectSectionRename(result) }
        catch { await handleProjectSectionRenameWriteError(error); return }
        do { try await refreshProjectSectionsAfterWrite() }
        catch {
            projectSectionReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeProjectSectionRename(_ result: CoreObject) throws {
        guard projectSectionRenameRequest != nil, let sectionID = projectSectionRenameExpectedID,
              let projectID = projectSectionRenameExpectedProjectID,
              result.count == 2, result.text("id") == sectionID,
              result.text("projectId") == projectID else { throw CocoaError(.coderReadCorrupt) }
        projectSectionRenameRequest = nil
        projectSectionRenameExpectedID = nil
        projectSectionRenameExpectedProjectID = nil
        projectSectionRenameOptions = [:]
        projectSectionRenameOptionsCurrent = false
        projectSectionEditID = nil
        projectSectionEditing = false
        projectSectionTitle = ""
        projectSectionOptionsCurrent = false
        retryNeeded = false
        projectSectionError = nil
        projectSectionReadError = nil
        error = nil
    }

    private func handleProjectSectionRenameWriteError(_ failure: Error) async {
        if projectSectionRenameRequest != nil && isDefiniteRejection(failure) {
            projectSectionRenameRequest = nil
            projectSectionRenameExpectedID = nil
            projectSectionRenameExpectedProjectID = nil
            projectSectionRenameOptionsCurrent = false
            retryNeeded = false
            projectSectionError = failure.localizedDescription
            error = nil
            // Refresh visible rows, but require an explicit read Retry before
            // binding the retained draft to a new Section token.
            do { try await refreshProjectSectionsAfterWrite() }
            catch { projectSectionReadError = error.localizedDescription }
        } else {
            retryNeeded = projectSectionRenameRequest != nil
            projectSectionError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    private func acknowledgeProjectSection(_ result: CoreObject) throws {
        guard projectSectionRequest != nil, let id = projectSectionExpectedID,
              let projectID = projectSectionExpectedProjectID,
              result.count == 2, result.text("id") == id,
              result.text("projectId") == projectID else { throw CocoaError(.coderReadCorrupt) }
        projectSectionRequest = nil
        projectSectionExpectedID = nil
        projectSectionExpectedProjectID = nil
        projectSectionEditing = false
        projectSectionEditID = nil
        projectSectionTitle = ""
        projectSectionOptionsCurrent = false
        retryNeeded = false
        projectSectionError = nil
        projectSectionReadError = nil
        error = nil
    }

    private func handleProjectSectionWriteError(_ failure: Error) async {
        if projectSectionRequest != nil && isDefiniteRejection(failure) {
            projectSectionRequest = nil
            projectSectionExpectedID = nil
            projectSectionExpectedProjectID = nil
            projectSectionOptionsCurrent = false
            retryNeeded = false
            projectSectionError = failure.localizedDescription
            error = nil
            do { try await refreshProjectSectionsAfterWrite() }
            catch { projectSectionReadError = error.localizedDescription }
        } else {
            retryNeeded = projectSectionRequest != nil
            projectSectionError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    private func refreshProjectSectionsAfterWrite() async throws {
        let id = projectHeader.text("id")
        try await readSelectedSurface()
        guard selectedSurface == .project, projectCurrent,
              projectDetail.text("projectId") == id else { throw CocoaError(.coderReadCorrupt) }
        try await readProjectSectionOptions(projectID: id)
        try await readProjectSectionOrderOptions(projectID: id)
    }

    func retryProjectSectionRead() async {
        guard ready, projectSectionsPresented, selectedSurface == .project,
              !busy, !retryNeeded, !projectSectionPending else { return }
        cancelProjectSectionDelete()
        let sectionID = projectSectionEditID
        let id = projectHeader.text("id")
        busy = true
        defer { finishOperation() }
        do {
            try await refreshProjectSectionsAfterWrite()
            if let sectionID {
                guard projectHeader.text("id") == id, projectSectionEditID == sectionID else {
                    throw CocoaError(.coderReadCorrupt)
                }
                try await readProjectSectionRenameOptions(projectID: id, sectionID: sectionID)
            }
            projectSectionReadError = nil
            projectSectionError = nil
            error = nil
        } catch { projectSectionReadError = error.localizedDescription }
    }

    func openProjectDate(_ field: String) async {
        let id = projectHeader.text("id")
        guard ["startDate", "dueDate", "reviewAt"].contains(field), projectDateTapEnabled else { return }
        guard await flushProjectNotesEdit(), projectHeader.text("id") == id,
              projectDateOpenEnabled else { return }
        projectDateField = field
        projectDatePicker = [:]
        projectDateOpeningTimeZone = field == "reviewAt" ? TimeZone.current : nil
        projectReviewOpeningRaw = nil
        projectDateError = nil
        projectDateReadError = nil
        busy = true
        defer { finishOperation() }
        do { try await readProjectDateOptions(field, projectID: id) }
        catch { projectDateReadError = error.localizedDescription }
    }

    func cancelProjectDate() {
        guard projectDateRequest == nil, !retryNeeded, !busy else { return }
        projectDateField = nil
        projectDatePicker = [:]
        projectDateOpeningTimeZone = nil
        projectReviewOpeningRaw = nil
        projectDateError = nil
    }

    private func readProjectDateOptions(_ field: String, projectID id: String) async throws {
        projectDateOptionsCurrent = false
        guard selectedSurface == .project, projectCurrent,
              projectDetail.text("projectId") == id, projectHeader.text("id") == id,
              ["startDate", "dueDate", "reviewAt"].contains(field) else { throw CocoaError(.coderReadCorrupt) }
        let review = field == "reviewAt"
        let readZone = TimeZone.current
        if review && projectDateField == field && projectDatePicker.isEmpty {
            guard projectDateOpeningTimeZone == readZone else { throw CocoaError(.coderReadCorrupt) }
        }
        for attempt in 0..<2 {
            let options = try await query("projectDateOptions", [try json(["projectId": id, "field": field])])
            if review && TimeZone.current != readZone { throw CocoaError(.coderReadCorrupt) }
            let project = options.object("project")
            let picker = options.object("picker")
            let instant = review ? TaskDatePickerComponents.instant(picker.text("instant")) : nil
            guard options.count == 4, !options.text("revision").isEmpty,
                  let canEdit = options["canEdit"] as? NSNumber,
                  CFGetTypeID(canEdit) == CFBooleanGetTypeID(),
                  project.count == (review ? 9 : 8), project.text("id") == id,
                  project["title"] is String,
                  ["active", "waiting", "someday", "archived"].contains(project.text("status")),
                  ["startDate", "dueDate"].allSatisfy({ key in
                      project[key] is NSNull || (project[key] as? String).map({ $0.utf16.count <= 100 }) == true
                  }),
                  !review || project["reviewAt"] is NSNull
                    || (project["reviewAt"] as? String).map({ $0.utf16.count <= 100 }) == true,
                  project["rev"] is Int || project["rev"] is NSNull,
                  project["revBy"] is String || project["revBy"] is NSNull,
                  !project.text("updatedAt").isEmpty,
                  picker.count == (review ? 4 : 2), picker.text("time") == "12:00",
                  picker.text("date").range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
                  (review ? instant != nil : TaskDatePickerComponents.date(picker) != nil),
                  !review || (picker["preserveUnchanged"] as? NSNumber)
                    .map({ CFGetTypeID($0) == CFBooleanGetTypeID() }) == true,
                  !review || instant.map({ TaskDatePickerComponents.string($0, time: false,
                      timeZone: readZone) == picker.text("date") }) == true,
                  canEdit.boolValue == (project.text("status") != "archived") else {
                throw CocoaError(.coderReadCorrupt)
            }
            if options.text("revision") == projectDetail.text("mutationRevision"), projectCurrent,
               projectDetail.text("projectId") == id, projectHeader.text("id") == id {
                if review && projectDateField == field {
                    let raw = project["reviewAt"] as? String
                    if !projectDatePicker.isEmpty && raw != projectReviewOpeningRaw {
                        throw CocoaError(.coderReadCorrupt)
                    }
                    if projectDatePicker.isEmpty { projectReviewOpeningRaw = raw }
                }
                projectDateOptions = options
                projectDateOptionsField = field
                projectDateOptionsCurrent = true
                if projectDateField != field || projectDatePicker.isEmpty { projectDatePicker = picker }
                projectDateReadError = nil
                return
            }
            if attempt == 0 {
                await readProjectDetail()
                guard projectCurrent, projectDetail.text("projectId") == id else {
                    throw CocoaError(.coderReadCorrupt)
                }
            }
        }
        throw CocoaError(.coderReadCorrupt)
    }

    func finishProjectReviewDate(_ selected: Date) async {
        guard projectDateField == "reviewAt", projectDateDoneEnabled,
              let zone = projectDateOpeningTimeZone else { return }
        if projectDatePicker.flag("preserveUnchanged")
            && TaskDatePickerComponents.string(selected, time: false, timeZone: zone) == projectDatePicker.text("date") {
            cancelProjectDate()
            return
        }
        await changeProjectDate("reviewAt", value: TaskDatePickerComponents.instantString(selected))
    }

    func changeProjectDate(_ field: String, value: String?) async {
        let id = projectHeader.text("id")
        guard ["startDate", "dueDate", "reviewAt"].contains(field),
              field != "reviewAt" || (value.map({ TaskDatePickerComponents.instant($0) != nil }) ?? true),
              value == nil || projectDateField == field, projectDateTapEnabled else { return }
        guard await flushProjectNotesEdit(), projectHeader.text("id") == id,
              projectDateOpenEnabled, projectDateRequest == nil else { return }
        busy = true
        projectDateError = nil
        defer { finishOperation() }
        do {
            // Notes autosave may have advanced this Project's row token while the
            // date wheel was open. Always bind the write to a fresh read.
            try await readProjectDateOptions(field, projectID: id)
            let project = projectDateOptions.object("project")
            guard projectDateOptionsCurrent, projectDateOptionsField == field,
                  projectDateOptions.flag("canEdit"), project.text("id") == id,
                  projectDateOptions.text("revision") == projectDetail.text("mutationRevision") else {
                throw CocoaError(.coderReadCorrupt)
            }
            var expected: CoreObject = [
                "title": project.text("title"), "status": project.text("status"),
                "startDate": project["startDate"]!, "dueDate": project["dueDate"]!,
                "rev": project["rev"]!, "revBy": project["revBy"]!,
                "updatedAt": project.text("updatedAt")
            ]
            if field == "reviewAt" { expected["reviewAt"] = project["reviewAt"]! }
            let requested: Any
            if let value { requested = value } else { requested = NSNull() }
            projectDateRequest = try json(["requestId": UUID().uuidString.lowercased(),
                                           "projectId": id, "field": field, "value": requested,
                                           "expected": expected])
            projectDateExpectedID = id
            projectDateExpectedField = field
            projectDateExpectedValue = requested
        } catch {
            projectDateReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectDateWrite", [projectDateRequest!]) }
        catch { await handleProjectDateWriteError(error); return }
        do { try acknowledgeProjectDate(result) }
        catch { await handleProjectDateWriteError(error); return }
        do { try await refreshProjectDateAfterWrite() }
        catch {
            projectDateReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeProjectDate(_ result: CoreObject) throws {
        guard projectDateRequest != nil, let id = projectDateExpectedID,
              let field = projectDateExpectedField, let value = projectDateExpectedValue else {
            throw CocoaError(.coderReadCorrupt)
        }
        let blocked = result.count == 1 && result["blocked"] as? String == ""
        if !blocked {
            guard result.count == 3, result.text("id") == id, result.text("field") == field,
                  try json([result["value"] ?? NSNull()]) == json([value]) else {
                throw CocoaError(.coderReadCorrupt)
            }
        }
        projectDateRequest = nil
        projectDateExpectedID = nil
        projectDateExpectedField = nil
        projectDateExpectedValue = nil
        projectDateOptionsCurrent = false
        projectDateField = nil
        projectDatePicker = [:]
        projectDateOpeningTimeZone = nil
        projectReviewOpeningRaw = nil
        retryNeeded = false
        projectDateError = nil
        projectDateReadError = nil
        error = nil
    }

    private func handleProjectDateWriteError(_ failure: Error) async {
        if projectDateRequest != nil && isDefiniteRejection(failure) {
            projectDateRequest = nil
            projectDateExpectedID = nil
            projectDateExpectedField = nil
            projectDateExpectedValue = nil
            projectDateOptionsCurrent = false
            retryNeeded = false
            projectDateError = failure.localizedDescription
            error = nil
            do { try await refreshProjectDateAfterWrite() }
            catch { projectDateReadError = error.localizedDescription }
        } else {
            retryNeeded = projectDateRequest != nil
            projectDateError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    private func refreshProjectDateAfterWrite() async throws {
        try await readSelectedSurface()
        guard selectedSurface == .project, projectCurrent,
              projectDetail.text("projectId") == projectHeader.text("id") else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    func retryProjectDateRead() async {
        guard ready, selectedSurface == .project, !busy, !retryNeeded,
              projectDateRequest == nil else { return }
        let field = projectDateField
        let id = projectHeader.text("id")
        busy = true
        defer { finishOperation() }
        do {
            try await refreshProjectDateAfterWrite()
            if let field { try await readProjectDateOptions(field, projectID: id) }
            projectDateReadError = nil
            projectDateError = nil
            error = nil
        } catch { projectDateReadError = error.localizedDescription }
    }

    func openProjectArea() async {
        let id = projectHeader.text("id")
        guard projectAreaOpenEnabled else { return }
        guard await flushProjectNotesEdit(), projectHeader.text("id") == id,
              projectAreaOpenEnabled else { return }
        projectAreaPresented = true
        projectAreaOptions = [:]
        projectAreaOptionsCurrent = false
        projectAreaOpeningAssociation = nil
        projectAreaCreatePresented = false
        projectAreaCreateProjectID = nil
        projectAreaCreatedID = nil
        projectAreaCreateDurableChange = false
        projectAreaHasRequestedChoice = false
        projectAreaRequestedID = nil
        projectAreaError = nil
        projectAreaReadError = nil
        busy = true
        defer { finishOperation() }
        do { try await readProjectAreaOptions(projectID: id) }
        catch { projectAreaReadError = error.localizedDescription }
    }

    func closeProjectArea() {
        if areaManagerPresented {
            guard areaManagerProjectID != nil else { return }
            closeAreaManager()
            return
        }
        guard projectAreaCloseEnabled else { return }
        dismissProjectAreaPresentation()
    }

    private func dismissProjectAreaPresentation() {
        projectAreaPresented = false
        projectAreaCreatePresented = false
        projectAreaOptions = [:]
        projectAreaOptionsCurrent = false
        projectAreaOpeningAssociation = nil
        projectAreaCreateProjectID = nil
        projectAreaCreatedID = nil
        projectAreaCreateDurableChange = false
        projectAreaHasRequestedChoice = false
        projectAreaRequestedID = nil
        projectAreaError = nil
        projectAreaReadError = nil
    }

    private func readProjectAreaOptions(projectID id: String) async throws {
        projectAreaOptionsCurrent = false
        guard selectedSurface == .project, projectCurrent, projectAreaPresented,
              projectDetail.text("projectId") == id, projectHeader.text("id") == id,
              !id.isEmpty else { throw CocoaError(.coderReadCorrupt) }
        for attempt in 0..<2 {
            let options = try await query("projectAreaOptions", [id])
            let project = options.object("project")
            guard options.count == 5, !options.text("revision").isEmpty,
                  let canEdit = options["canEdit"] as? NSNumber,
                  CFGetTypeID(canEdit) == CFBooleanGetTypeID(),
                  let noAreaLabel = options["noAreaLabel"] as? String, !noAreaLabel.isEmpty,
                  let areas = options["areas"] as? [CoreObject],
                  areas.allSatisfy({ row in
                      row.count == 3 && !row.text("id").isEmpty && row.text("id").utf16.count <= 500
                          && (row["label"] as? String).map({ $0.utf16.count <= 100_000 }) == true
                          && (row["color"] is NSNull || row["color"] is String)
                  }),
                  Set(areas.map { $0.text("id") }).count == areas.count,
                  project.count == 9, project.text("id") == id,
                  (project["title"] as? String).map({ $0.utf16.count <= 100_000 }) == true,
                  ["active", "waiting", "someday", "archived"].contains(project.text("status")),
                  project["areaId"] is NSNull || (project["areaId"] as? String)
                    .map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true,
                  project["areaTitle"] is NSNull || (project["areaTitle"] as? String)
                    .map({ $0.utf16.count <= 100_000 }) == true,
                  let order = project["order"] as? NSNumber,
                  CFGetTypeID(order) != CFBooleanGetTypeID(), order.doubleValue.isFinite,
                  project["rev"] is NSNull || (project["rev"] as? Int).map({ $0 >= 0 }) == true,
                  project["revBy"] is NSNull || (project["revBy"] as? String)
                    .map({ $0.utf16.count <= 500 }) == true,
                  TaskDatePickerComponents.instant(project.text("updatedAt")) != nil,
                  canEdit.boolValue == (project.text("status") != "archived") else {
                throw CocoaError(.coderReadCorrupt)
            }
            if options.text("revision") == projectDetail.text("mutationRevision"), projectCurrent,
               projectDetail.text("projectId") == id, projectHeader.text("id") == id {
                let association = (id: project["areaId"] as? String,
                                   title: project["areaTitle"] as? String)
                if let opening = projectAreaOpeningAssociation {
                    guard association.id == opening.id && association.title == opening.title else {
                        throw CocoaError(.coderReadCorrupt)
                    }
                } else { projectAreaOpeningAssociation = association }
                projectAreaOptions = options
                projectAreaOptionsCurrent = true
                projectAreaReadError = nil
                return
            }
            if attempt == 0 {
                await readProjectDetail()
                guard projectCurrent, projectDetail.text("projectId") == id else {
                    throw CocoaError(.coderReadCorrupt)
                }
            }
        }
        throw CocoaError(.coderReadCorrupt)
    }

    func chooseProjectArea(_ selectedID: String?, name selectedName: String?) async {
        let id = projectHeader.text("id")
        guard projectAreaChoiceEnabled, selectedSurface == .project, !id.isEmpty,
              (selectedID == nil) == (selectedName == nil) else { return }
        if let selectedID, let selectedName {
            guard projectAreaOptions.objects("areas").contains(where: {
                $0.text("id") == selectedID && $0.text("label") == selectedName
            }) else { return }
        }
        guard await flushProjectNotesEdit(), projectHeader.text("id") == id,
              selectedSurface == .project, projectAreaPresented, !busy, !retryNeeded,
              projectAreaRequest == nil else { return }
        busy = true
        projectAreaError = nil
        defer { finishOperation() }
        await performProjectAreaWrite(selectedID, name: selectedName, projectID: id)
    }

    // The Area-create path calls this only after its own durable acknowledgment.
    // The caller owns busy, so a second command cannot bypass the UI guards.
    private func performProjectAreaWrite(_ selectedID: String?, name selectedName: String?,
                                         projectID id: String) async {
        do {
            // Notes autosave may change the Project revision. Re-read its token,
            // but never silently switch the association or tapped Area witness.
            try await readProjectAreaOptions(projectID: id)
            let project = projectAreaOptions.object("project")
            guard projectAreaOptionsCurrent, projectAreaOptions.flag("canEdit"),
                  project.text("id") == id,
                  projectAreaOptions.text("revision") == projectDetail.text("mutationRevision") else {
                throw CocoaError(.coderReadCorrupt)
            }
            if let selectedID, let selectedName {
                guard projectAreaOptions.objects("areas").contains(where: {
                    $0.text("id") == selectedID && $0.text("label") == selectedName
                }) else { throw CocoaError(.coderReadCorrupt) }
            }
            let expected: CoreObject = [
                "title": project.text("title"), "status": project.text("status"),
                "areaId": project["areaId"]!, "areaTitle": project["areaTitle"]!,
                "order": project["order"]!, "rev": project["rev"]!,
                "revBy": project["revBy"]!, "updatedAt": project.text("updatedAt")
            ]
            let areaValue: Any = selectedID as Any? ?? NSNull()
            let selectedArea: Any
            if let selectedID, let selectedName {
                selectedArea = ["id": selectedID, "name": selectedName]
            } else { selectedArea = NSNull() }
            projectAreaRequest = try json(["requestId": UUID().uuidString.lowercased(),
                                           "projectId": id, "areaId": areaValue,
                                           "expected": expected, "selectedArea": selectedArea])
            projectAreaHasRequestedChoice = true
            projectAreaRequestedID = selectedID
            projectAreaExpectedID = id
            projectAreaExpectedAreaID = selectedID
        } catch {
            projectAreaReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectAreaWrite", [projectAreaRequest!]) }
        catch { await handleProjectAreaWriteError(error); return }
        if await retainCreatedProjectAreaAfterBlockedWrite(result) { return }
        do { try acknowledgeProjectArea(result) }
        catch { await handleProjectAreaWriteError(error); return }
        do { try await refreshProjectAreaAfterWrite() }
        catch {
            projectAreaReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeProjectArea(_ result: CoreObject) throws {
        guard projectAreaRequest != nil, let id = projectAreaExpectedID else {
            throw CocoaError(.coderReadCorrupt)
        }
        let blocked = result.count == 1 && result["blocked"] as? String == ""
        if !blocked {
            let actualAreaID = result["areaId"] as? String
            guard result.count == 4, result.text("id") == id,
                  (actualAreaID == projectAreaExpectedAreaID &&
                    (actualAreaID != nil || result["areaId"] is NSNull)),
                  result["areaTitle"] is NSNull || (result["areaTitle"] as? String)
                    .map({ $0.utf16.count <= 100_000 }) == true,
                  let order = result["order"] as? NSNumber,
                  CFGetTypeID(order) != CFBooleanGetTypeID(), order.doubleValue.isFinite else {
                throw CocoaError(.coderReadCorrupt)
            }
        }
        let createdAndAssigned = !blocked && projectAreaCreateDurableChange && projectAreaCreatedID != nil
            && projectAreaCreatedID == projectAreaExpectedAreaID
            && (projectAreaOpeningAssociation?.id != projectAreaExpectedAreaID
                || projectAreaOpeningAssociation?.title != (result["areaTitle"] as? String))
        let fromAreaManager = areaManagerProjectID != nil
        projectAreaRequest = nil
        projectAreaHasRequestedChoice = false
        projectAreaRequestedID = nil
        projectAreaExpectedID = nil
        projectAreaExpectedAreaID = nil
        dismissProjectAreaPresentation()
        if fromAreaManager { dismissAreaManagerPresentation() }
        retryNeeded = false
        error = nil
        if createdAndAssigned {
            NSLog("Native iOS Project Area creation and assignment saved releaseCheck=v1.3.3/native-ios-project-area-create-assignment outcome=assigned")
        }
    }

    private func retainCreatedProjectAreaAfterBlockedWrite(_ result: CoreObject) async -> Bool {
        guard projectAreaCreatedID != nil, result.count == 1,
              result["blocked"] as? String == "" else { return false }
        projectAreaRequest = nil
        projectAreaHasRequestedChoice = false
        projectAreaRequestedID = nil
        projectAreaExpectedID = nil
        projectAreaExpectedAreaID = nil
        projectAreaOptionsCurrent = false
        retryNeeded = false
        projectAreaError = nil
        error = nil
        do { try await refreshProjectAreaAfterWrite() }
        catch { projectAreaReadError = error.localizedDescription }
        return true
    }

    private func handleProjectAreaWriteError(_ failure: Error) async {
        if projectAreaRequest != nil && isDefiniteRejection(failure) {
            projectAreaRequest = nil
            projectAreaHasRequestedChoice = false
            projectAreaRequestedID = nil
            projectAreaExpectedID = nil
            projectAreaExpectedAreaID = nil
            projectAreaOptionsCurrent = false
            retryNeeded = false
            projectAreaError = failure.localizedDescription
            error = nil
            do { try await refreshProjectAreaAfterWrite() }
            catch { projectAreaReadError = error.localizedDescription }
        } else {
            retryNeeded = projectAreaRequest != nil
            projectAreaError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    private func refreshProjectAreaAfterWrite() async throws {
        try await readSelectedSurface()
        guard selectedSurface == .project, projectCurrent,
              projectDetail.text("projectId") == projectHeader.text("id") else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    func retryProjectAreaRead() async {
        guard ready, selectedSurface == .project, projectAreaPresented,
              !busy, !retryNeeded, projectAreaRequest == nil else { return }
        let id = projectHeader.text("id")
        let returnFromAreaManager = areaManagerProjectID == id
        busy = true
        defer { finishOperation() }
        do {
            try await refreshProjectAreaAfterWrite()
            // After a create-only outcome, an explicit retry may adopt the
            // current association. The automatic assignment never rebases it.
            if projectAreaCreatedID != nil { projectAreaOpeningAssociation = nil }
            try await readProjectAreaOptions(projectID: id)
            projectAreaReadError = nil
            projectAreaError = nil
            error = nil
            if returnFromAreaManager { dismissAreaManagerPresentation() }
        } catch { projectAreaReadError = error.localizedDescription }
    }

    private func sameRawProjectTags(_ lhs: [String], _ rhs: [String]) -> Bool {
        lhs.count == rhs.count && zip(lhs, rhs).allSatisfy { pair in
            Data(pair.0.utf8) == Data(pair.1.utf8)
        }
    }

    func openProjectTags() async {
        let id = projectHeader.text("id")
        guard projectTagsOpenEnabled, !id.isEmpty else { return }
        guard await flushProjectNotesEdit(), projectHeader.text("id") == id,
              projectTagsOpenEnabled else { return }
        projectTagsPresented = true
        projectTagsAddPresented = false
        projectTagsOptions = [:]
        projectTagsOptionsCurrent = false
        projectTagsOpeningRaw = nil
        projectTagsDraft = ""
        projectTagsError = nil
        projectTagsReadError = nil
        busy = true
        defer { finishOperation() }
        do { try await readProjectTagsOptions(projectID: id) }
        catch { projectTagsReadError = error.localizedDescription }
    }

    func closeProjectTags() {
        guard projectTagsCloseEnabled else { return }
        projectTagsPresented = false
        projectTagsOptions = [:]
        projectTagsOptionsCurrent = false
        projectTagsOpeningRaw = nil
        projectTagsDraft = ""
        projectTagsError = nil
        projectTagsReadError = nil
    }

    private func readProjectTagsOptions(projectID id: String) async throws {
        projectTagsOptionsCurrent = false
        guard selectedSurface == .project, projectCurrent, projectTagsPresented,
              projectDetail.text("projectId") == id, projectHeader.text("id") == id,
              !id.isEmpty else { throw CocoaError(.coderReadCorrupt) }
        for attempt in 0..<2 {
            let options = try await query("projectTagsEditOptions", [id])
            let project = options.object("project")
            guard options.count == 4, !options.text("revision").isEmpty,
                  let canEdit = options["canEdit"] as? NSNumber,
                  CFGetTypeID(canEdit) == CFBooleanGetTypeID(),
                  let suggestions = options["suggestions"] as? [String],
                  suggestions.allSatisfy({ $0.utf16.count <= 100_000 }),
                  project.count == 7, project.text("id") == id,
                  (project["title"] as? String).map({ $0.utf16.count <= 100_000 }) == true,
                  ["active", "waiting", "someday", "archived"].contains(project.text("status")),
                  let tags = project["tagIds"] as? [String], tags.count <= 100_000,
                  tags.allSatisfy({ $0.utf16.count <= 100_000 }),
                  project["rev"] is NSNull || (project["rev"] as? Int).map({ $0 >= 0 }) == true,
                  project["revBy"] is NSNull || (project["revBy"] as? String)
                    .map({ $0.utf16.count <= 500 }) == true,
                  TaskDatePickerComponents.instant(project.text("updatedAt")) != nil,
                  canEdit.boolValue == (project.text("status") != "archived") else {
                throw CocoaError(.coderReadCorrupt)
            }
            if options.text("revision") == projectDetail.text("mutationRevision"), projectCurrent,
               projectDetail.text("projectId") == id, projectHeader.text("id") == id {
                if let opening = projectTagsOpeningRaw {
                    guard sameRawProjectTags(opening, tags) else { throw CocoaError(.coderReadCorrupt) }
                } else { projectTagsOpeningRaw = tags }
                projectTagsOptions = options
                projectTagsOptionsCurrent = true
                projectTagsReadError = nil
                return
            }
            if attempt == 0 {
                await readProjectDetail()
                guard projectCurrent, projectDetail.text("projectId") == id else {
                    throw CocoaError(.coderReadCorrupt)
                }
            }
        }
        throw CocoaError(.coderReadCorrupt)
    }

    func retryProjectTagsRead() async {
        guard ready, selectedSurface == .project, projectTagsPresented,
              !busy, !retryNeeded, projectTagsRequest == nil else { return }
        let id = projectHeader.text("id")
        busy = true
        defer { finishOperation() }
        do {
            try await refreshProjectTagsAfterWrite()
            try await readProjectTagsOptions(projectID: id)
            projectTagsError = nil
            projectTagsReadError = nil
            error = nil
        } catch { projectTagsReadError = error.localizedDescription }
    }

    func openProjectTagsAdd() {
        guard projectTagsChoiceEnabled else { return }
        projectTagsAddPresented = true
        projectTagsDraft = ""
        projectTagsError = nil
    }

    func cancelProjectTagsAdd() {
        guard projectTagsAddPresented, !busy, !retryNeeded, projectTagsRequest == nil else { return }
        projectTagsAddPresented = false
        projectTagsDraft = ""
        projectTagsError = nil
    }

    func setProjectTagsDraft(_ value: String) {
        guard projectTagsAddInputEnabled else { return }
        projectTagsDraft = value
        projectTagsError = nil
    }

    func addProjectTag() async {
        guard projectTagsAddCanSubmit else { return }
        let id = projectHeader.text("id")
        let input = projectTagsDraft
        guard await flushProjectNotesEdit(), projectTagsPresented, projectTagsAddPresented,
              projectHeader.text("id") == id, !busy, !retryNeeded,
              projectTagsRequest == nil, Data(projectTagsDraft.utf8) == Data(input.utf8) else { return }
        busy = true
        projectTagsError = nil
        defer { finishOperation() }
        await performProjectTagsWrite(["kind": "add", "input": input], projectID: id)
    }

    func toggleProjectTag(_ index: Int) async {
        let suggestions = projectTagsOptions["suggestions"] as? [String] ?? []
        guard projectTagsChoiceEnabled, suggestions.indices.contains(index) else { return }
        let input = suggestions[index]
        let id = projectHeader.text("id")
        guard await flushProjectNotesEdit(), projectTagsPresented, !projectTagsAddPresented,
              projectHeader.text("id") == id, !busy, !retryNeeded,
              projectTagsRequest == nil else { return }
        busy = true
        projectTagsError = nil
        defer { finishOperation() }
        await performProjectTagsWrite(["kind": "toggle", "input": input],
                                      projectID: id, tappedSuggestion: input)
    }

    func clearProjectTags() async {
        guard projectTagsChoiceEnabled else { return }
        let id = projectHeader.text("id")
        guard await flushProjectNotesEdit(), projectTagsPresented, !projectTagsAddPresented,
              projectHeader.text("id") == id, !busy, !retryNeeded,
              projectTagsRequest == nil else { return }
        busy = true
        projectTagsError = nil
        defer { finishOperation() }
        await performProjectTagsWrite(["kind": "clear"], projectID: id)
    }

    private func performProjectTagsWrite(_ intent: CoreObject, projectID id: String,
                                         tappedSuggestion: String? = nil) async {
        do {
            try await readProjectTagsOptions(projectID: id)
            let project = projectTagsOptions.object("project")
            guard projectTagsOptionsCurrent, projectTagsOptions.flag("canEdit"),
                  project.text("id") == id,
                  projectTagsOptions.text("revision") == projectDetail.text("mutationRevision") else {
                throw CocoaError(.coderReadCorrupt)
            }
            if let tappedSuggestion {
                let raw = Data(tappedSuggestion.utf8)
                guard (projectTagsOptions["suggestions"] as? [String])?.contains(where: {
                    Data($0.utf8) == raw
                }) == true else { throw CocoaError(.coderReadCorrupt) }
            }
            let expected: CoreObject = [
                "title": project.text("title"), "status": project.text("status"),
                "tagIds": project["tagIds"]!, "rev": project["rev"]!,
                "revBy": project["revBy"]!, "updatedAt": project.text("updatedAt")
            ]
            projectTagsRequest = try json(["requestId": UUID().uuidString.lowercased(),
                                           "projectId": id, "intent": intent, "expected": expected])
            projectTagsExpectedID = id
        } catch {
            projectTagsReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("projectTagsWrite", [projectTagsRequest!]) }
        catch { await handleProjectTagsWriteError(error); return }
        do {
            let accepted = try acknowledgeProjectTags(result)
            try await refreshProjectTagsAfterWrite()
            if !accepted, projectTagsPresented {
                try await readProjectTagsOptions(projectID: id)
            }
        } catch {
            if projectTagsRequest != nil { await handleProjectTagsWriteError(error) }
            else { projectTagsReadError = error.localizedDescription; self.error = error.localizedDescription }
        }
    }

    @discardableResult private func acknowledgeProjectTags(_ result: CoreObject) throws -> Bool {
        guard projectTagsRequest != nil, let id = projectTagsExpectedID else {
            throw CocoaError(.coderReadCorrupt)
        }
        if result.count == 1 && result["blocked"] as? String == "" {
            projectTagsRequest = nil
            projectTagsExpectedID = nil
            projectTagsOptionsCurrent = false
            retryNeeded = false
            projectTagsError = nil
            error = nil
            return false
        }
        guard result.count == 2, result.text("id") == id,
              let tags = result["tagIds"] as? [String], tags.count <= 100_000,
              tags.allSatisfy({ $0.utf16.count <= 100_000 }) else {
            throw CocoaError(.coderReadCorrupt)
        }
        projectTagsRequest = nil
        projectTagsExpectedID = nil
        projectTagsPresented = false
        projectTagsAddPresented = false
        projectTagsOptions = [:]
        projectTagsOptionsCurrent = false
        projectTagsOpeningRaw = nil
        projectTagsDraft = ""
        retryNeeded = false
        projectTagsError = nil
        projectTagsReadError = nil
        error = nil
        return true
    }

    private func handleProjectTagsWriteError(_ failure: Error) async {
        if projectTagsRequest != nil && isDefiniteRejection(failure) {
            projectTagsRequest = nil
            projectTagsExpectedID = nil
            projectTagsOptionsCurrent = false
            retryNeeded = false
            projectTagsError = failure.localizedDescription
            error = nil
            do {
                try await refreshProjectTagsAfterWrite()
                try await readProjectTagsOptions(projectID: projectHeader.text("id"))
            } catch { projectTagsReadError = error.localizedDescription }
        } else {
            retryNeeded = projectTagsRequest != nil
            projectTagsError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    private func refreshProjectTagsAfterWrite() async throws {
        try await readSelectedSurface()
        guard selectedSurface == .project, projectCurrent,
              projectDetail.text("projectId") == projectHeader.text("id") else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    func openProjectAreaCreate() async {
        let id = projectHeader.text("id")
        guard projectAreaAddEnabled, !id.isEmpty else { return }
        guard await flushProjectNotesEdit(), projectHeader.text("id") == id,
              projectAreaAddEnabled else { return }
        projectAreaCreatePresented = true
        projectAreaCreateProjectID = id
        projectAreaCreateName = ""
        projectAreaCreateColor = ""
        projectAreaCreateNameTaken = false
        projectAreaCreateNameChecking = false
        projectAreaCreateNameValid = false
        areaCreateNameGeneration += 1
        areaCreateOptionsCurrent = false
        areaCreateError = nil
        areaCreateReadError = nil
        busy = true
        defer { finishOperation() }
        do { try await readAreaCreateOptions() }
        catch { areaCreateReadError = error.localizedDescription }
    }

    func cancelProjectAreaCreate() {
        guard projectAreaCreatePresented, !busy, !retryNeeded,
              areaCreateRequest == nil, projectAreaRequest == nil else { return }
        projectAreaCreatePresented = false
        projectAreaCreateProjectID = nil
        projectAreaCreateName = ""
        projectAreaCreateNameTaken = false
        projectAreaCreateNameChecking = false
        projectAreaCreateNameValid = false
        areaCreateNameGeneration += 1
        areaCreateError = nil
        areaCreateReadError = nil
    }

    func setProjectAreaCreateName(_ name: String) {
        guard projectAreaCreateInputEnabled, name != projectAreaCreateName else { return }
        projectAreaCreateName = name
        projectAreaCreateNameValid = false
        areaCreateError = nil
        areaCreateReadError = nil
        scheduleAreaCreateNameCheck()
    }

    func selectProjectAreaCreateColor(_ color: String) {
        guard projectAreaCreateInputEnabled,
              (areaCreateOptions["colors"] as? [String])?.contains(color) == true else { return }
        projectAreaCreateColor = color
        areaCreateError = nil
    }

    func retryProjectAreaCreateRead() async {
        guard ready, projectAreaCreatePresented, !busy, !retryNeeded,
              areaCreateRequest == nil, projectAreaRequest == nil,
              let id = projectAreaCreateProjectID else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await refreshProjectAreaAfterWrite()
            try await readProjectAreaOptions(projectID: id)
            try await readAreaCreateOptions()
            scheduleAreaCreateNameCheck()
            areaCreateReadError = nil
            projectAreaReadError = nil
        } catch { areaCreateReadError = error.localizedDescription }
    }

    private func invalidateAreaManagerOptions() {
        areaCreateOptionsCurrent = false
        areaColorOptionsCurrent = false
        areaOrderOptionsCurrent = false
        areaDeleteOptionsCurrent = false
    }

    private func readAreaManagerOptions() async throws {
        invalidateAreaManagerOptions()
        do { try await readAreaCreateOptions() }
        catch { areaCreateReadError = error.localizedDescription; throw error }
        do { try await readAreaColorOptions() }
        catch { areaColorReadError = error.localizedDescription; throw error }
        do { try await readAreaOrderOptions() }
        catch { areaOrderReadError = error.localizedDescription; throw error }
        do { try await readAreaDeleteOptions() }
        catch { areaDeleteReadError = error.localizedDescription; throw error }
        scheduleAreaCreateNameCheck()
    }

    private func refreshAreaManagerAfterWrite() async throws {
        let projectID = areaManagerProjectID
        invalidateAreaManagerOptions()
        try await readSelectedSurface()
        if let projectID {
            guard areaManagerProjectID == projectID, areaManagerProjectOriginCurrent else {
                throw CocoaError(.coderReadCorrupt)
            }
            projectAreaOpeningAssociation = nil
            try await readProjectAreaOptions(projectID: projectID)
            guard areaManagerContextCurrent else { throw CocoaError(.coderReadCorrupt) }
        } else {
            guard areaManagerPresented, selectedSurface == .projects else {
                throw CocoaError(.coderReadCorrupt)
            }
        }
        try await readAreaManagerOptions()
    }

    private func prepareAreaManagerPresentation(projectID: String?) {
        areaManagerProjectID = projectID
        areaManagerPresented = true
        expandedAreaColorID = nil
        areaColorIntentID = nil
        areaColorIntentColor = nil
        areaColorError = nil
        areaColorReadError = nil
        areaOrderIntent = nil
        areaOrderError = nil
        areaOrderReadError = nil
        clearAreaRenameForm()
        areaDeleteIntentID = nil
        areaDeleteError = nil
        areaDeleteReadError = nil
        invalidateAreaManagerOptions()
    }

    private func dismissAreaManagerPresentation() {
        areaManagerPresented = false
        areaManagerProjectID = nil
        areaCreateNameGeneration += 1
        areaCreateNameChecking = false
        expandedAreaColorID = nil
        areaColorIntentID = nil
        areaColorIntentColor = nil
        areaColorError = nil
        areaOrderIntent = nil
        areaOrderError = nil
        areaDeleteIntentID = nil
        areaDeleteError = nil
    }

    func openAreaManager() async {
        guard projectCreateInputEnabled else { return }
        prepareAreaManagerPresentation(projectID: nil)
        busy = true
        defer { finishOperation() }
        do { try await readAreaManagerOptions() }
        catch { /* The failing options read publishes its own reachable retry. */ }
    }

    func openProjectAreaManager() async {
        let id = projectHeader.text("id")
        guard projectAreaManagerOpenEnabled, !id.isEmpty,
              projectAreaOptions.object("project").text("id") == id else { return }
        projectAreaCreateProjectID = id
        projectAreaCreatedID = nil
        projectAreaCreateDurableChange = false
        prepareAreaManagerPresentation(projectID: id)
        busy = true
        defer { finishOperation() }
        do { try await readAreaManagerOptions() }
        catch { /* The failing options read publishes its own reachable retry. */ }
    }

    func closeAreaManager() {
        guard areaManagerCloseEnabled else { return }
        let fromProject = areaManagerProjectID != nil
        dismissAreaManagerPresentation()
        if fromProject { dismissProjectAreaPresentation() }
    }

    func setAreaCreateName(_ name: String) {
        guard areaCreateInputEnabled, Data(name.utf8) != Data(areaCreateName.utf8) else { return }
        areaCreateName = name
        areaCreateError = nil
        if areaCreateOptionsCurrent { areaCreateReadError = nil }
        scheduleAreaCreateNameCheck()
    }

    func selectAreaCreateColor(_ color: String) {
        guard areaCreateInputEnabled, (areaCreateOptions["colors"] as? [String])?.contains(color) == true else { return }
        areaCreateColor = color
        areaCreateError = nil
    }

    private func scheduleAreaCreateNameCheck() {
        areaCreateNameGeneration += 1
        let generation = areaCreateNameGeneration
        let forProject = projectAreaCreatePresented
        let name = forProject ? projectAreaCreateName : areaCreateName
        if forProject {
            projectAreaCreateNameTaken = false
            projectAreaCreateNameValid = false
        }
        else { areaCreateNameTaken = false }
        guard (forProject ? projectAreaCreatePresented : areaManagerPresented),
              (forProject ? !name.isEmpty : !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) else {
            if forProject { projectAreaCreateNameChecking = false }
            else { areaCreateNameChecking = false }
            return
        }
        if forProject { projectAreaCreateNameChecking = true }
        else { areaCreateNameChecking = true }
        Task {
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard generation == areaCreateNameGeneration,
                  (forProject ? projectAreaCreatePresented : areaManagerPresented),
                  areaCreateRequest == nil, areaColorRequest == nil, areaOrderRequest == nil,
                  areaRenameRequest == nil, areaDeleteRequest == nil else { return }
            do {
                let result = try await query("areaCreateResolve", [try json([
                    "requestId": UUID().uuidString.lowercased(), "name": name,
                ])])
                guard generation == areaCreateNameGeneration,
                      (forProject ? projectAreaCreatePresented : areaManagerPresented),
                      areaColorRequest == nil, areaOrderRequest == nil,
                      areaRenameRequest == nil, areaDeleteRequest == nil else { return }
                if forProject {
                    guard let normalizedName = result["normalizedName"] as? String else {
                        throw CocoaError(.coderReadCorrupt)
                    }
                    projectAreaCreateNameValid = !normalizedName.isEmpty
                    projectAreaCreateNameTaken = result.flag("taken")
                }
                else { areaCreateNameTaken = result.flag("taken") }
                if areaCreateOptionsCurrent { areaCreateReadError = nil }
            } catch {
                guard generation == areaCreateNameGeneration,
                      (forProject ? projectAreaCreatePresented : areaManagerPresented),
                      areaColorRequest == nil, areaOrderRequest == nil,
                      areaRenameRequest == nil, areaDeleteRequest == nil else { return }
                if forProject && error.localizedDescription.hasPrefix("INVALID_INPUT:") {
                    projectAreaCreateNameValid = false
                    areaCreateReadError = nil
                } else { areaCreateReadError = error.localizedDescription }
            }
            if forProject { projectAreaCreateNameChecking = false }
            else { areaCreateNameChecking = false }
        }
    }

    private func readAreaCreateOptions() async throws {
        areaCreateOptionsCurrent = false
        let options = try await query("areaCreateOptions")
        guard !options.text("revision").isEmpty,
              let colors = options["colors"] as? [String], !colors.isEmpty,
              let areas = options["areas"] as? [CoreObject],
              areas.allSatisfy({ !$0.text("id").isEmpty && !$0.text("name").isEmpty }) else {
            throw CocoaError(.coderReadCorrupt)
        }
        if projectAreaCreatePresented {
            if !colors.contains(projectAreaCreateColor) { projectAreaCreateColor = options.text("defaultColor") }
            guard colors.contains(projectAreaCreateColor) else { throw CocoaError(.coderReadCorrupt) }
        } else {
            if !colors.contains(areaCreateColor) { areaCreateColor = options.text("defaultColor") }
            guard colors.contains(areaCreateColor) else { throw CocoaError(.coderReadCorrupt) }
        }
        areaCreateOptions = options
        areaCreateOptionsCurrent = true
        areaCreateReadError = nil
    }

    func addArea() async {
        let fromProjectForm = projectAreaCreatePresented
        let fromProjectManager = areaManagerProjectID != nil
        let assignsProject = fromProjectForm || fromProjectManager
        guard (fromProjectForm ? projectAreaCreateCanSubmit : areaCreateCanSubmit) else { return }
        let projectID = projectAreaCreateProjectID
        busy = true
        areaCreateNameGeneration += 1
        if fromProjectForm { projectAreaCreateNameChecking = false }
        else { areaCreateNameChecking = false }
        defer { finishOperation() }
        if assignsProject {
            do {
                guard let projectID, projectHeader.text("id") == projectID,
                      !fromProjectManager || areaManagerProjectID == projectID else {
                    throw CocoaError(.coderReadCorrupt)
                }
                try await refreshProjectAreaAfterWrite()
                try await readProjectAreaOptions(projectID: projectID)
                guard projectAreaOptions.flag("canEdit") else { throw CocoaError(.coderReadCorrupt) }
            } catch { areaCreateReadError = error.localizedDescription; return }
        }
        let name = fromProjectForm ? projectAreaCreateName
            : fromProjectManager ? areaCreateName
            : areaCreateName.trimmingCharacters(in: .whitespacesAndNewlines)
        let color = fromProjectForm ? projectAreaCreateColor : areaCreateColor
        let id = UUID().uuidString.lowercased()
        let request: String
        do {
            let resolved = try await query("areaCreateResolve", [try json(["requestId": id, "name": name])])
            if resolved.flag("taken") {
                if fromProjectForm { projectAreaCreateNameTaken = true }
                else { areaCreateNameTaken = true }
                areaCreateError = nil
                return
            }
            let expected = resolved.text("expectedAreaId")
            guard !expected.isEmpty else { throw CocoaError(.coderReadCorrupt) }
            request = try json(["requestId": id, "name": name, "color": color, "expectedAreaId": expected])
            areaCreateRequest = request
            areaCreateExpectedID = expected
        } catch {
            areaCreateReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("areaCreate", [request]) }
        catch { await handleAreaCreateWriteError(error); return }
        do { try acknowledgeAreaCreate(result) }
        catch { await handleAreaCreateWriteError(error); return }
        if assignsProject {
            await completeProjectAreaCreation(projectID: projectID)
            return
        }
        do {
            try await refreshAreaManagerAfterWrite()
            areaManagerPresented = false
        } catch {
            areaCreateReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeAreaCreate(_ result: CoreObject) throws {
        guard areaCreateRequest != nil, let expected = areaCreateExpectedID,
              result.count == 2, result["created"] is Bool, result.text("id") == expected else {
            throw CocoaError(.coderReadCorrupt)
        }
        areaCreateRequest = nil
        areaCreateExpectedID = nil
        retryNeeded = false
        if projectAreaCreatePresented || areaManagerProjectID != nil {
            projectAreaCreatedID = expected
            projectAreaCreateDurableChange = result["created"] as? Bool == true
            if projectAreaCreatePresented {
                projectAreaCreatePresented = false
                projectAreaCreateName = ""
                projectAreaCreateNameTaken = false
                projectAreaCreateNameValid = false
            } else {
                areaCreateName = ""
                areaCreateNameTaken = false
            }
        } else {
            areaCreateName = ""
            areaCreateNameTaken = false
        }
        areaCreateError = nil
        areaCreateReadError = nil
        error = nil
    }

    private func handleAreaCreateWriteError(_ failure: Error) async {
        if areaCreateRequest != nil && isDefiniteRejection(failure) {
            areaCreateRequest = nil
            areaCreateExpectedID = nil
            retryNeeded = false
            areaCreateError = failure.localizedDescription
            error = nil
            do {
                if projectAreaCreatePresented {
                    guard let id = projectAreaCreateProjectID else { throw CocoaError(.coderReadCorrupt) }
                    try await refreshProjectAreaAfterWrite()
                    try await readProjectAreaOptions(projectID: id)
                    try await readAreaCreateOptions()
                } else { try await refreshAreaManagerAfterWrite() }
            } catch { areaCreateReadError = error.localizedDescription }
        } else {
            retryNeeded = areaCreateRequest != nil
            areaCreateError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    private func completeProjectAreaCreation(projectID: String?) async {
        guard let id = projectAreaCreatedID, let projectID,
              projectAreaCreateProjectID == projectID,
              selectedSurface == .project, projectAreaPresented,
              projectHeader.text("id") == projectID,
              areaManagerProjectID == nil || areaManagerProjectID == projectID else {
            projectAreaReadError = CocoaError(.coderReadCorrupt).localizedDescription
            return
        }
        do {
            try await refreshProjectAreaAfterWrite()
            try await readProjectAreaOptions(projectID: projectID)
            guard projectAreaOptions.flag("canEdit"),
                  let row = projectAreaOptions.objects("areas").first(where: { $0.text("id") == id }) else {
                throw CocoaError(.coderReadCorrupt)
            }
            let selectedName = row.text("label")
            await performProjectAreaWrite(id, name: selectedName, projectID: projectID)
        } catch { projectAreaReadError = error.localizedDescription }
    }

    func retryAreaCreateRead() async {
        guard areaManagerPresented, !busy, !retryNeeded,
              areaCreateRequest == nil, areaColorRequest == nil, areaOrderRequest == nil,
              areaRenameRequest == nil, areaDeleteRequest == nil else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await refreshAreaManagerAfterWrite()
            error = nil
        } catch { areaCreateReadError = error.localizedDescription }
    }

    func toggleAreaColorPicker(_ id: String) {
        guard areaColorInputEnabled,
              areaColorOptions.objects("areas").contains(where: { $0.text("id") == id }) else { return }
        if expandedAreaColorID != id {
            areaColorIntentID = nil
            areaColorIntentColor = nil
            areaColorError = nil
        }
        expandedAreaColorID = expandedAreaColorID == id ? nil : id
    }

    private func readAreaColorOptions() async throws {
        areaColorOptionsCurrent = false
        let options = try await query("areaColorOptions")
        guard !options.text("revision").isEmpty,
              let colors = options["colors"] as? [String], !colors.isEmpty,
              let areas = options["areas"] as? [CoreObject],
              areas.allSatisfy({ row in
                  !row.text("id").isEmpty && !row.text("name").isEmpty && !row.text("updatedAt").isEmpty
                      && (row["color"] is String || row["color"] is NSNull)
                      && (row["rev"] is Int || row["rev"] is NSNull)
                      && (row["revBy"] is String || row["revBy"] is NSNull)
              }) else { throw CocoaError(.coderReadCorrupt) }
        areaColorOptions = options
        areaColorOptionsCurrent = true
        areaColorReadError = nil
    }

    func changeAreaColor(_ id: String, color: String?) async {
        guard areaColorInputEnabled,
              let row = areaColorOptions.objects("areas").first(where: { $0.text("id") == id }),
              color.map({ (areaColorOptions["colors"] as? [String])?.contains($0) == true }) ?? true else { return }
        busy = true
        areaCreateNameGeneration += 1
        areaCreateNameChecking = false
        expandedAreaColorID = nil
        areaColorIntentID = id
        areaColorIntentColor = color
        areaColorError = nil
        defer { finishOperation() }
        let request: String
        do {
            let expected: CoreObject = ["name": row.text("name"), "color": row["color"] ?? NSNull(),
                                        "rev": row["rev"] ?? NSNull(), "revBy": row["revBy"] ?? NSNull(),
                                        "updatedAt": row.text("updatedAt")]
            let requestedColor: Any = color.map { $0 as Any } ?? NSNull()
            request = try json(["requestId": UUID().uuidString.lowercased(), "areaId": id,
                                "color": requestedColor, "expected": expected])
            areaColorRequest = request
            areaColorExpectedID = id
        } catch {
            areaColorReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("areaColor", [request]) }
        catch { await handleAreaColorWriteError(error); return }
        do { try acknowledgeAreaColor(result) }
        catch { await handleAreaColorWriteError(error); return }
        do {
            try await refreshAreaManagerAfterWrite()
        } catch {
            areaColorReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeAreaColor(_ result: CoreObject) throws {
        guard areaColorRequest != nil, let expected = areaColorExpectedID,
              result.count == 2, result.text("id") == expected,
              (areaColorIntentColor.map { result["color"] as? String == $0 }
                  ?? (result["color"] is NSNull)) else { throw CocoaError(.coderReadCorrupt) }
        areaColorRequest = nil
        areaColorExpectedID = nil
        retryNeeded = false
        areaColorIntentID = nil
        areaColorIntentColor = nil
        areaColorError = nil
        areaColorReadError = nil
        error = nil
    }

    private func handleAreaColorWriteError(_ failure: Error) async {
        if areaColorRequest != nil && isDefiniteRejection(failure) {
            areaColorRequest = nil
            areaColorExpectedID = nil
            retryNeeded = false
            areaColorError = failure.localizedDescription
            expandedAreaColorID = areaColorIntentID
            error = nil
            do {
                try await refreshAreaManagerAfterWrite()
            } catch { areaColorReadError = error.localizedDescription }
        } else {
            retryNeeded = areaColorRequest != nil
            areaColorError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    func retryAreaColorRead() async {
        guard areaManagerPresented, !busy, !retryNeeded,
              areaCreateRequest == nil, areaColorRequest == nil, areaOrderRequest == nil,
              areaRenameRequest == nil, areaDeleteRequest == nil else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await refreshAreaManagerAfterWrite()
            areaColorReadError = nil
            error = nil
        } catch { areaColorReadError = error.localizedDescription }
    }

    private func readAreaOrderOptions() async throws {
        areaOrderOptionsCurrent = false
        let options = try await query("areaOrderOptions")
        guard !options.text("revision").isEmpty,
              let areas = options["areas"] as? [CoreObject],
              Set(areas.map { $0.text("id") }).count == areas.count,
              areas.allSatisfy({ row in
                  !row.text("id").isEmpty && !row.text("name").isEmpty && !row.text("updatedAt").isEmpty
                      && (row["color"] is String || row["color"] is NSNull)
                      && (row["order"] as? NSNumber)?.doubleValue.isFinite == true
                      && (row["rev"] is Int || row["rev"] is NSNull)
                      && (row["revBy"] is String || row["revBy"] is NSNull)
              }) else { throw CocoaError(.coderReadCorrupt) }
        areaOrderOptions = options
        areaOrderOptionsCurrent = true
        areaOrderReadError = nil
    }

    func changeAreaOrder(_ kind: String, areaID: String? = nil) async {
        guard areaOrderInputEnabled, ["moveUp", "sortName", "sortColor"].contains(kind) else { return }
        let rows = areaOrderOptions.objects("areas")
        if kind == "moveUp" {
            guard let areaID, let index = rows.firstIndex(where: { $0.text("id") == areaID }),
                  index > 0 else { return }
        } else { guard areaID == nil else { return } }
        busy = true
        areaCreateNameGeneration += 1
        areaCreateNameChecking = false
        expandedAreaColorID = nil
        let intent: CoreObject = kind == "moveUp" ? ["kind": kind, "areaId": areaID!] : ["kind": kind]
        areaOrderIntent = intent
        areaOrderError = nil
        defer { finishOperation() }
        let request: String
        do {
            request = try json(["requestId": UUID().uuidString.lowercased(),
                                "intent": intent, "expectedAreas": rows])
            areaOrderRequest = request
            areaOrderExpectedIDs = rows.map { $0.text("id") }
        } catch {
            areaOrderReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("areaOrder", [request]) }
        catch { await handleAreaOrderWriteError(error); return }
        do { try acknowledgeAreaOrder(result) }
        catch { await handleAreaOrderWriteError(error); return }
        do { try await refreshAreaManagerAfterWrite() }
        catch {
            areaOrderReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeAreaOrder(_ result: CoreObject) throws {
        guard areaOrderRequest != nil, let expected = areaOrderExpectedIDs,
              result.count == 1, let ordered = result["orderedIds"] as? [String],
              ordered.count == expected.count, Set(ordered).count == ordered.count,
              Set(ordered) == Set(expected) else { throw CocoaError(.coderReadCorrupt) }
        areaOrderRequest = nil
        areaOrderExpectedIDs = nil
        retryNeeded = false
        areaOrderIntent = nil
        areaOrderError = nil
        areaOrderReadError = nil
        error = nil
    }

    private func handleAreaOrderWriteError(_ failure: Error) async {
        if areaOrderRequest != nil && isDefiniteRejection(failure) {
            areaOrderRequest = nil
            areaOrderExpectedIDs = nil
            retryNeeded = false
            areaOrderError = failure.localizedDescription
            error = nil
            do { try await refreshAreaManagerAfterWrite() }
            catch { areaOrderReadError = error.localizedDescription }
        } else {
            retryNeeded = areaOrderRequest != nil
            areaOrderError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    func retryAreaOrderRead() async {
        guard areaManagerPresented, !busy, !retryNeeded,
              areaCreateRequest == nil, areaColorRequest == nil, areaOrderRequest == nil,
              areaRenameRequest == nil, areaDeleteRequest == nil else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await refreshAreaManagerAfterWrite()
            areaOrderReadError = nil
            error = nil
        } catch { areaOrderReadError = error.localizedDescription }
    }

    private func areaRenameToken(_ row: CoreObject) -> CoreObject? {
        guard !row.text("id").isEmpty, !row.text("name").isEmpty, !row.text("updatedAt").isEmpty,
              row["color"] is String || row["color"] is NSNull,
              (row["order"] as? NSNumber)?.doubleValue.isFinite == true,
              row["rev"] is Int || row["rev"] is NSNull,
              row["revBy"] is String || row["revBy"] is NSNull else { return nil }
        return ["id": row.text("id"), "name": row.text("name"),
                "color": row["color"] ?? NSNull(), "order": row["order"] ?? NSNull(),
                "rev": row["rev"] ?? NSNull(), "revBy": row["revBy"] ?? NSNull(),
                "updatedAt": row.text("updatedAt")]
    }

    private func clearAreaRenameForm() {
        areaRenameEditingID = nil
        areaRenameOriginalName = ""
        areaRenameDraft = ""
        areaRenameError = nil
        areaRenameReadError = nil
        areaRenameOpeningExpected = nil
        areaRenameExpectedSourceID = nil
        areaRenameCloseAfterRefresh = false
    }

    func openAreaRename(_ id: String) {
        guard areaRenameOpenEnabled,
              let row = areaOrderOptions.objects("areas").first(where: { $0.text("id") == id }),
              let expected = areaRenameToken(row) else { return }
        areaRenameEditingID = id
        areaRenameOriginalName = row.text("name")
        areaRenameDraft = row.text("name")
        areaRenameOpeningExpected = expected
        areaRenameError = nil
        areaRenameReadError = nil
        areaRenameCloseAfterRefresh = false
        expandedAreaColorID = nil
    }

    func setAreaRenameDraft(_ name: String) {
        guard areaRenameInputEnabled, Data(name.utf8) != Data(areaRenameDraft.utf8) else { return }
        areaRenameDraft = name
        areaRenameError = nil
    }

    var areaRenameCanCancel: Bool {
        ready && areaManagerPresented && areaManagerContextCurrent && areaRenameEditing
            && !busy && !retryNeeded && areaCreateRequest == nil && areaColorRequest == nil
            && areaOrderRequest == nil && areaRenameRequest == nil && areaDeleteRequest == nil
            && areaManagerProjectCompositionIdle
    }

    func cancelAreaRename() {
        guard areaRenameCanCancel else { return }
        clearAreaRenameForm()
    }

    func renameArea() async {
        guard areaRenameCanSubmit, let id = areaRenameEditingID,
              let expected = areaRenameOpeningExpected else { return }
        busy = true
        areaCreateNameGeneration += 1
        areaCreateNameChecking = false
        expandedAreaColorID = nil
        areaRenameError = nil
        defer { finishOperation() }
        let request: String
        do {
            request = try json(["requestId": UUID().uuidString.lowercased(), "areaId": id,
                                "name": areaRenameDraft, "expected": expected])
            areaRenameRequest = request
            areaRenameExpectedSourceID = id
        } catch {
            areaRenameReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("areaRename", [request]) }
        catch { await handleAreaRenameWriteError(error); return }
        do { try acknowledgeAreaRename(result) }
        catch { await handleAreaRenameWriteError(error); return }
        do {
            try await refreshAreaManagerAfterWrite()
            completeAreaRenameAfterRefresh()
        } catch {
            areaRenameReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeAreaRename(_ result: CoreObject) throws {
        guard areaRenameRequest != nil, let expected = areaRenameExpectedSourceID,
              result.count == 3, result.text("id") == expected,
              !result.text("areaId").isEmpty, !result.text("name").isEmpty else {
            throw CocoaError(.coderReadCorrupt)
        }
        areaRenameRequest = nil
        areaRenameExpectedSourceID = nil
        areaRenameCloseAfterRefresh = true
        retryNeeded = false
        areaRenameError = nil
        areaRenameReadError = nil
        error = nil
    }

    private func completeAreaRenameAfterRefresh() {
        guard areaRenameCloseAfterRefresh else { return }
        clearAreaRenameForm()
    }

    private func handleAreaRenameWriteError(_ failure: Error) async {
        if areaRenameRequest != nil && isDefiniteRejection(failure) {
            areaRenameRequest = nil
            areaRenameExpectedSourceID = nil
            areaRenameCloseAfterRefresh = false
            retryNeeded = false
            areaRenameError = failure.localizedDescription
            areaRenameReadError = failure.localizedDescription
            error = nil
        } else {
            retryNeeded = areaRenameRequest != nil
            areaRenameError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    func retryAreaRenameRead() async {
        guard areaManagerPresented, areaRenameEditing, !busy, !retryNeeded,
              areaCreateRequest == nil, areaColorRequest == nil, areaOrderRequest == nil,
              areaRenameRequest == nil, areaDeleteRequest == nil else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await refreshAreaManagerAfterWrite()
            if areaRenameCloseAfterRefresh {
                completeAreaRenameAfterRefresh()
            } else {
                guard let id = areaRenameEditingID,
                      let row = areaOrderOptions.objects("areas").first(where: { $0.text("id") == id }),
                      let expected = areaRenameToken(row) else { throw CocoaError(.coderReadCorrupt) }
                areaRenameOriginalName = row.text("name")
                areaRenameOpeningExpected = expected
                areaRenameError = nil
                areaRenameReadError = nil
            }
            error = nil
        } catch { areaRenameReadError = error.localizedDescription }
    }

    private func readAreaDeleteOptions() async throws {
        areaDeleteOptionsCurrent = false
        let options = try await query("areaDeleteOptions")
        guard !options.text("revision").isEmpty,
              let areas = options["areas"] as? [CoreObject],
              Set(areas.map { $0.text("id") }).count == areas.count,
              areas.allSatisfy({ row in
                  guard !row.text("id").isEmpty, !row.text("name").isEmpty,
                        !row.text("updatedAt").isEmpty,
                        row["color"] is String || row["color"] is NSNull,
                        (row["order"] as? NSNumber)?.doubleValue.isFinite == true,
                        row["rev"] is Int || row["rev"] is NSNull,
                        row["revBy"] is String || row["revBy"] is NSNull,
                        let count = row["projectCount"] as? NSNumber,
                        CFGetTypeID(count) != CFBooleanGetTypeID(),
                        count.doubleValue.isFinite, count.doubleValue >= 0,
                        count.doubleValue <= 9_007_199_254_740_991,
                        count.doubleValue.rounded(.towardZero) == count.doubleValue,
                        let eligible = row["canDelete"] as? NSNumber,
                        CFGetTypeID(eligible) == CFBooleanGetTypeID() else { return false }
                  return true
              }) else { throw CocoaError(.coderReadCorrupt) }
        areaDeleteOptions = options
        areaDeleteOptionsCurrent = true
        areaDeleteReadError = nil
    }

    func deleteArea(_ id: String) async {
        guard areaDeleteInputEnabled,
              let row = areaDeleteOptions.objects("areas").first(where: { $0.text("id") == id }),
              row.flag("canDelete") else { return }
        busy = true
        areaCreateNameGeneration += 1
        areaCreateNameChecking = false
        expandedAreaColorID = nil
        areaDeleteIntentID = id
        areaDeleteError = nil
        defer { finishOperation() }
        let request: String
        do {
            let expected: CoreObject = ["name": row.text("name"), "color": row["color"] ?? NSNull(),
                                        "order": row["order"] ?? NSNull(), "rev": row["rev"] ?? NSNull(),
                                        "revBy": row["revBy"] ?? NSNull(),
                                        "updatedAt": row.text("updatedAt")]
            request = try json(["requestId": UUID().uuidString.lowercased(), "areaId": id,
                                "expected": expected])
            areaDeleteRequest = request
            areaDeleteExpectedID = id
        } catch {
            areaDeleteReadError = error.localizedDescription
            return
        }
        let result: CoreObject
        do { result = try await query("areaDelete", [request]) }
        catch { await handleAreaDeleteWriteError(error); return }
        do { try acknowledgeAreaDelete(result) }
        catch { await handleAreaDeleteWriteError(error); return }
        do { try await refreshAreaManagerAfterWrite() }
        catch {
            areaDeleteReadError = error.localizedDescription
            self.error = error.localizedDescription
        }
    }

    private func acknowledgeAreaDelete(_ result: CoreObject) throws {
        guard areaDeleteRequest != nil, let expected = areaDeleteExpectedID,
              result.count == 1, result.text("areaId") == expected else { throw CocoaError(.coderReadCorrupt) }
        areaDeleteRequest = nil
        areaDeleteExpectedID = nil
        retryNeeded = false
        areaDeleteIntentID = nil
        areaDeleteError = nil
        areaDeleteReadError = nil
        error = nil
    }

    private func handleAreaDeleteWriteError(_ failure: Error) async {
        if areaDeleteRequest != nil && isDefiniteRejection(failure) {
            areaDeleteRequest = nil
            areaDeleteExpectedID = nil
            retryNeeded = false
            areaDeleteError = failure.localizedDescription
            error = nil
            do { try await refreshAreaManagerAfterWrite() }
            catch { areaDeleteReadError = error.localizedDescription }
        } else {
            retryNeeded = areaDeleteRequest != nil
            areaDeleteError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    func retryAreaDeleteRead() async {
        guard areaManagerPresented, !busy, !retryNeeded,
              areaCreateRequest == nil, areaColorRequest == nil, areaOrderRequest == nil,
              areaRenameRequest == nil, areaDeleteRequest == nil else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await refreshAreaManagerAfterWrite()
            areaDeleteReadError = nil
            error = nil
        } catch { areaDeleteReadError = error.localizedDescription }
    }

    func openBoard() async {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented else { return }
        morePresented = false
        selectedSurface = .board
        await refresh()
    }

    func presentBoardFilters(_ presented: Bool) {
        guard selectedSurface == .board, !retryNeeded, !taskPresented else { return }
        if presented { guard boardControlsEnabled else { return } }
        if !presented { closeBoardPicker() }
        boardFiltersPresented = presented
    }

    func openBoardPicker(_ name: String) {
        guard boardFiltersPresented, boardControlsEnabled, ["tokens", "projects"].contains(name) else { return }
        boardPickerName = name
        boardPickerQuery = ""
        boardDepth.removeValue(forKey: name)
        requestBoardRead(delay: 0)
    }

    func closeBoardPicker() {
        guard !boardPickerName.isEmpty else { return }
        let needsRead = !boardPickerQuery.isEmpty
        boardDepth.removeValue(forKey: boardPickerName)
        boardPickerName = ""
        boardPickerQuery = ""
        if needsRead { requestBoardRead(delay: 0) }
    }

    func setBoardPickerQuery(_ text: String) {
        guard boardFiltersPresented, !boardPickerName.isEmpty, !retryNeeded, !boardActionPending,
              !text.utf8.elementsEqual(boardPickerQuery.utf8) else { return }
        boardPickerQuery = text
        boardDepth.removeValue(forKey: boardPickerName)
        requestBoardRead()
    }

    func setBoardSearch(_ text: String) {
        guard selectedSurface == .board, !retryNeeded, !boardActionPending, !taskPresented, text != boardSearchText else { return }
        boardSearchText = text
        resetBoardCardDepth()
        requestBoardRead()
    }

    func boardSwipeAction(_ side: String) -> String? {
        let actions = boardView.object("cardActions").object("swipes").object(side)["actions"] as? [String]
        // Only the two supplied, single-action RN sequences are enabled in this slice.
        if side == "left", actions == ["duplicate"] { return "duplicateTask" }
        if side == "right", actions == ["trash"] { return "trashTask" }
        return nil
    }

    func performBoardSwipe(_ side: String, taskID: String) async {
        guard boardActionsEnabled, !morePresented, !capturePresented, !boardActionPending,
              let action = boardSwipeAction(side), boardView.objects("columns").contains(where: {
                  $0.objects("cards").contains(where: { $0.object("row").text("id") == taskID })
              }) else { return }
        let request: String
        do {
            request = try json(["requestId": UUID().uuidString,
                                "action": ["type": action, "taskId": taskID]])
        } catch { self.error = error.localizedDescription; return }
        boardActionRequest = request
        busy = true
        error = nil
        var boardTaskOpened = false
        defer {
            finishOperation()
            if boardTaskOpened { Task { await readTaskView() } }
        }
        let result: CoreObject
        do {
            result = try await query("boardAction", [request])
        } catch {
            // Only the host's typed, cleaned-up rejection proves no write is owed.
            // Every other failure retains this exact request and its private journal.
            if isDefiniteRejection(error) { boardActionRequest = nil }
            retryNeeded = boardActionPending
            self.error = error.localizedDescription
            return
        }
        boardTaskOpened = await acknowledgeBoardAction(result)
    }

    private func acknowledgeBoardAction(_ result: CoreObject) async -> Bool {
        boardActionRequest = nil
        retryNeeded = false
        error = nil
        // Navigation is blocked while the command is pending. Still never route
        // an acknowledgement onto a different surface if that state has changed.
        guard selectedSurface == .board else { return false }
        do { try await readSelectedSurface() } catch { self.error = error.localizedDescription }
        return presentAcknowledgedBoardTask(result)
    }

    private func presentAcknowledgedBoardTask(_ result: CoreObject) -> Bool {
        let open = result.object("open")
        guard selectedSurface == .board, !taskPresented, !capturePresented, !areaPickerPresented,
              open.text("tab") == "task", !open.text("taskId").isEmpty else { return false }
        // The trusted result may be outside the current filter or loaded page.
        // It is the frozen copy ID, never a source/current-selection lookup.
        prepareTaskPresentation(open.text("taskId"), initialTab: "task")
        return true
    }

    func editBoardFilters(_ edit: CoreObject) {
        guard boardControlsEnabled, !edit.isEmpty else { return }
        if edit.text("type") == "setSearch" { setBoardSearch(edit.text("value")); return }
        if edit.text("type") == "clear" { boardSearchText = "" }
        boardPendingEdit = edit
        resetBoardCardDepth()
        requestBoardRead(delay: 0)
    }

    private func resetBoardCardDepth() {
        boardDepth = boardDepth.filter { !$0.key.hasPrefix("cards:") }
        boardScrollAnchor = "board-top"
        boardScrollGeneration += 1
    }

    func loadMoreBoard(_ list: String, status: String = "") {
        guard boardControlsEnabled, boardCurrent else { return }
        let window: CoreObject
        if list == "cards" {
            guard let column = boardView.objects("columns").first(where: { $0.text("status") == status }) else { return }
            window = ["items": column.objects("cards"), "total": column.number("count")]
        } else {
            guard ["tokens", "projects", "chips"].contains(list) else { return }
            window = boardView.object("sheet").object(list)
        }
        guard window.objects("items").count < window.number("total") else { return }
        // Picker page zero is currently 100; card page zero is 50. Always use
        // the loaded count, including for chips, and rebuild at a fresh revision.
        boardDepth[list == "cards" ? list + ":" + status : list] = window.objects("items").count + pageSize
        requestBoardRead(delay: 0)
    }

    func retryBoard() {
        guard selectedSurface == .board, !busy, !retryNeeded, !taskPresented else { return }
        requestBoardRead(delay: 0)
    }

    private func requestBoardRead(delay: UInt64 = 150_000_000) {
        boardGeneration += 1
        boardReadTask?.cancel()
        boardCurrent = false
        boardLoading = true
        boardError = nil
        boardNeedsRead = true
        scheduleBoardRead(delay: delay)
    }

    private func scheduleBoardRead(delay: UInt64 = 150_000_000) {
        guard selectedSurface == .board, !busy, !retryNeeded, !taskPresented, !areaPickerPresented else { return }
        boardReadTask?.cancel()
        boardReadTask = Task {
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard !Task.isCancelled, selectedSurface == .board, !busy, !retryNeeded,
                  !taskPresented, !areaPickerPresented else { return }
            await readBoard()
        }
    }

    private func boardReadAllowed(_ generation: Int, ownsOperation: Bool) -> Bool {
        !Task.isCancelled && generation == boardGeneration && selectedSurface == .board
            && !retryNeeded && !taskPresented && (ownsOperation || (!areaPickerPresented && !busy))
    }

    private func readBoard(ownsOperation: Bool = false) async {
        let generation = boardGeneration
        let search = boardSearchText
        let picker = boardPickerName
        let pickerQuery = boardPickerQuery
        let edit = boardPendingEdit
        let depth = boardDepth
        boardNeedsRead = false
        boardCurrent = false
        boardLoading = true
        boardError = nil
        defer {
            if generation == boardGeneration {
                // Area or a temporary global operation can invalidate an awaited
                // response without settling this read. Keep its pure edit/depth
                // and wake it now, or when the existing gate closes.
                if !Task.isCancelled, selectedSurface == .board, !boardCurrent, boardError == nil {
                    boardNeedsRead = true
                    scheduleBoardRead(delay: 0)
                }
                boardLoading = boardNeedsRead
            }
        }
        for attempt in 0..<2 {
            do {
                var filters = boardFilters
                filters["searchQuery"] = search
                var input: CoreObject = ["filters": filters, "limit": pageSize]
                if let edit { input["filterEdit"] = edit }
                var next = try await query("menuRead", ["board", try json(input)])
                guard boardReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                // A search typed while a pure Clear was resolving wins over the
                // earlier Clear's query. All other filter normalization stays core.
                if next.object("filters").text("searchQuery") != search {
                    filters = next.object("filters")
                    filters["searchQuery"] = search
                    next = try await query("menuRead", ["board", try json(["filters": filters, "limit": pageSize])])
                    guard boardReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                }
                guard next.number("version") == 1, !next.text("revision").isEmpty,
                      !next.object("filters").isEmpty, next.objects("columns").count == 5 else {
                    throw CocoaError(.coderReadCorrupt)
                }
                let revision = next.text("revision")
                let resolved = next.object("filters")
                var columns = next.objects("columns")
                var sheet = next.object("sheet")
                // Stage every list against the same effective filters/revision;
                // publish only after all previously loaded windows are rebuilt.
                for key in columns.map({ "cards:" + $0.text("status") }) + ["tokens", "projects", "chips"] {
                    let status = key.hasPrefix("cards:") ? String(key.dropFirst(6)) : ""
                    let list = status.isEmpty ? key : "cards"
                    let index = columns.firstIndex(where: { $0.text("status") == status })
                    let first: CoreObject
                    if let index { first = ["total": columns[index].number("count"), "items": columns[index].objects("cards")] }
                    else if key == picker && !pickerQuery.isEmpty {
                        let params: CoreObject = ["filters": resolved, "revision": revision,
                            "list": list, "query": pickerQuery, "offset": 0, "limit": 100]
                        let page = try await query("menuRead", ["boardList", try json(params)])
                        guard boardReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                        guard page.number("version") == 1, page.text("revision") == revision,
                              page.text("list") == list, page.number("total") >= 0,
                              page.objects("items").count == min(100, page.number("total")) else {
                            throw CocoaError(.coderReadCorrupt)
                        }
                        first = page
                    } else { first = sheet.object(list) }
                    var entries = first.objects("items")
                    let total = first.number("total")
                    guard total >= 0, entries.count == min(list == "cards" ? pageSize : 100, total) else {
                        throw CocoaError(.coderReadCorrupt)
                    }
                    let target = min(max(entries.count, depth[key] ?? 0), total)
                    while entries.count < target {
                        let limit = min(pageSize, target - entries.count)
                        var params: CoreObject = ["filters": resolved, "revision": revision,
                            "list": list, "offset": entries.count, "limit": limit]
                        if !status.isEmpty { params["status"] = status }
                        if key == picker && !pickerQuery.isEmpty { params["query"] = pickerQuery }
                        let page = try await query("menuRead", ["boardList", try json(params)])
                        guard boardReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                        guard page.number("version") == 1, page.text("revision") == revision,
                              page.text("list") == list, page.number("total") == total,
                              page.objects("items").count == limit else { throw CocoaError(.coderReadCorrupt) }
                        entries += page.objects("items")
                    }
                    let ids = entries.map { list == "cards" ? $0.object("row").text("id") : $0.text(list == "tokens" ? "value" : "id") }
                    guard !ids.contains(""), Set(ids.map { Data($0.utf8) }).count == ids.count else {
                        throw CocoaError(.coderReadCorrupt)
                    }
                    if let index { columns[index]["cards"] = entries }
                    else { sheet[list] = ["total": total, "items": entries] }
                }
                next["columns"] = columns
                next["sheet"] = sheet
                boardFilters = resolved
                boardPendingEdit = nil
                boardView = next
                boardCurrent = true
                return
            } catch {
                guard !Task.isCancelled, generation == boardGeneration, selectedSurface == .board else { return }
                // A refused pure input is settled even if Area/More opened while
                // it was awaiting. Do not reapply that edit after the gate closes.
                if error.localizedDescription.hasPrefix("INVALID_INPUT:") {
                    boardPendingEdit = nil
                    boardError = error.localizedDescription
                    return
                }
                guard boardReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                // Retrying starts from the unchanged pre-edit state, so a pure
                // toggle is never applied twice after a stale nested page.
                if attempt == 1 {
                    // The edit is pure and the published filters are unchanged.
                    // Keep it for Retry if a later picker/page read fails.
                    if edit != nil {
                        NSLog("Native iOS Board filter retry releaseCheck=v1.3.4/ios-board-filter-retry outcome=retained")
                    }
                    boardError = error.localizedDescription
                }
            }
        }
    }

    func openCalendar() async {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented,
              !calendarComposerPresented else { return }
        morePresented = false
        selectedSurface = .calendar
        await refresh()
    }

    func navigateCalendar(_ target: CoreObject) async {
        guard calendarActionsEnabled, !target.isEmpty else { return }
        calendarNotice = nil
        if target.text("viewMode") != calendarView.object("state").text("viewMode") {
            await saveCalendarPreference("viewMode", value: target.text("viewMode"), target: target)
            return
        }
        calendarState = target
        calendarLoadedDepth = pageSize
        calendarScrollAnchor = ""
        calendarViewportAnchors.removeAll()
        calendarViewportGeneration += 1
        busy = true
        defer { finishOperation() }
        await readCalendar()
    }

    func selectCalendarMode(_ mode: String) async {
        guard calendarActionsEnabled, let option = calendarView.objects("modes").first(where: { $0.text("mode") == mode }) else { return }
        await saveCalendarPreference("viewMode", value: mode, target: option.object("state"))
    }

    func setCalendarShowCompleted(_ on: Bool) async {
        guard calendarActionsEnabled else { return }
        await saveCalendarPreference("showCompleted", value: on)
    }

    func setCalendarWeekDensity(_ days: Int) async {
        guard calendarActionsEnabled, calendarView.object("content").object("density").objects("choices")
            .contains(where: { $0.number("days") == days }) else { return }
        await saveCalendarPreference("weekVisibleDays", value: days)
    }

    private func saveCalendarPreference(_ field: String, value: Any, target: CoreObject? = nil) async {
        guard calendarActionsEnabled, let before = calendarPreferenceValues[field] else { return }
        let request: String
        do {
            request = try json(["requestId": UUID().uuidString, "field": field, "before": before, "value": value])
        } catch { calendarError = error.localizedDescription; return }
        busy = true
        calendarPreferencePending = true
        calendarPreferenceTarget = target
        calendarError = nil
        error = nil
        defer { finishOperation() }
        do {
            _ = try await query("calendarPreference", [request])
        } catch {
            if isDefiniteRejection(error) {
                calendarPreferencePending = false
                calendarPreferenceTarget = nil
                // A refused before-value never becomes an automatic overwrite of newer intent.
                await readCalendar()
                calendarError = error.localizedDescription
            } else {
                retryNeeded = true
                self.error = error.localizedDescription
            }
            return
        }
        acknowledgeCalendarPreference()
        await readCalendar()
    }

    private func acknowledgeCalendarPreference() {
        calendarPreferencePending = false
        if calendarPreferenceTarget != nil {
            calendarLoadedDepth = pageSize
            calendarScrollAnchor = ""
            calendarViewportAnchors.removeAll()
            calendarViewportGeneration += 1
        }
    }

    func selectCalendarDay(_ key: String) async {
        guard calendarActionsEnabled, calendarView.object("content").text("mode") == "month",
              calendarView.objects("items").contains(where: { $0.text("type") == "day" && $0.text("key") == key }) else { return }
        var state = calendarView.object("state")
        state["selectedDate"] = key
        await navigateCalendar(state)
    }

    func setCalendarQuery(_ text: String) {
        guard selectedSurface == .calendar, !retryNeeded, !taskPresented, !calendarItemPresented,
              !calendarComposerPresented, text != calendarQuery else { return }
        calendarScrollAnchor = "calendar-list-top"
        calendarNotice = nil
        calendarQuery = text
        calendarLoadedDepth = pageSize
        calendarCurrent = false
        calendarError = nil
        calendarNeedsRead = true
        scheduleCalendarRead()
    }

    private func scheduleCalendarRead() {
        guard selectedSurface == .calendar, !busy, !retryNeeded, !taskPresented, !calendarItemPresented,
              !calendarComposerPresented else { return }
        calendarReadTask?.cancel()
        calendarReadTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 150_000_000) } catch { return }
            guard let self, self.selectedSurface == .calendar, !self.busy, !self.retryNeeded,
                  !self.taskPresented, !self.calendarItemPresented, !self.calendarComposerPresented else { return }
            self.calendarReadTask = nil
            self.busy = true
            defer { self.finishOperation() }
            await self.readCalendar()
        }
    }

    func retryCalendar() async {
        guard selectedSurface == .calendar, !busy, !retryNeeded, !taskPresented, !calendarItemPresented,
              !calendarComposerPresented else { return }
        busy = true
        defer { finishOperation() }
        await readCalendar()
    }

    func loadMoreCalendar() async {
        guard calendarActionsEnabled, calendarView.objects("items").count < calendarView.number("total") else { return }
        calendarLoadedDepth = calendarView.objects("items").count + pageSize
        await retryCalendar()
    }

    func openCalendarComposer(_ entry: CoreObject) async {
        let openingState = calendarView.object("state")
        let day = openingState.text("selectedDate")
        let openingQuery = calendarQuery
        let openingRevision = calendarView.text("revision")
        guard calendarActionsEnabled, entry.text("type") == "task", !day.isEmpty,
              !entry.text("taskId").isEmpty,
              calendarView.objects("items").contains(where: {
                  $0.text("type") == "task" && $0.text("taskId") == entry.text("taskId")
                      && $0.text("list") == entry.text("list") && $0.text("title") == entry.text("title")
              }) else { return }
        busy = true
        calendarNotice = nil
        calendarComposerError = nil
        defer { finishOperation() }
        do {
            let result = try await query("calendarComposerOpen", [try json([
                "day": day, "scheduleTaskId": entry.text("taskId")
            ])])
            guard calendarComposerOpeningCurrent(query: openingQuery, revision: openingRevision, state: openingState) else { return }
            let view = result.object("composer")
            if view.isEmpty {
                let toast = result.object("toast")
                calendarNotice = [toast.text("title"), toast.text("message")].filter { !$0.isEmpty }.joined(separator: ": ")
                if calendarNotice?.isEmpty == true { calendarNotice = nil }
                return
            }
            guard view.object("composer").text("mode") == "existing" else { throw CocoaError(.coderReadCorrupt) }
            calendarComposerGeneration += 1
            calendarComposerEdits = []
            calendarComposerView = view
            syncCalendarComposerInputs()
            calendarComposerPresented = true
        } catch {
            if calendarComposerOpeningCurrent(query: openingQuery, revision: openingRevision, state: openingState) {
                calendarError = error.localizedDescription
            }
        }
    }

    func openNewCalendarComposer(day: String, rawMinutes: Double? = nil) async {
        let openingState = calendarView.object("state")
        let openingQuery = calendarQuery
        let openingRevision = calendarView.text("revision")
        let mode = openingState.text("viewMode")
        let validTarget: Bool
        if mode == "month" {
            validTarget = rawMinutes == nil && day == openingState.text("selectedDate")
                && !calendarView.object("content").object("details").isEmpty
        } else if mode == "week" {
            validTarget = rawMinutes == nil && calendarView.objects("items").contains {
                $0.text("type") == "day" && $0.text("key") == day
            }
        } else if mode == "day" {
            validTarget = day == calendarView.object("content").text("dayKey")
                && (rawMinutes.map { $0.isFinite && $0 >= 0 && $0 <= 1440 } ?? true)
        } else { validTarget = false }
        guard calendarActionsEnabled, validTarget, !day.isEmpty else { return }
        busy = true
        calendarNotice = nil
        calendarComposerError = nil
        defer { finishOperation() }
        do {
            var input: CoreObject = ["day": day, "mode": "new"]
            if let rawMinutes { input["rawMinutes"] = rawMinutes }
            let result = try await query("calendarComposerOpen", [try json(input)])
            guard calendarComposerOpeningCurrent(query: openingQuery, revision: openingRevision, state: openingState) else { return }
            let next = result.object("composer")
            if next.isEmpty {
                let toast = result.object("toast")
                calendarNotice = [toast.text("title"), toast.text("message")].filter { !$0.isEmpty }.joined(separator: ": ")
                if calendarNotice?.isEmpty == true { calendarNotice = nil }
                return
            }
            guard next.object("composer").text("mode") == "new" else { throw CocoaError(.coderReadCorrupt) }
            calendarComposerGeneration += 1
            calendarComposerEdits = []
            calendarComposerView = next
            syncCalendarComposerInputs()
            calendarComposerPresented = true
        } catch {
            if calendarComposerOpeningCurrent(query: openingQuery, revision: openingRevision, state: openingState) {
                calendarError = error.localizedDescription
            }
        }
    }

    private func calendarComposerOpeningCurrent(query: String, revision: String, state: CoreObject) -> Bool {
        let current = calendarView.object("state")
        return selectedSurface == .calendar && calendarCurrent && calendarQuery == query
            && calendarView.text("revision") == revision
            && current.text("selectedDate") == state.text("selectedDate")
            && current.text("visibleMonth") == state.text("visibleMonth")
            && current.text("viewMode") == state.text("viewMode")
    }

    func closeCalendarComposer() {
        guard !busy, !retryNeeded, calendarComposerSaveRequest == nil else { return }
        calendarComposerGeneration += 1
        calendarComposerPresented = false
        calendarComposerView = [:]
        calendarComposerEdits = []
        calendarComposerError = nil
        if calendarNeedsRead { scheduleCalendarRead() }
    }

    func setCalendarComposerQuery(_ text: String) {
        guard calendarComposerPresented, !busy, !retryNeeded, calendarComposerSaveRequest == nil,
              text != calendarComposerQueryInput else { return }
        calendarComposerQueryInput = text
        queueCalendarComposerEdit(["type": "query", "query": text])
    }

    func setCalendarComposerTitle(_ text: String) {
        guard calendarComposerPresented, !busy, !retryNeeded, calendarComposerSaveRequest == nil,
              text != calendarComposerTitleInput else { return }
        calendarComposerTitleInput = text
        queueCalendarComposerEdit(["type": "title", "title": text])
    }

    func setCalendarComposerMode(_ mode: String) {
        let sameMode = mode == calendarComposerView.object("composer").text("mode")
        let visibleError = calendarComposerError != nil || !calendarComposerView.text("error").isEmpty
        guard calendarComposerPresented, !busy, !retryNeeded, calendarComposerSaveRequest == nil,
              ["new", "existing"].contains(mode),
              !sameMode || visibleError || calendarComposerEditPending else { return }
        queueCalendarComposerEdit(["type": "mode", "mode": mode])
    }

    func setCalendarComposerTime(_ field: String, text: String) {
        guard calendarComposerPresented, !busy, !retryNeeded, calendarComposerSaveRequest == nil else { return }
        if field == "startTime" {
            guard text != calendarComposerStartInput else { return }
            calendarComposerStartInput = text
        } else if field == "endTime" {
            guard text != calendarComposerEndInput else { return }
            calendarComposerEndInput = text
        } else { return }
        queueCalendarComposerEdit(["type": field, "value": text])
    }

    func selectCalendarComposerTask(_ id: String) {
        guard calendarComposerPresented, !calendarComposerEditPending, !busy, !retryNeeded,
              calendarComposerView.objects("candidates").contains(where: { $0.text("id") == id }) else { return }
        queueCalendarComposerEdit(["type": "selectTask", "taskId": id])
    }

    func setCalendarComposerDuration(_ minutes: Int) {
        guard calendarComposerPresented, !calendarComposerEditPending, !busy, !retryNeeded,
              calendarComposerView.objects("durations").contains(where: { $0.number("minutes") == minutes }) else { return }
        queueCalendarComposerEdit(["type": "duration", "minutes": minutes])
    }

    func retryCalendarComposerEdit() {
        guard calendarComposerPresented, !calendarComposerEditing, !calendarComposerEdits.isEmpty,
              !busy, !retryNeeded else { return }
        calendarComposerError = nil
        Task { await pumpCalendarComposerEdits() }
    }

    private func queueCalendarComposerEdit(_ edit: CoreObject) {
        // Coalesce only adjacent unsent keystrokes. Other control edits retain order.
        if calendarComposerError != nil && calendarComposerEdits.first?.text("type") == edit.text("type") {
            calendarComposerEdits.removeFirst()
        }
        if calendarComposerEdits.last?.text("type") == edit.text("type") {
            calendarComposerEdits[calendarComposerEdits.count - 1] = edit
        } else { calendarComposerEdits.append(edit) }
        calendarComposerError = nil
        Task { await pumpCalendarComposerEdits() }
    }

    private func pumpCalendarComposerEdits() async {
        guard !calendarComposerEditing, calendarComposerPresented, !busy, !retryNeeded else { return }
        calendarComposerEditing = true
        defer {
            calendarComposerEditing = false
            if calendarComposerPresented && !calendarComposerEdits.isEmpty && calendarComposerError == nil {
                Task { await pumpCalendarComposerEdits() }
            }
        }
        let generation = calendarComposerGeneration
        while calendarComposerPresented && generation == calendarComposerGeneration && !calendarComposerEdits.isEmpty {
            let edit = calendarComposerEdits.removeFirst()
            let previousMode = calendarComposerView.object("composer").text("mode")
            do {
                let next = try await query("calendarComposerEdit", [try json([
                    "composer": calendarComposerView.object("composer"), "edit": edit
                ])])
                guard calendarComposerPresented, generation == calendarComposerGeneration else { return }
                let returnedMode = next.object("composer").text("mode")
                guard ["new", "existing"].contains(returnedMode),
                      returnedMode == (edit.text("type") == "mode" ? edit.text("mode") : previousMode) else {
                    throw CocoaError(.coderReadCorrupt)
                }
                calendarComposerView = next
                syncCalendarComposerInputs()
                calendarComposerError = nil
            } catch {
                guard calendarComposerPresented, generation == calendarComposerGeneration else { return }
                if calendarComposerEdits.first?.text("type") == edit.text("type") {
                    // A newer raw value superseded the refused in-flight value.
                    continue
                }
                calendarComposerEdits.insert(edit, at: 0)
                calendarComposerError = error.localizedDescription
                return
            }
        }
    }

    private func syncCalendarComposerInputs() {
        let composer = calendarComposerView.object("composer")
        if !calendarComposerEdits.contains(where: { $0.text("type") == "query" }) {
            calendarComposerQueryInput = composer.text("query")
        }
        if !calendarComposerEdits.contains(where: { $0.text("type") == "title" }) {
            calendarComposerTitleInput = composer.text("title")
        }
        if !calendarComposerEdits.contains(where: { $0.text("type") == "startTime" }) {
            calendarComposerStartInput = composer.text("startTimeValue")
        }
        if !calendarComposerEdits.contains(where: { $0.text("type") == "endTime" }) {
            calendarComposerEndInput = composer.text("endTimeValue")
        }
    }

    func saveCalendarComposer() async {
        guard calendarComposerCanSave else { return }
        let request: String
        do {
            request = try json(["requestId": UUID().uuidString.lowercased(),
                "composer": calendarComposerView.object("composer")])
        } catch { calendarComposerError = error.localizedDescription; return }
        calendarComposerSaveRequest = request
        busy = true
        calendarComposerError = nil
        error = nil
        defer { finishOperation() }
        do {
            let result = try await query("calendarComposerSave", [request])
            await acknowledgeCalendarComposerSave(result)
        } catch {
            if isDefiniteRejection(error) { calendarComposerSaveRequest = nil }
            retryNeeded = calendarComposerSaveRequest != nil
            calendarComposerError = error.localizedDescription
            if retryNeeded { self.error = error.localizedDescription }
        }
    }

    private func acknowledgeCalendarComposerSave(_ result: CoreObject) async {
        // The host has crossed its durable barrier. Never submit this request again.
        calendarComposerSaveRequest = nil
        retryNeeded = false
        error = nil
        let refused = result.object("composer")
        if !refused.isEmpty {
            guard calendarComposerPresented,
                  ["new", "existing"].contains(refused.object("composer").text("mode")) else {
                calendarError = CocoaError(.coderReadCorrupt).localizedDescription
                return
            }
            calendarComposerView = refused
            syncCalendarComposerInputs()
            let toast = result.object("toast")
            calendarComposerError = refused.text("error").isEmpty ? toast.text("message") : refused.text("error")
            return
        }
        let next = result.object("next")
        guard next.text("viewMode") == "day", !next.text("selectedDate").isEmpty,
              !next.text("visibleMonth").isEmpty, let minute = result["scrollToMinutes"] as? NSNumber,
              !result.text("taskId").isEmpty else {
            calendarComposerError = CocoaError(.coderReadCorrupt).localizedDescription
            return
        }
        calendarComposerGeneration += 1
        calendarComposerPresented = false
        calendarComposerView = [:]
        calendarComposerEdits = []
        calendarComposerError = nil
        calendarComposerNavigation = (next, minute.doubleValue)
        calendarQuery = ""
        calendarState = next
        calendarLoadedDepth = pageSize
        calendarScrollAnchor = ""
        calendarViewportAnchors.removeAll()
        calendarViewportGeneration += 1
        installCalendarComposerAnchor()
        selectedSurface = .calendar
        await readCalendar()
        await persistComposerDayMode()
    }

    private func installCalendarComposerAnchor() {
        guard let navigation = calendarComposerNavigation else { return }
        let state = navigation.state
        let key = String(calendarViewportGeneration) + ":day:" + state.text("selectedDate") + ":" +
            state.text("visibleMonth") + ":vertical"
        calendarViewportAnchors[key] = navigation.minute
    }

    private func persistComposerDayMode() async {
        guard let navigation = calendarComposerNavigation else { return }
        guard let before = calendarPreferenceValues["viewMode"] as? String else {
            calendarError = CocoaError(.coderReadCorrupt).localizedDescription
            return
        }
        if before == "day" { calendarComposerNavigation = nil; return }
        let request: String
        do {
            request = try json(["requestId": UUID().uuidString, "field": "viewMode", "before": before, "value": "day"])
        } catch { calendarError = error.localizedDescription; return }
        calendarPreferencePending = true
        calendarPreferenceTarget = navigation.state
        do {
            _ = try await query("calendarPreference", [request])
            acknowledgeCalendarPreference()
            installCalendarComposerAnchor()
            await readCalendar()
            calendarComposerNavigation = nil
        } catch {
            if isDefiniteRejection(error) {
                calendarPreferencePending = false
                calendarPreferenceTarget = nil
                calendarComposerNavigation = nil
                calendarError = error.localizedDescription
            } else {
                retryNeeded = true
                self.error = error.localizedDescription
            }
        }
    }

    private func readCalendar() async {
        calendarReadTask?.cancel()
        calendarNeedsRead = false
        calendarCurrent = false
        calendarError = nil
        let text = calendarQuery
        for attempt in 0..<2 {
            do {
                let preferences = try await query("menuRead", ["calendarPreferences", "{}"])
                let values = preferences.object("values")
                guard preferences.number("version") == 1, values["viewMode"] is String,
                      values["showCompleted"] is Bool, values["weekVisibleDays"] is NSNumber else {
                    throw CocoaError(.coderReadCorrupt)
                }
                var state = calendarState
                if let target = calendarPreferenceTarget, !calendarPreferencePending {
                    state = target
                    // Preserve the core navigation target, but honor the acknowledged stored mode
                    // if replay finished persistence after a newer same-field preference arrived.
                    state["viewMode"] = values["viewMode"]
                }
                var input: CoreObject = ["scheduleQuery": text, "offset": 0, "limit": pageSize]
                if !state.isEmpty { input["state"] = state }
                var next = try await query("menuRead", ["calendar", try json(input)])
                guard !next.text("revision").isEmpty, !next.object("state").isEmpty,
                      next.number("total") >= 0, next.objects("items").count == min(pageSize, next.number("total")) else {
                    throw CocoaError(.coderReadCorrupt)
                }
                var entries = next.objects("items")
                input["state"] = next.object("state")
                input["revision"] = next.text("revision")
                let target = min(calendarLoadedDepth, next.number("total"))
                while entries.count < target {
                    let limit = min(pageSize, target - entries.count)
                    input["offset"] = entries.count
                    input["limit"] = limit
                    let page = try await query("menuRead", ["calendar", try json(input)])
                    guard page.text("revision") == next.text("revision"), page.number("total") == next.number("total"),
                          page.objects("items").count == limit,
                          try json(page.object("state")) == json(next.object("state")) else { throw CocoaError(.coderReadCorrupt) }
                    entries += page.objects("items")
                }
                guard selectedSurface == .calendar, text == calendarQuery else { calendarNeedsRead = true; return }
                next["items"] = entries
                calendarState = next.object("state")
                calendarPreferenceValues = values
                calendarPreferenceTarget = nil
                if calendarView.isEmpty { NSLog("Native iOS Calendar view loaded releaseCheck=v1.3.3/native-ios-calendar-read") }
                calendarView = next
                calendarCurrent = true
                return
            } catch {
                guard selectedSurface == .calendar, text == calendarQuery else { calendarNeedsRead = true; return }
                if attempt == 1 { calendarError = error.localizedDescription }
            }
        }
    }

    func completeCalendarItem(_ item: CoreObject) async {
        guard calendarActionsEnabled, calendarItems.contains(where: { $0.text("id") == item.text("id")
            && $0.text("taskId") == item.text("taskId") && $0.flag("showDone") }),
              calendarEditableTask(item.text("taskId")) else { return }
        await complete(item.text("taskId"))
    }

    func openCalendarItem(_ item: CoreObject) async {
        guard calendarActionsEnabled, item.flag("pressable"), !item.text("taskId").isEmpty,
              calendarItems.contains(where: { $0.text("id") == item.text("id") && $0.text("taskId") == item.text("taskId") && $0.flag("pressable") }) else { return }
        calendarItemTaskID = item.text("taskId")
        calendarItemSheet = [:]
        calendarItemError = nil
        calendarItemPresented = true
        await retryCalendarItem()
    }

    func retryCalendarItem() async {
        guard calendarItemPresented, !busy, !retryNeeded, !taskPresented else { return }
        busy = true
        defer { finishOperation() }
        calendarItemError = nil
        do {
            let sheet = try await query("menuRead", ["calendarItem", try json(["taskId": calendarItemTaskID, "state": calendarState])])
            guard sheet.text("kind") == "projected" || (sheet.text("kind") == "task" && sheet.text("taskId") == calendarItemTaskID) else {
                throw CocoaError(.coderReadCorrupt)
            }
            calendarItemSheet = sheet
        } catch { calendarItemError = error.localizedDescription }
    }

    func closeCalendarItem() {
        guard !busy, !retryNeeded else { return }
        calendarItemPresented = false
        calendarItemSheet = [:]
        calendarItemTaskID = ""
        calendarItemError = nil
    }

    func performCalendarItemAction(_ action: String) async {
        guard calendarItemPresented, !busy, !retryNeeded, !taskPresented,
              calendarItemSheet.objects("buttons").contains(where: { $0.text("id") == action }) else { return }
        if action == "cancel" || action == "ok" { closeCalendarItem(); return }
        guard calendarItemSheet.text("kind") == "task", calendarEditableTask(calendarItemTaskID) else { return }
        let id = calendarItemTaskID
        if action == "edit" { closeCalendarItem(); await openTask(id) }
        else if action == "done" { closeCalendarItem(); await complete(id) }
    }

    func openReview() async {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented,
              !mindSweepPresented, !processInboxPresented else { return }
        morePresented = false
        selectedSurface = .review
        await refresh()
    }

    func openReviewPicker() {
        guard reviewActionsEnabled else { return }
        reviewPickerPresented = true
    }

    func closeReviewPicker() {
        guard !busy, !retryNeeded else { return }
        reviewPickerPresented = false
    }

    func editReviewOverview(scope: String? = nil, expansion: CoreObject? = nil) async {
        guard reviewActionsEnabled, !reviewGuidePresented else { return }
        if let scope {
            guard reviewOverview.object("scope").objects("options").contains(where: { $0.text("id") == scope }) else { return }
            reviewOverviewParams["scope"] = scope
        }
        if let expansion { reviewOverviewParams["expansionEdit"] = expansion }
        busy = true
        defer { finishOperation() }
        await readReview()
    }

    func openReviewGuide(_ kind: String) async {
        guard ready, selectedSurface == .review, !busy, !retryNeeded, !taskPresented, !mindSweepPresented,
              reviewOverview.object("startReview").objects("options").contains(where: { $0.text("id") == kind }) else { return }
        if reviewKind != kind {
            reviewGuide = [:]
            reviewGuideDepth = pageSize
            reviewNestedDepth = [:]
            reviewExpandedProject = nil
        }
        reviewKind = kind
        reviewCheckpointInput = preferenceDefaults.string(forKey: reviewPreferencePrefix + kind)
        reviewFinishPending = false
        reviewPickerPresented = false
        reviewGuidePresented = true
        busy = true
        defer { finishOperation() }
        await readReview()
    }

    func closeReviewGuide() async {
        guard !busy, !retryNeeded, !taskPresented, !mindSweepPresented, !processInboxPresented else { return }
        reviewGuidePresented = false
        reviewFinishPending = false
        await refresh()
    }

    func moveReview(_ direction: String) async {
        guard reviewActionsEnabled, reviewGuidePresented, ["back", "next"].contains(direction),
              let checkpoint = reviewGuide.object(direction)["checkpoint"] as? String else { return }
        reviewCheckpointInput = checkpoint
        reviewGuideDepth = pageSize
        reviewNestedDepth = [:]
        reviewExpandedProject = nil
        busy = true
        defer { finishOperation() }
        await readReview()
    }

    func expandWeeklyReviewProject(_ id: String) async {
        guard reviewActionsEnabled, reviewGuidePresented, reviewKind == "weekly",
              let item = reviewGuide.objects("items").first(where: { $0.text("type") == "project" && $0.text("id") == id }) else { return }
        reviewExpandedProject = item.flag("expanded") ? nil : id
        busy = true
        defer { finishOperation() }
        await readReview()
    }

    func toggleReviewContext(_ context: String) {
        guard reviewActionsEnabled, reviewGuidePresented, reviewKind == "weekly",
              reviewGuide.objects("items").contains(where: { $0.text("type") == "context"
                  && $0.text("context") == context && !$0.text("moreLabel").isEmpty }) else { return }
        if reviewExpandedContexts.contains(context) { reviewExpandedContexts.remove(context) }
        else { reviewExpandedContexts.insert(context) }
    }

    func toggleReviewScheduled() {
        let content = reviewGuide.object("content")
        let step = content.text("step")
        guard reviewActionsEnabled, reviewGuidePresented, reviewKind == "weekly",
              ["waiting", "someday"].contains(step), content.object("scheduled").number("count") > 0 else { return }
        if reviewExpandedScheduled.contains(step) { reviewExpandedScheduled.remove(step) }
        else { reviewExpandedScheduled.insert(step) }
    }

    func finishReview() async {
        guard selectedSurface == .review, reviewGuidePresented, !busy, !retryNeeded, !mindSweepPresented,
              !reviewGuide.object("finish").isEmpty, reviewCurrent || reviewFinishPending else { return }
        busy = true
        defer { finishOperation() }
        do {
            let finish = reviewGuide.object("finish")
            if reviewKind == "weekly" {
                guard !finish.text("lastReviewKey").isEmpty, !finish.text("lastReviewAt").isEmpty else { throw CocoaError(.coderReadCorrupt) }
                try writeReviewPreference(finish.text("lastReviewAt"), key: reviewPreferencePrefix + finish.text("lastReviewKey"))
            }
            try writeReviewPreference(nil, key: reviewPreferencePrefix + reviewKind)
            NSLog("Native iOS Review finished releaseCheck=v1.3.3/native-ios-review-navigation")
            reviewCheckpointInput = nil
            reviewGuide = [:]
            reviewGuideDepth = pageSize
            if reviewKind == "weekly" {
                reviewExpandedContexts = []
                reviewExpandedScheduled = []
            }
            reviewNested = [:]
            reviewNestedDepth = [:]
            reviewExpandedProject = nil
            reviewGuidePresented = false
            reviewFinishPending = false
            await readReview()
        } catch {
            reviewFinishPending = true
            reviewCurrent = false
            reviewError = error.localizedDescription
        }
    }

    func retryReview() async {
        guard selectedSurface == .review, !busy, !retryNeeded, !taskPresented, !mindSweepPresented else { return }
        if reviewFinishPending { await finishReview(); return }
        busy = true
        defer { finishOperation() }
        await readReview()
    }

    func loadMoreReview() async {
        guard reviewActionsEnabled else { return }
        let view = reviewGuidePresented ? reviewGuide : reviewOverview
        guard view.objects("items").count < view.number("total") else { return }
        if reviewGuidePresented { reviewGuideDepth = view.objects("items").count + pageSize }
        else { reviewOverviewDepth = view.objects("items").count + pageSize }
        await retryReview()
    }

    func reviewNestedWindow(_ list: String, key: String = "", fallback: CoreObject) -> CoreObject {
        reviewNested[list + ":" + key] ?? fallback
    }

    func loadMoreReviewNested(_ list: String, key: String = "") async {
        guard reviewActionsEnabled, reviewGuidePresented, reviewKind == "weekly",
              let window = reviewNested[list + ":" + key], window.objects("items").count < window.number("total") else { return }
        reviewNestedDepth[list + ":" + key] = window.objects("items").count + pageSize
        await retryReview()
    }

    // Only opaque checkpoints and returned Finish metadata use this local namespace.
    // MainActor + busy serializes navigation; failed persistence keeps the old page.
    private func writeReviewPreference(_ value: String?, key: String) throws {
        guard key.hasPrefix(reviewPreferencePrefix) else { throw CocoaError(.coderInvalidValue) }
        let defaults = preferenceDefaults
        let previous = defaults.string(forKey: key)
        guard previous != value else { return }
        if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
        guard defaults.synchronize(), defaults.string(forKey: key) == value else {
            if let previous { defaults.set(previous, forKey: key) } else { defaults.removeObject(forKey: key) }
            _ = defaults.synchronize()
            throw CocoaError(.fileWriteUnknown)
        }
    }

    private func readReview() async {
        // A foreground refresh must not clear a failed Finish or its reachable retry.
        guard !reviewFinishPending else { return }
        reviewCurrent = false
        reviewError = nil
        for attempt in 0..<2 {
            do {
                if reviewGuidePresented { try await readReviewGuide() }
                else { try await readReviewOverview() }
                reviewCurrent = true
                return
            } catch {
                if attempt == 1 { reviewError = error.localizedDescription }
            }
        }
    }

    private func readReviewOverview() async throws {
        var input = reviewOverviewParams
        input["offset"] = 0
        input["limit"] = pageSize
        var view = try await query("menuRead", ["reviewOverview", try json(input)])
        try validateReviewFirstWindow(view)
        var params: CoreObject = ["scope": view.object("scope").text("selected"),
            "expandedAreaIds": view["expandedAreaIds"] ?? [], "expandedProjectIds": view["expandedProjectIds"] ?? []]
        params["revision"] = view.text("revision")
        var items = view.objects("items")
        while items.count < min(reviewOverviewDepth, view.number("total")) {
            let limit = min(pageSize, min(reviewOverviewDepth, view.number("total")) - items.count)
            params["offset"] = items.count
            params["limit"] = limit
            let window = try await query("menuRead", ["reviewOverview", try json(params)])
            try validateReviewWindow(window, against: view, count: limit)
            items += window.objects("items")
        }
        view["items"] = items
        for key in ["offset", "limit", "revision"] { params.removeValue(forKey: key) }
        reviewOverviewParams = params
        reviewOverview = view
    }

    private func readReviewGuide() async throws {
        var input: CoreObject = ["checkpoint": reviewCheckpointInput as Any? ?? NSNull(), "offset": 0, "limit": pageSize]
        if reviewKind == "weekly" { input["expandedProjectId"] = reviewExpandedProject as Any? ?? NSNull() }
        let name = reviewKind == "daily" ? "dailyReview" : "weeklyReview"
        var view = try await query("menuRead", [name, try json(input)])
        try validateReviewFirstWindow(view)
        let checkpoint = view.text("checkpoint")
        guard !checkpoint.isEmpty, !view.text("storageKey").isEmpty else { throw CocoaError(.coderReadCorrupt) }
        input["checkpoint"] = checkpoint
        input["revision"] = view.text("revision")
        var items = view.objects("items")
        while items.count < min(reviewGuideDepth, view.number("total")) {
            let limit = min(pageSize, min(reviewGuideDepth, view.number("total")) - items.count)
            input["offset"] = items.count
            input["limit"] = limit
            let window = try await query("menuRead", [name, try json(input)])
            try validateReviewWindow(window, against: view, count: limit)
            guard window.text("checkpoint") == checkpoint else { throw CocoaError(.coderReadCorrupt) }
            items += window.objects("items")
        }
        view["items"] = items
        var nested: [String: CoreObject] = [:]
        if reviewKind == "weekly" {
            var lists: [(String, String, CoreObject)] = []
            let projects = view.object("content").object("projects")
            if !projects.isEmpty { lists.append(("staleProjects", "", projects)) }
            for item in items where item.text("type") == "context" { lists.append(("contextTasks", item.text("context"), item.object("tasks"))) }
            for (list, key, initial) in lists {
                var window = initial
                var entries = initial.objects("items")
                guard initial.number("total") >= 0, entries.count == min(100, initial.number("total")) else {
                    throw CocoaError(.coderReadCorrupt)
                }
                let identity = list + ":" + key
                let target = max(entries.count, reviewNestedDepth[identity] ?? 0)
                var params = input
                params["list"] = list
                if !key.isEmpty { params["key"] = key }
                while entries.count < min(target, initial.number("total")) {
                    let limit = min(pageSize, min(target, initial.number("total")) - entries.count)
                    params["offset"] = entries.count
                    params["limit"] = limit
                    let next = try await query("menuRead", ["weeklyReviewList", try json(params)])
                    guard next.text("revision") == view.text("revision"), next.text("list") == list,
                          next.text("key") == key, next.number("total") == initial.number("total"),
                          next.objects("items").count == limit else { throw CocoaError(.coderReadCorrupt) }
                    entries += next.objects("items")
                }
                window["items"] = entries
                nested[identity] = window
            }
        }
        try writeReviewPreference(checkpoint, key: reviewPreferencePrefix + reviewKind)
        if reviewGuide.text("checkpoint") != checkpoint {
            NSLog("Native iOS Review checkpoint acknowledged releaseCheck=v1.3.3/native-ios-review-navigation")
        }
        reviewCheckpointInput = checkpoint
        reviewGuide = view
        reviewNested = nested
    }

    private func validateReviewFirstWindow(_ view: CoreObject) throws {
        guard !view.text("revision").isEmpty, view.number("total") >= 0,
              view.objects("items").count == min(pageSize, view.number("total")) else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    private func validateReviewWindow(_ window: CoreObject, against view: CoreObject, count: Int) throws {
        guard !view.text("revision").isEmpty, window.text("revision") == view.text("revision"),
              window.number("total") == view.number("total"), window.objects("items").count == count else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    func openContexts() async {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented else { return }
        if selectedSurface != .contexts { contextsCaller = selectedSurface }
        morePresented = false
        selectedSurface = .contexts
        await refresh()
    }

    func closeContexts() async {
        guard selectedSurface == .contexts, !busy, !retryNeeded, !taskPresented else { return }
        contextsReadTask?.cancel()
        contextsGeneration += 1
        selectedSurface = contextsCaller
        await refresh()
    }

    func setContextsSearch(_ text: String) {
        guard selectedSurface == .contexts, !retryNeeded, !taskPresented, text != contextsSearchText else { return }
        contextsSearchText = text
        // RN searches the token strip only. Retain the loaded task depth.
        requestContextsRead()
    }

    func selectContextsChip(_ id: String) {
        guard contextsControlsEnabled, contexts.objects("chips").contains(where: { $0.text("id") == id }) else { return }
        contextsIntents.append(["kind": "chip", "value": id])
        contextsLoadedDepth = pageSize
        requestContextsRead(delay: 0)
    }

    func selectContextsMatchMode(_ mode: String) {
        guard contextsControlsEnabled, contexts.object("matchMode").objects("options").contains(where: { $0.text("mode") == mode }) else { return }
        contextsIntents.append(["kind": "mode", "value": mode])
        contextsLoadedDepth = pageSize
        requestContextsRead(delay: 0)
    }

    func focusContextsToken(_ token: String) {
        guard contextsActionsEnabled, contexts.objects("rows").contains(where: { row in
            row.object("meta").objects("parts").contains(where: {
                ["context", "tag"].contains($0.text("kind")) && $0.text("text") == token
            })
        }) else { return }
        // Same explicit navigation as RN's onContextPress/onTagPress. The metadata
        // text is the token; overflow is a separate field, never parsed here.
        contextsIntents.append(["kind": "focus", "value": token])
        contextsLoadedDepth = pageSize
        requestContextsRead(delay: 0)
    }

    private func requestContextsRead(delay: UInt64 = 150_000_000) {
        contextsGeneration += 1
        contextsReadTask?.cancel()
        contextsCurrent = false
        contextsError = nil
        contextsLoading = true
        contextsNeedsRead = true
        scheduleContextsRead(delay: delay)
    }

    private func scheduleContextsRead(delay: UInt64 = 150_000_000) {
        guard selectedSurface == .contexts, !busy, !retryNeeded, !taskPresented, !areaPickerPresented else { return }
        contextsReadTask?.cancel()
        contextsReadTask = Task {
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard !Task.isCancelled, selectedSurface == .contexts, !busy, !retryNeeded, !taskPresented, !areaPickerPresented else { return }
            await readContexts()
        }
    }

    func retryContexts() {
        guard selectedSurface == .contexts, !busy, !retryNeeded, !taskPresented else { return }
        requestContextsRead(delay: 0)
    }

    func loadMoreContexts() {
        guard contextsActionsEnabled, contexts.objects("rows").count < contexts.number("total") else { return }
        contextsLoadedDepth = contexts.objects("rows").count + pageSize
        requestContextsRead(delay: 0)
    }

    private func contextsPage(selection: CoreObject, search: String, offset: Int = 0,
                              limit: Int = 50, revision: String? = nil) async throws -> CoreObject {
        var input = selection
        input["searchQuery"] = search
        input["offset"] = offset
        input["limit"] = limit
        if let revision { input["revision"] = revision }
        return try await query("menuRead", ["contexts", try json(input)])
    }

    private func contextsReadAllowed(_ generation: Int, ownsOperation: Bool) -> Bool {
        !Task.isCancelled && generation == contextsGeneration && selectedSurface == .contexts
            && !retryNeeded && !taskPresented && (ownsOperation || (!areaPickerPresented && !busy))
    }

    private func readContexts(ownsOperation: Bool = false) async {
        let generation = contextsGeneration
        let search = contextsSearchText
        let intents = contextsIntents
        let depth = contextsLoadedDepth
        contextsNeedsRead = false
        contextsCurrent = false
        contextsLoading = true
        contextsError = nil
        defer { if generation == contextsGeneration { contextsLoading = false } }
        for attempt in 0..<2 {
            do {
                var selection = contextsSelection
                // Resolve every accepted tap against the preceding core selection.
                // Reusing a rendered chip.next for two rapid taps would lose the first.
                // Empty search keeps a queued chip reachable if typing hid it meanwhile.
                for intent in intents {
                    if intent.text("kind") == "focus" {
                        selection = ["tokens": [intent.text("value")], "matchMode": "all"]
                        continue
                    }
                    let controls = try await contextsPage(selection: selection, search: "")
                    guard contextsReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                    selection = controls.object("selection")
                    if intent.text("kind") == "chip" {
                        if let chip = controls.objects("chips").first(where: { $0.text("id") == intent.text("value") }) {
                            selection = chip.object("next")
                        }
                    } else if let option = controls.object("matchMode").objects("options").first(where: { $0.text("mode") == intent.text("value") }) {
                        selection["matchMode"] = option.text("mode")
                    }
                }
                var next = try await contextsPage(selection: selection, search: search)
                guard contextsReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                guard next.number("version") == 1, !next.text("revision").isEmpty,
                      !next.object("selection").isEmpty, next.number("total") >= 0,
                      next.objects("rows").count == min(pageSize, next.number("total")) else {
                    throw CocoaError(.coderReadCorrupt)
                }
                // Contexts revision covers data/time, not selection or chip search.
                // Every staged page must use the same effective inputs as page zero.
                selection = next.object("selection")
                var rows = next.objects("rows")
                let target = min(depth, next.number("total"))
                while rows.count < target {
                    let limit = min(pageSize, target - rows.count)
                    let page = try await contextsPage(selection: selection, search: search, offset: rows.count,
                                                      limit: limit, revision: next.text("revision"))
                    guard contextsReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                    guard page.text("revision") == next.text("revision"), page.number("total") == next.number("total"),
                          page.objects("rows").count == limit, try json(page.object("selection")) == json(selection) else {
                        throw CocoaError(.coderReadCorrupt)
                    }
                    rows += page.objects("rows")
                }
                guard Set(rows.map { $0.text("id") }).count == rows.count else { throw CocoaError(.coderReadCorrupt) }
                next["rows"] = rows
                contextsSelection = selection
                contextsIntents.removeAll()
                contexts = next
                contextsCurrent = true
                return
            } catch {
                guard contextsReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                // Restart at zero once on an expired revision; never publish mixed pages.
                if attempt == 1 { contextsError = error.localizedDescription }
            }
        }
    }

    func openWaiting() async {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented else { return }
        if selectedSurface != .waiting { waitingCaller = selectedSurface }
        morePresented = false
        selectedSurface = .waiting
        await refresh()
    }

    func closeWaiting() async {
        guard selectedSurface == .waiting, !busy, !retryNeeded, !taskPresented else { return }
        selectedSurface = waitingCaller
        await refresh()
    }

    func openSomeday() async {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented else { return }
        if selectedSurface != .someday { somedayCaller = selectedSurface }
        morePresented = false
        selectedSurface = .someday
        await refresh()
    }

    func closeSomeday() async {
        guard selectedSurface == .someday, !busy, !retryNeeded, !taskPresented else { return }
        closeSomedayPicker()
        selectedSurface = somedayCaller
        await refresh()
    }

    func closeSomedayPanel() {
        somedayPanel = ""
        closeSomedayPicker()
    }

    func setSomedayOption(_ key: String, value: Any) async {
        guard somedayActionsEnabled, ["sortBy", "groupBy", "showDetails"].contains(key) else { return }
        somedayParams[key] = value
        if key != "showDetails" { somedayLoadedDepth = pageSize }
        busy = true
        defer { finishOperation() }
        await readSomeday()
    }

    func editSomedayFilter(_ edit: CoreObject) async {
        guard somedayActionsEnabled, !edit.isEmpty else { return }
        somedayPendingEdit = edit
        somedayLoadedDepth = pageSize
        busy = true
        defer { finishOperation() }
        await readSomeday()
    }

    func setSomedayText(_ text: String, location: Bool = false) {
        guard selectedSurface == .someday, !retryNeeded, !taskPresented else { return }
        guard text != (location ? somedayLocationText : somedaySearchText) else { return }
        if location { somedayLocationText = text } else { somedaySearchText = text }
        let type = location ? "setLocation" : "setSearch"
        somedayTextEdits[type] = ["type": type, "value": text]
        if somedayPendingEdit?.text("type") == type { somedayPendingEdit = somedayTextEdits[type] }
        somedayTextNeedsRead = true
        somedayCurrent = false
        somedayError = nil
        somedayLoadedDepth = pageSize
        scheduleSomedayRead()
    }

    func retrySomeday() async {
        guard selectedSurface == .someday, !busy, !retryNeeded, !taskPresented else { return }
        if !somedayTextEdits.isEmpty {
            somedayTextNeedsRead = true
            scheduleSomedayRead(delay: 0)
        } else { await refresh() }
    }

    private func scheduleSomedayRead(delay: UInt64 = 200_000_000) {
        guard selectedSurface == .someday, !busy, !retryNeeded, !taskPresented else { return }
        somedayReadTask?.cancel()
        somedayReadTask = Task {
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard !Task.isCancelled, selectedSurface == .someday, !busy, !retryNeeded, !taskPresented else { return }
            busy = true
            defer { finishOperation() }
            somedayTextNeedsRead = false
            // Text remains editable during reads. Drain the latest value of each
            // text field in order, always starting from core's effective state.
            if somedayPendingEdit != nil || somedayError != nil {
                guard await readSomeday() else {
                    somedayTextNeedsRead = false
                    somedayPickerNeedsRead = false
                    return
                }
            }
            while let type = somedayTextEdits.keys.sorted().first, let edit = somedayTextEdits[type] {
                somedayPendingEdit = edit
                guard await readSomeday() else { somedayTextNeedsRead = false; return }
                if somedayTextEdits[type]?.text("value") == edit.text("value") { somedayTextEdits.removeValue(forKey: type) }
            }
            somedayTextNeedsRead = false
            if !someday.isEmpty {
                syncSomedayText()
                somedayCurrent = true
            }
            if somedayPickerNeedsRead { await readSomedayPicker() }
        }
    }

    private func syncSomedayText() {
        let state = someday.object("filters").object("state")
        if somedayTextEdits["setSearch"] == nil { somedaySearchText = state.text("searchQuery") }
        if somedayTextEdits["setLocation"] == nil { somedayLocationText = state.text("location") }
    }

    private func effectiveSomedayParams(_ snapshot: CoreObject) -> CoreObject {
        ["sortBy": snapshot.text("sortBy"), "groupBy": snapshot.text("groupBy"),
         "showDetails": snapshot.flag("showDetails"), "filters": snapshot.object("filters").object("state")]
    }

    private func somedayPage(params: CoreObject, offset: Int, limit: Int, revision: String? = nil,
                             edit: CoreObject? = nil) async throws -> CoreObject {
        var input = params
        input["offset"] = offset
        input["limit"] = limit
        if let revision { input["revision"] = revision }
        if let edit { input["filterEdit"] = edit }
        return try await query("menuRead", ["someday", try json(input)])
    }

    @discardableResult private func readSomeday() async -> Bool {
        somedayCurrent = false
        somedayPickerCurrent = false
        somedayError = nil
        for attempt in 0..<2 {
            do {
                var next = try await somedayPage(params: somedayParams, offset: 0, limit: pageSize, edit: somedayPendingEdit)
                guard !next.text("revision").isEmpty, next.number("total") >= 0,
                      next.objects("items").count == min(pageSize, next.number("total")) else { throw CocoaError(.coderReadCorrupt) }
                let params = effectiveSomedayParams(next)
                var items = next.objects("items")
                let target = min(somedayLoadedDepth, next.number("total"))
                while items.count < target {
                    let limit = min(pageSize, target - items.count)
                    let page = try await somedayPage(params: params, offset: items.count, limit: limit, revision: next.text("revision"))
                    try validateSomedayPage(page, against: next, count: limit)
                    items += page.objects("items")
                }
                next["items"] = items
                for name in ["tokens", "projects", "sections", "deferredProjects"] {
                    let collection = somedayCollection(name, in: next)
                    guard collection.number("total") >= 0,
                          collection.objects("items").count == min(100, collection.number("total")) else {
                        throw CocoaError(.coderReadCorrupt)
                    }
                }
                var deferred = next.object("deferred")
                var collection = deferred.object("rows")
                var entries = collection.objects("items")
                let deferredTarget = min(somedayDeferredDepth, collection.number("total"))
                while entries.count < deferredTarget {
                    let limit = min(pageSize, deferredTarget - entries.count)
                    let page = try await somedayCollectionPage("deferredProjects", snapshot: next, offset: entries.count, limit: limit)
                    guard page.number("total") == collection.number("total"), page.objects("items").count == limit else {
                        throw CocoaError(.coderReadCorrupt)
                    }
                    entries += page.objects("items")
                }
                if !deferred.isEmpty {
                    collection["items"] = entries
                    deferred["rows"] = collection
                    next["deferred"] = deferred
                }
                somedayParams = params
                somedayPendingEdit = nil
                someday = next
                syncSomedayText()
                somedayCurrent = somedayTextEdits.isEmpty
                if !somedayPickerName.isEmpty { somedayPickerNeedsRead = true }
                return true
            } catch {
                if attempt == 1 { somedayError = error.localizedDescription }
            }
        }
        return false
    }

    private func validateSomedayPage(_ page: CoreObject, against snapshot: CoreObject, count: Int) throws {
        guard page.text("revision") == snapshot.text("revision"), page.number("total") == snapshot.number("total"),
              page.objects("items").count == count,
              try json(effectiveSomedayParams(page)) == json(effectiveSomedayParams(snapshot)) else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    func loadMoreSomeday(deferred: Bool = false) async {
        guard somedayActionsEnabled else { return }
        let collection = somedayCollection("deferredProjects", in: someday)
        let count = deferred ? collection.objects("items").count : someday.objects("items").count
        let total = deferred ? collection.number("total") : someday.number("total")
        guard count < total else { return }
        if deferred { somedayDeferredDepth = count + min(pageSize, total - count) }
        else { somedayLoadedDepth = count + min(pageSize, total - count) }
        busy = true
        defer { finishOperation() }
        // Stage all windows offscreen before publishing so headings and tasks,
        // including the deferred collection, always share one revision.
        await readSomeday()
    }

    private func somedayCollection(_ name: String, in snapshot: CoreObject) -> CoreObject {
        if name == "deferredProjects" { return snapshot.object("deferred").object("rows") }
        if name == "sections" { return snapshot.object("sections") }
        return snapshot.object("filters").object(name)
    }

    private func somedayCollectionPage(_ name: String, snapshot: CoreObject, query text: String? = nil,
                                       offset: Int, limit: Int) async throws -> CoreObject {
        var input: CoreObject = ["view": "someday", "collection": name, "params": effectiveSomedayParams(snapshot),
                                 "offset": offset, "limit": limit, "revision": snapshot.text("revision")]
        if let text { input["query"] = text }
        let page = try await query("menuRead", ["collection", try json(input)])
        guard page.text("view") == "someday", page.text("collection") == name,
              page.text("revision") == snapshot.text("revision"), page.number("total") >= offset,
              page.objects("items").count == min(limit, page.number("total") - offset) else {
            throw CocoaError(.coderReadCorrupt)
        }
        return page
    }

    func openSomedayPicker(_ name: String) {
        guard somedayActionsEnabled, ["tokens", "projects"].contains(name) else { return }
        somedayPickerName = name
        somedayPickerQuery = ""
        somedayPickerDepth = 100
        somedayPicker = somedayCollection(name, in: someday)
        somedayPickerCurrent = true
        somedayPickerError = nil
        somedayPickerNeedsRead = false
    }

    func closeSomedayPicker() {
        somedayPickerName = ""
        somedayPickerNeedsRead = false
        somedayPickerCurrent = false
        somedayPickerError = nil
    }

    func setSomedayPickerQuery(_ text: String) {
        guard !somedayPickerName.isEmpty, text != somedayPickerQuery, !retryNeeded else { return }
        somedayPickerQuery = text
        somedayPickerDepth = 100
        somedayPickerCurrent = false
        somedayPickerError = nil
        somedayPickerNeedsRead = true
        scheduleSomedayRead()
    }

    func loadMoreSomedayPicker() {
        guard somedayPickerActionsEnabled, somedayPicker.objects("items").count < somedayPicker.number("total") else { return }
        somedayPickerDepth = somedayPicker.objects("items").count + pageSize
        retrySomedayPicker()
    }

    func retrySomedayPicker() {
        guard !somedayPickerName.isEmpty, !busy, !retryNeeded else { return }
        somedayPickerCurrent = false
        somedayPickerNeedsRead = true
        scheduleSomedayRead(delay: 0)
    }

    private func readSomedayPicker() async {
        let name = somedayPickerName
        let text = somedayPickerQuery
        guard !name.isEmpty else { return }
        somedayPickerNeedsRead = false
        somedayPickerCurrent = false
        somedayPickerError = nil
        for attempt in 0..<2 {
            do {
                let snapshot = someday
                var next = try await somedayCollectionPage(name, snapshot: snapshot, query: text, offset: 0, limit: 100)
                var items = next.objects("items")
                let target = min(somedayPickerDepth, next.number("total"))
                while items.count < target {
                    let limit = min(pageSize, target - items.count)
                    let page = try await somedayCollectionPage(name, snapshot: snapshot, query: text, offset: items.count, limit: limit)
                    guard page.number("total") == next.number("total") else { throw CocoaError(.coderReadCorrupt) }
                    items += page.objects("items")
                }
                guard name == somedayPickerName, text == somedayPickerQuery else { return }
                next["items"] = items
                somedayPicker = next
                somedayPickerCurrent = true
                return
            } catch {
                guard name == somedayPickerName, text == somedayPickerQuery else { return }
                if attempt == 0, await readSomeday() {
                    guard name == somedayPickerName, text == somedayPickerQuery else { return }
                    somedayPickerNeedsRead = false
                    continue
                }
                somedayPickerNeedsRead = false
                somedayPickerError = error.localizedDescription
                return
            }
        }
    }

    func openReference() async {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented else { return }
        if selectedSurface != .reference { referenceCaller = selectedSurface }
        morePresented = false
        selectedSurface = .reference
        await refresh()
    }

    func closeReference() async {
        guard selectedSurface == .reference, !busy, !retryNeeded, !taskPresented else { return }
        closeReferencePicker()
        selectedSurface = referenceCaller
        await refresh()
    }

    func closeReferencePanel() {
        guard !busy, !retryNeeded, referenceSortRequest == nil else { return }
        referenceSortOptions = [:]
        referenceSortError = nil
        referencePanel = ""
        closeReferencePicker()
    }

    func openReferenceSort() async {
        guard referenceActionsEnabled, referenceSortRequest == nil else { return }
        referencePanel = "sort"
        await readReferenceSortOptions()
    }

    private func readReferenceSortOptions() async {
        guard !busy, !retryNeeded, referencePanel == "sort" else { return }
        busy = true
        referenceSortOptions = [:]
        referenceSortError = nil
        defer { finishOperation() }
        do {
            if !referenceCurrent, !(await readReference()) { throw CocoaError(.fileReadUnknown) }
            let options = try await query("taskListSortOptions", ["{}"])
            let expected = options.object("expected")
            let choices = options.objects("choices")
            guard Set(options.keys) == Set(["revision", "expected", "choices"]), !options.text("revision").isEmpty,
                  Set(expected.keys) == Set(["sortBy"]), expected["sortBy"] is String || expected["sortBy"] is NSNull,
                  !choices.isEmpty, Set(choices.map { $0.text("value") }).count == choices.count,
                  choices.allSatisfy({ Set($0.keys) == Set(["value", "label", "selected"])
                      && !$0.text("value").isEmpty && !$0.text("label").isEmpty && $0["selected"] is Bool }) else {
                throw CocoaError(.coderReadCorrupt)
            }
            referenceSortOptions = options
        } catch { referenceSortError = label("settings.feedback.actionFailed") }
    }

    func setReferenceSort(_ sortBy: String) async {
        guard referenceActionsEnabled, referencePanel == "sort", referenceSortRequest == nil,
              referenceSortOptions.objects("choices").contains(where: { $0.text("value") == sortBy }) else { return }
        busy = true
        referenceSortError = nil
        defer { finishOperation() }
        do {
            let request = try json(["requestId": UUID().uuidString.lowercased(), "sortBy": sortBy,
                                    "expected": referenceSortOptions.object("expected")])
            referenceSortRequest = request
            referenceSortExpectedResult = ["sortBy": sortBy]
            try acknowledgeReferenceSort(await query("taskListSortWrite", [request]))
            await readReference()
        } catch { await handleReferenceSortError(error) }
    }

    private func acknowledgeReferenceSort(_ result: CoreObject) throws {
        guard referenceSortRequest != nil, let expected = referenceSortExpectedResult,
              try json(result).utf8.elementsEqual(json(expected).utf8) else { throw CocoaError(.coderReadCorrupt) }
        referenceSortRequest = nil
        referenceSortExpectedResult = nil
        referenceSortOptions = [:]
        referenceSortError = nil
        referencePanel = ""
        referenceLoadedDepth = pageSize
        retryNeeded = false
        error = nil
    }

    private func handleReferenceSortError(_ failure: Error) async {
        if referenceSortRequest != nil && isDefiniteRejection(failure) {
            referenceSortRequest = nil
            referenceSortExpectedResult = nil
            referenceSortOptions = [:]
            retryNeeded = false
            await readReference()
        } else { retryNeeded = referenceSortRequest != nil }
        referenceSortError = label(retryNeeded ? "settings.feedback.saveFailed" : "settings.feedback.actionFailed")
    }

    func retryReferenceSort() async {
        if retryNeeded { await retry() }
        else { await readReferenceSortOptions() }
    }

    private func validReferenceGroup(_ value: String) -> Bool {
        ["none", "context", "area", "project", "tag"].contains(value)
    }

    private func referenceFoldMap(_ value: Any?, preserveEmpty: Bool) -> [String: [String]] {
        guard let axes = value as? [String: Any] else { return [:] }
        var folds: [String: [String]] = [:]
        for (axis, value) in axes {
            guard let values = value as? [Any] else { continue }
            let ids = values.compactMap { $0 as? String }
            if preserveEmpty || !ids.isEmpty { folds[axis] = ids }
        }
        return folds
    }

    private func validHistoryGroup(_ value: String) -> Bool {
        ["none", "completedDate", "context", "area", "project", "tag"].contains(value)
    }

    private func validHistorySort(_ value: String) -> Bool {
        ["default", "due", "start", "review", "timeEstimate", "title", "created", "created-desc", "completed"].contains(value)
    }

    func setReferenceOption(_ key: String, value: Any) async {
        guard referenceActionsEnabled, ["groupBy", "includeArchivedProjects", "collapsedGroupIds"].contains(key) else { return }
        if key == "groupBy" {
            guard let groupBy = value as? String, validReferenceGroup(groupBy) else { return }
            referenceParams["groupBy"] = groupBy
            referenceParams["collapsedGroupIds"] = referenceCollapsedGroups[groupBy] ?? []
            referenceViewPreferencePending = true
        } else if key == "collapsedGroupIds" {
            guard let ids = value as? [String] else { return }
            referenceCollapsedGroups[referenceParams.text("groupBy")] = ids
            referenceParams[key] = ids
            referenceViewPreferencePending = true
        } else { referenceParams[key] = value }
        if key != "collapsedGroupIds" { referenceLoadedDepth = pageSize }
        busy = true
        defer { finishOperation() }
        await readReference()
    }

    func toggleReferenceSection(_ id: String) async {
        guard referenceActionsEnabled, let section = reference.objects("items").first(where: {
            $0.text("type") == "section" && $0.text("id").utf8.elementsEqual(id.utf8) && $0.flag("collapsible")
        }) else { return }
        var ids = reference["collapsedGroupIds"] as? [String] ?? []
        if section.flag("collapsed") { ids.removeAll { $0.utf8.elementsEqual(id.utf8) } }
        else if !ids.contains(where: { $0.utf8.elementsEqual(id.utf8) }) { ids.append(id) }
        await setReferenceOption("collapsedGroupIds", value: ids)
    }

    func applyReferenceChipAction(_ action: CoreObject) async {
        guard referenceActionsEnabled else { return }
        if !action.object("filterEdit").isEmpty { await editReferenceFilter(action.object("filterEdit")) }
        else if action["includeArchivedProjects"] is Bool {
            await setReferenceOption("includeArchivedProjects", value: action.flag("includeArchivedProjects"))
        }
    }

    func editReferenceFilter(_ edit: CoreObject) async {
        guard referenceActionsEnabled, !edit.isEmpty else { return }
        referencePendingEdit = edit
        referenceLoadedDepth = pageSize
        busy = true
        defer { finishOperation() }
        await readReference()
    }

    func setReferenceText(_ text: String, location: Bool = false) {
        guard selectedSurface == .reference, !retryNeeded, !taskPresented else { return }
        guard text != (location ? referenceLocationText : referenceSearchText) else { return }
        if location { referenceLocationText = text } else { referenceSearchText = text }
        let type = location ? "setLocation" : "setSearch"
        referenceTextEdits[type] = ["type": type, "value": text]
        if referencePendingEdit?.text("type") == type { referencePendingEdit = referenceTextEdits[type] }
        referenceTextNeedsRead = true
        referenceCurrent = false
        referenceError = nil
        referenceLoadedDepth = pageSize
        scheduleReferenceRead()
    }

    func retryReference() async {
        guard selectedSurface == .reference, !busy, !retryNeeded, !taskPresented else { return }
        if !referenceTextEdits.isEmpty {
            referenceTextNeedsRead = true
            scheduleReferenceRead(delay: 0)
        } else { await refresh() }
    }

    private func scheduleReferenceRead(delay: UInt64 = 200_000_000) {
        guard selectedSurface == .reference, !busy, !retryNeeded, !taskPresented else { return }
        referenceReadTask?.cancel()
        referenceReadTask = Task {
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard !Task.isCancelled, selectedSurface == .reference, !busy, !retryNeeded, !taskPresented else { return }
            busy = true
            defer { finishOperation() }
            referenceTextNeedsRead = false
            // Text remains editable during reads. Drain the latest value of each
            // text field in order, always starting from core's effective state.
            if referencePendingEdit != nil || referenceError != nil {
                guard await readReference() else {
                    referenceTextNeedsRead = false
                    referencePickerNeedsRead = false
                    return
                }
            }
            while let type = referenceTextEdits.keys.sorted().first, let edit = referenceTextEdits[type] {
                referencePendingEdit = edit
                guard await readReference() else { referenceTextNeedsRead = false; return }
                if referenceTextEdits[type]?.text("value") == edit.text("value") { referenceTextEdits.removeValue(forKey: type) }
            }
            referenceTextNeedsRead = false
            if !reference.isEmpty {
                syncReferenceText()
                referenceCurrent = true
            }
            if referencePickerNeedsRead { await readReferencePicker() }
        }
    }

    private func syncReferenceText() {
        let state = reference.object("filters").object("state")
        if referenceTextEdits["setSearch"] == nil { referenceSearchText = state.text("searchQuery") }
        if referenceTextEdits["setLocation"] == nil { referenceLocationText = state.text("location") }
    }

    private func effectiveReferenceParams(_ snapshot: CoreObject) -> CoreObject {
        // Reference always reads the saved sort. Sending sortBy is rejected by core.
        ["groupBy": snapshot.text("groupBy"), "includeArchivedProjects": snapshot.flag("includeArchivedProjects"),
         "collapsedGroupIds": snapshot["collapsedGroupIds"] as? [String] ?? [],
         "filters": snapshot.object("filters").object("state")]
    }

    private func referencePage(params: CoreObject, offset: Int, limit: Int, revision: String? = nil,
                             edit: CoreObject? = nil) async throws -> CoreObject {
        var input = params
        input["offset"] = offset
        input["limit"] = limit
        if let revision { input["revision"] = revision }
        if let edit { input["filterEdit"] = edit }
        return try await query("menuRead", ["reference", try json(input)])
    }

    @discardableResult private func readReference() async -> Bool {
        referenceCurrent = false
        referencePickerCurrent = false
        referenceError = nil
        for attempt in 0..<2 {
            do {
                var next = try await referencePage(params: referenceParams, offset: 0, limit: pageSize, edit: referencePendingEdit)
                guard next.text("kind") == "reference", !next.text("revision").isEmpty, next.number("total") >= 0,
                      next.objects("items").count == min(pageSize, next.number("total")) else { throw CocoaError(.coderReadCorrupt) }
                let params = effectiveReferenceParams(next)
                if referenceViewPreferencePending {
                    let requested = referenceParams["collapsedGroupIds"] as? [String] ?? []
                    let returned = params["collapsedGroupIds"] as? [String] ?? []
                    guard params.text("groupBy") == referenceParams.text("groupBy"),
                          requested.count == returned.count,
                          zip(requested, returned).allSatisfy({ $0.0.utf8.elementsEqual($0.1.utf8) }) else {
                        throw CocoaError(.coderReadCorrupt)
                    }
                }
                var items = next.objects("items")
                let target = min(referenceLoadedDepth, next.number("total"))
                while items.count < target {
                    let limit = min(pageSize, target - items.count)
                    let page = try await referencePage(params: params, offset: items.count, limit: limit, revision: next.text("revision"))
                    try validateReferencePage(page, against: next, count: limit)
                    items += page.objects("items")
                }
                next["items"] = items
                for name in ["tokens", "projects"] {
                    let collection = referenceCollection(name, in: next)
                    guard collection.number("total") >= 0,
                          collection.objects("items").count == min(100, collection.number("total")) else {
                        throw CocoaError(.coderReadCorrupt)
                    }
                }
                referenceParams = params
                referencePendingEdit = nil
                reference = next
                if referenceViewPreferencePending {
                    preferenceDefaults.set(["groupBy": params.text("groupBy"),
                                            "collapsedGroups": referenceCollapsedGroups], forKey: referenceViewPreference)
                    referenceViewPreferencePending = false
                    NSLog("Native iOS Reference view preference updated releaseCheck=v1.3.4/ios-reference-view outcome=updated")
                }
                syncReferenceText()
                referenceCurrent = referenceTextEdits.isEmpty
                if !referencePickerName.isEmpty { referencePickerNeedsRead = true }
                return true
            } catch {
                if attempt == 1 { referenceError = error.localizedDescription }
            }
        }
        return false
    }

    private func validateReferencePage(_ page: CoreObject, against snapshot: CoreObject, count: Int) throws {
        guard page.text("kind") == "reference", page.text("revision") == snapshot.text("revision"),
              page.number("total") == snapshot.number("total"), page.number("count") == snapshot.number("count"),
              page.text("sortBy") == snapshot.text("sortBy"),
              page.objects("items").count == count,
              try json(effectiveReferenceParams(page)) == json(effectiveReferenceParams(snapshot)) else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    func loadMoreReference() async {
        guard referenceActionsEnabled else { return }
        let count = reference.objects("items").count
        guard count < reference.number("total") else { return }
        referenceLoadedDepth = count + min(pageSize, reference.number("total") - count)
        busy = true
        defer { finishOperation() }
        await readReference()
    }

    private func referenceCollection(_ name: String, in snapshot: CoreObject) -> CoreObject {
        snapshot.object("filters").object(name)
    }

    private func referenceCollectionPage(_ name: String, snapshot: CoreObject, query text: String? = nil,
                                       offset: Int, limit: Int) async throws -> CoreObject {
        var input: CoreObject = ["view": "reference", "collection": name, "params": effectiveReferenceParams(snapshot),
                                 "offset": offset, "limit": limit, "revision": snapshot.text("revision")]
        if let text { input["query"] = text }
        let page = try await query("menuRead", ["collection", try json(input)])
        guard page.text("view") == "reference", page.text("collection") == name,
              page.text("revision") == snapshot.text("revision"), page.number("total") >= offset,
              page.objects("items").count == min(limit, page.number("total") - offset) else {
            throw CocoaError(.coderReadCorrupt)
        }
        return page
    }

    func openReferencePicker(_ name: String) {
        guard referenceActionsEnabled, ["tokens", "projects"].contains(name) else { return }
        referencePickerName = name
        referencePickerQuery = ""
        referencePickerDepth = 100
        referencePicker = referenceCollection(name, in: reference)
        referencePickerCurrent = true
        referencePickerError = nil
        referencePickerNeedsRead = false
    }

    func closeReferencePicker() {
        referencePickerName = ""
        referencePickerNeedsRead = false
        referencePickerCurrent = false
        referencePickerError = nil
    }

    func setReferencePickerQuery(_ text: String) {
        guard !referencePickerName.isEmpty, text != referencePickerQuery, !retryNeeded else { return }
        referencePickerQuery = text
        referencePickerDepth = 100
        referencePickerCurrent = false
        referencePickerError = nil
        referencePickerNeedsRead = true
        scheduleReferenceRead()
    }

    func loadMoreReferencePicker() {
        guard referencePickerActionsEnabled, referencePicker.objects("items").count < referencePicker.number("total") else { return }
        referencePickerDepth = referencePicker.objects("items").count + pageSize
        retryReferencePicker()
    }

    func retryReferencePicker() {
        guard !referencePickerName.isEmpty, !busy, !retryNeeded else { return }
        referencePickerCurrent = false
        referencePickerNeedsRead = true
        scheduleReferenceRead(delay: 0)
    }

    private func readReferencePicker() async {
        let name = referencePickerName
        let text = referencePickerQuery
        guard !name.isEmpty else { return }
        referencePickerNeedsRead = false
        referencePickerCurrent = false
        referencePickerError = nil
        for attempt in 0..<2 {
            do {
                let snapshot = reference
                var next = try await referenceCollectionPage(name, snapshot: snapshot, query: text, offset: 0, limit: 100)
                var items = next.objects("items")
                let target = min(referencePickerDepth, next.number("total"))
                while items.count < target {
                    let limit = min(pageSize, target - items.count)
                    let page = try await referenceCollectionPage(name, snapshot: snapshot, query: text, offset: items.count, limit: limit)
                    guard page.number("total") == next.number("total") else { throw CocoaError(.coderReadCorrupt) }
                    items += page.objects("items")
                }
                guard name == referencePickerName, text == referencePickerQuery else { return }
                next["items"] = items
                referencePicker = next
                referencePickerCurrent = true
                return
            } catch {
                guard name == referencePickerName, text == referencePickerQuery else { return }
                if attempt == 0, await readReference() {
                    guard name == referencePickerName, text == referencePickerQuery else { return }
                    referencePickerNeedsRead = false
                    continue
                }
                referencePickerNeedsRead = false
                referencePickerError = error.localizedDescription
                return
            }
        }
    }

    func openTrash() async {
        guard ready, !busy, !retryNeeded, !taskPresented, !capturePresented, !areaPickerPresented else { return }
        if selectedSurface != .trash { trashCaller = selectedSurface }
        morePresented = false
        selectedSurface = .trash
        await refresh()
    }

    func closeTrash() async {
        guard selectedSurface == .trash, !busy, !retryNeeded, !taskPresented else { return }
        selectedSurface = trashCaller
        await refresh()
    }

    func retryTrash() async {
        guard selectedSurface == .trash, !busy, !retryNeeded, !taskPresented else { return }
        await refresh()
    }

    func loadMoreTrash() async {
        guard trashActionsEnabled else { return }
        let count = trash.objects("items").count
        guard count < trash.number("total") else { return }
        trashLoadedDepth = count + min(pageSize, trash.number("total") - count)
        busy = true
        defer { finishOperation() }
        await readTrash()
    }

    private func trashPage(offset: Int, limit: Int, revision: String? = nil) async throws -> CoreObject {
        var input: CoreObject = ["offset": offset, "limit": limit]
        if let revision { input["revision"] = revision }
        return try await query("menuRead", ["trash", try json(input)])
    }

    private func readTrash() async {
        trashCurrent = false
        trashError = nil
        for attempt in 0..<2 {
            do {
                var next = try await trashPage(offset: 0, limit: pageSize)
                guard !next.text("revision").isEmpty, next.number("total") >= 0,
                      next.number("taskCount") >= 0, next.number("projectCount") >= 0,
                      next.number("total") == next.number("taskCount") + next.number("projectCount"),
                      next.objects("items").count == min(pageSize, next.number("total")) else {
                    throw CocoaError(.coderReadCorrupt)
                }
                var items = next.objects("items")
                let target = min(trashLoadedDepth, next.number("total"))
                while items.count < target {
                    let limit = min(pageSize, target - items.count)
                    let page = try await trashPage(offset: items.count, limit: limit, revision: next.text("revision"))
                    guard page.text("revision") == next.text("revision"), page.number("total") == next.number("total"),
                          page.number("taskCount") == next.number("taskCount"), page.number("projectCount") == next.number("projectCount"),
                          page.text("summary") == next.text("summary"), page.text("retentionHint") == next.text("retentionHint"),
                          page.objects("items").count == limit else { throw CocoaError(.coderReadCorrupt) }
                    items += page.objects("items")
                }
                var identities: Set<String> = []
                for item in items {
                    let kind = item.text("type")
                    let id = kind == "task" ? item.object("row").text("id") : item.text("id")
                    guard ["task", "project"].contains(kind), !id.isEmpty,
                          identities.insert(kind + ":" + id).inserted else { throw CocoaError(.coderReadCorrupt) }
                }
                next["items"] = items
                trash = next
                trashCurrent = true
                return
            } catch {
                if attempt == 1 { trashError = error.localizedDescription }
            }
        }
    }

    func openHistory() async {
        guard ready, !busy, !retryNeeded, !taskPresented, !capturePresented else { return }
        if selectedSurface != .history { historyCaller = selectedSurface }
        morePresented = false
        selectedSurface = .history
        await refresh()
    }

    func closeHistory() async {
        guard selectedSurface == .history, !busy, !retryNeeded, !taskPresented else { return }
        closeHistoryPanel()
        selectedSurface = historyCaller
        await refresh()
    }

    func selectHistoryTab(_ id: String) async {
        guard selectedSurface == .history, !busy, !retryNeeded, !taskPresented,
              id != historyTabs.text("tab"), historyTabs.objects("tabs").contains(where: { $0.text("id") == id }) else { return }
        // Finish text edits before switching their owner to the other tab.
        guard historyTextEdits.isEmpty, historyPendingEdit == nil else { return }
        busy = true
        defer { finishOperation() }
        do {
            let tabs = try await query("menuRead", ["history", try json(["tab": id])])
            // Input can arrive while core resolves the tab. Drain it in its original tab.
            guard historyTextEdits.isEmpty, historyPendingEdit == nil else { return }
            historyPanel = ""
            closeHistoryPicker()
            historyTabs = tabs
            history = [:]
            historyNeedsRead = false
            await readHistory()
        } catch { historyCurrent = false; historyError = error.localizedDescription }
    }

    func setHistoryPanel(_ panel: String) {
        guard ["", "menu", "sort", "group", "filters"].contains(panel), !retryNeeded, !taskPresented else { return }
        let wasFilter = historyPanel == "filters"
        historyPanel = panel
        if panel != "filters" { closeHistoryPicker() }
        if historyArchived && wasFilter != (panel == "filters") {
            // Archive exposes all token options only while its filter sheet is open.
            historyCurrent = false
            historyNeedsRead = true
            scheduleHistoryRead(delay: 0)
        }
    }

    func closeHistoryPanel() { setHistoryPanel("") }

    func setHistoryOption(_ key: String, value: Any) async {
        guard historyActionsEnabled,
              ["sortBy", "groupBy", "collapsedGroupIds", "segment"].contains(key),
              historyArchived || key != "segment" else { return }
        let name = historyReadName
        if key == "sortBy" {
            guard let sortBy = value as? String, validHistorySort(sortBy) else { return }
            historyParamsByTab[name, default: [:]][key] = sortBy
            historyViewPreferencePending.insert(name)
        } else if key == "groupBy" {
            guard let groupBy = value as? String, validHistoryGroup(groupBy) else { return }
            historyParamsByTab[name, default: [:]][key] = groupBy
            historyParamsByTab[name, default: [:]]["collapsedGroupIds"] = historyCollapsedGroupsByTab[name]?[groupBy] ?? []
            historyViewPreferencePending.insert(name)
        } else if key == "collapsedGroupIds" {
            guard let ids = value as? [String] else { return }
            let groupBy = historyParamsByTab[name]?.text("groupBy") ?? "none"
            historyCollapsedGroupsByTab[name, default: [:]][groupBy] = ids
            historyParamsByTab[name, default: [:]][key] = ids
            historyViewPreferencePending.insert(name)
        } else { historyParamsByTab[name, default: [:]][key] = value }
        if key != "collapsedGroupIds" { historyDepthByTab[name] = pageSize }
        busy = true
        defer { finishOperation() }
        await readHistory()
    }

    func toggleHistorySection(_ id: String) async {
        guard historyActionsEnabled, let section = history.objects("items").first(where: {
            $0.text("type") == "section" && $0.text("id").utf8.elementsEqual(id.utf8) && $0.flag("collapsible")
        }) else { return }
        var ids = historyParamsByTab[historyReadName]?["collapsedGroupIds"] as? [String] ?? []
        if section.flag("collapsed") { ids.removeAll { $0.utf8.elementsEqual(id.utf8) } }
        else if !ids.contains(where: { $0.utf8.elementsEqual(id.utf8) }) { ids.append(id) }
        await setHistoryOption("collapsedGroupIds", value: ids)
    }

    func applyHistoryChipAction(_ action: CoreObject) async {
        guard historyActionsEnabled, !action.object("filterEdit").isEmpty else { return }
        await editHistoryFilter(action.object("filterEdit"))
    }

    func editHistoryFilter(_ edit: CoreObject) async {
        guard historyActionsEnabled, !edit.isEmpty else { return }
        historyPendingEdit = edit
        historyDepthByTab[historyReadName] = pageSize
        busy = true
        defer { finishOperation() }
        await readHistory()
    }

    func setHistoryText(_ text: String, location: Bool = false) {
        guard selectedSurface == .history, !retryNeeded, !taskPresented,
              text != (location ? historyLocationText : historySearchText) else { return }
        if location { historyLocationText = text } else { historySearchText = text }
        let type = location ? "setLocation" : "setSearch"
        historyTextEdits[type] = ["type": type, "value": text]
        if historyPendingEdit?.text("type") == type { historyPendingEdit = historyTextEdits[type] }
        historyNeedsRead = true
        historyCurrent = false
        historyError = nil
        historyDepthByTab[historyReadName] = pageSize
        scheduleHistoryRead()
    }

    func retryHistory() async {
        guard selectedSurface == .history, !busy, !retryNeeded, !taskPresented else { return }
        historyNeedsRead = true
        scheduleHistoryRead(delay: 0)
    }

    private func scheduleHistoryRead(delay: UInt64 = 200_000_000) {
        guard selectedSurface == .history, !busy, !retryNeeded, !taskPresented else { return }
        historyReadTask?.cancel()
        historyReadTask = Task {
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard !Task.isCancelled, selectedSurface == .history, !busy, !retryNeeded, !taskPresented else { return }
            busy = true
            defer { finishOperation() }
            let needsRead = historyNeedsRead
            historyNeedsRead = false
            if historyPendingEdit != nil || historyError != nil || (needsRead && historyTextEdits.isEmpty) {
                guard await readHistory() else {
                    historyNeedsRead = false
                    historyPickerNeedsRead = false
                    return
                }
            }
            while let type = historyTextEdits.keys.sorted().first, let edit = historyTextEdits[type] {
                historyPendingEdit = edit
                guard await readHistory() else { historyNeedsRead = false; historyPickerNeedsRead = false; return }
                if historyTextEdits[type]?.text("value") == edit.text("value") { historyTextEdits.removeValue(forKey: type) }
            }
            let correctSheet = !historyArchived || historyParamsByTab[historyReadName]?.flag("filterSheetOpen") == (historyPanel == "filters")
            historyNeedsRead = !correctSheet
            if !history.isEmpty && correctSheet {
                syncHistoryText()
                historyCurrent = true
            }
            if historyPickerNeedsRead && historyCurrent { await readHistoryPicker() }
        }
    }

    private func syncHistoryText() {
        let state = history.object("filters").object("state")
        if historyTextEdits["setSearch"] == nil { historySearchText = state.text("searchQuery") }
        if historyTextEdits["setLocation"] == nil { historyLocationText = state.text("location") }
    }

    private func effectiveHistoryParams(_ snapshot: CoreObject, name: String, input: CoreObject) -> CoreObject {
        if name == "done" {
            var params: CoreObject = ["groupBy": snapshot.text("groupBy"),
                                      "collapsedGroupIds": snapshot["collapsedGroupIds"] as? [String] ?? [],
                                      "filters": snapshot.object("filters").object("state")]
            if let sortBy = input["sortBy"] as? String { params["sortBy"] = sortBy }
            return params
        }
        // Archive revisions identify data/time, not choices. Keep the raw sort
        // override (or its absence); core can resolve a different displayed sort.
        var params = input
        params.removeValue(forKey: "filterEdit")
        params["segment"] = snapshot.text("segment")
        params["filters"] = snapshot.object("filters").object("state")
        if let option = snapshot.object("menu").object("group").objects("options").first(where: { $0.flag("selected") }) {
            params["groupBy"] = option.text("id")
        }
        return params
    }

    private func historyPage(name: String, params: CoreObject, offset: Int, limit: Int,
                             revision: String? = nil, edit: CoreObject? = nil) async throws -> CoreObject {
        var input = params
        input["offset"] = offset
        input["limit"] = limit
        if let revision { input["revision"] = revision }
        if let edit { input["filterEdit"] = edit }
        return try await query("menuRead", [name, try json(input)])
    }

    @discardableResult private func readHistory() async -> Bool {
        historyCurrent = false
        historyPickerCurrent = false
        historyError = nil
        for attempt in 0..<2 {
            do {
                let tabInput: CoreObject = historyTabs.text("tab").isEmpty ? [:] : ["tab": historyTabs.text("tab")]
                historyTabs = try await query("menuRead", ["history", try json(tabInput)])
                let name = historyReadName
                var input = historyParamsByTab[name] ?? [:]
                if name == "archive" { input["filterSheetOpen"] = historyPanel == "filters" }
                var next = try await historyPage(name: name, params: input, offset: 0, limit: pageSize, edit: historyPendingEdit)
                guard !next.text("revision").isEmpty, next.number("total") >= 0,
                      next.objects("items").count == min(pageSize, next.number("total")),
                      name == "archive" ? !next.text("segment").isEmpty : next.text("kind") == "done" else {
                    throw CocoaError(.coderReadCorrupt)
                }
                let params = effectiveHistoryParams(next, name: name, input: input)
                if historyViewPreferencePending.contains(name) {
                    let requested = input["collapsedGroupIds"] as? [String] ?? []
                    let returned = params["collapsedGroupIds"] as? [String] ?? []
                    guard params.text("groupBy") == input.text("groupBy"),
                          requested.count == returned.count,
                          zip(requested, returned).allSatisfy({ $0.0.utf8.elementsEqual($0.1.utf8) }),
                          name != "archive" || next.objects("items").allSatisfy({ item in
                              item.text("type") != "section" ||
                                  item.flag("collapsed") == requested.contains(where: { $0.utf8.elementsEqual(item.text("id").utf8) })
                          }) else { throw CocoaError(.coderReadCorrupt) }
                }
                var items = next.objects("items")
                let target = min(historyDepthByTab[name] ?? pageSize, next.number("total"))
                while items.count < target {
                    let limit = min(pageSize, target - items.count)
                    let page = try await historyPage(name: name, params: params, offset: items.count, limit: limit,
                                                     revision: next.text("revision"))
                    guard page.text("revision") == next.text("revision"), page.number("total") == next.number("total"),
                          page.objects("items").count == limit,
                          try json(effectiveHistoryParams(page, name: name, input: params)) == json(params) else {
                        throw CocoaError(.coderReadCorrupt)
                    }
                    if name == "done" {
                        guard page.text("kind") == "done", page.number("count") == next.number("count") else {
                            throw CocoaError(.coderReadCorrupt)
                        }
                    } else {
                        guard page.number("visibleTaskCount") == next.number("visibleTaskCount"),
                              try json(page.object("menu")) == json(next.object("menu")) else {
                            throw CocoaError(.coderReadCorrupt)
                        }
                    }
                    items += page.objects("items")
                }
                let tokens = next.object("filters").object("tokens")
                guard tokens.number("total") >= 0, tokens.objects("items").count == min(100, tokens.number("total")) else {
                    throw CocoaError(.coderReadCorrupt)
                }
                next["items"] = items
                historyParamsByTab[name] = params
                historyPendingEdit = nil
                history = next
                if historyViewPreferencePending.contains(name), let key = historyViewPreferences[name] {
                    var view: CoreObject = ["groupBy": params.text("groupBy"),
                                            "collapsedGroups": historyCollapsedGroupsByTab[name] ?? [:]]
                    if let sortBy = params["sortBy"] as? String { view["sortBy"] = sortBy }
                    preferenceDefaults.set(view, forKey: key)
                    historyViewPreferencePending.remove(name)
                    NSLog("Native iOS History view preference updated releaseCheck=v1.3.4/ios-history-view outcome=updated")
                }
                syncHistoryText()
                let correctSheet = name != "archive" || params.flag("filterSheetOpen") == (historyPanel == "filters")
                historyCurrent = historyTextEdits.isEmpty && correctSheet
                historyNeedsRead = !correctSheet || !historyTextEdits.isEmpty
                if !historyPickerName.isEmpty { historyPickerNeedsRead = true }
                return true
            } catch {
                if attempt == 1 { historyError = error.localizedDescription }
            }
        }
        return false
    }

    func loadMoreHistory() async {
        guard historyActionsEnabled else { return }
        let count = history.objects("items").count
        guard count < history.number("total") else { return }
        historyDepthByTab[historyReadName] = count + min(pageSize, history.number("total") - count)
        busy = true
        defer { finishOperation() }
        await readHistory()
    }

    func openHistoryPicker(_ name: String) {
        guard historyActionsEnabled, name == "tokens" else { return }
        historyPickerName = name
        historyPickerQuery = ""
        historyPickerDepth = 100
        historyPicker = history.object("filters").object("tokens")
        historyPickerCurrent = true
        historyPickerError = nil
        historyPickerNeedsRead = false
    }

    func closeHistoryPicker() {
        historyPickerName = ""
        historyPickerNeedsRead = false
        historyPickerCurrent = false
        historyPickerError = nil
    }

    func setHistoryPickerQuery(_ text: String) {
        guard !historyPickerName.isEmpty, text != historyPickerQuery, !retryNeeded else { return }
        historyPickerQuery = text
        historyPickerDepth = 100
        historyPickerCurrent = false
        historyPickerError = nil
        historyPickerNeedsRead = true
        scheduleHistoryRead()
    }

    func loadMoreHistoryPicker() {
        guard historyPickerActionsEnabled, historyPicker.objects("items").count < historyPicker.number("total") else { return }
        historyPickerDepth = historyPicker.objects("items").count + pageSize
        retryHistoryPicker()
    }

    func retryHistoryPicker() {
        guard !historyPickerName.isEmpty, !busy, !retryNeeded else { return }
        historyPickerCurrent = false
        historyPickerNeedsRead = true
        scheduleHistoryRead(delay: 0)
    }

    private func historyTokenPage(name: String, params: CoreObject, revision: String, text: String,
                                  offset: Int, limit: Int) async throws -> CoreObject {
        var input: CoreObject = ["params": params, "revision": revision, "query": text, "offset": offset, "limit": limit]
        if name == "done" { input["view"] = "done"; input["collection"] = "tokens" }
        let page = try await query("menuRead", [name == "done" ? "collection" : "archiveTokens", try json(input)])
        guard page.text("revision") == revision, page.number("total") >= offset,
              page.objects("items").count == min(limit, page.number("total") - offset),
              name == "archive" || (page.text("view") == "done" && page.text("collection") == "tokens") else {
            throw CocoaError(.coderReadCorrupt)
        }
        return page
    }

    private func readHistoryPicker() async {
        let name = historyReadName
        let text = historyPickerQuery
        guard !historyPickerName.isEmpty else { return }
        historyPickerNeedsRead = false
        historyPickerCurrent = false
        historyPickerError = nil
        for attempt in 0..<2 {
            do {
                let revision = history.text("revision")
                let params = historyParamsByTab[name] ?? [:]
                var next = try await historyTokenPage(name: name, params: params, revision: revision, text: text, offset: 0, limit: 100)
                var items = next.objects("items")
                let target = min(historyPickerDepth, next.number("total"))
                while items.count < target {
                    let limit = min(pageSize, target - items.count)
                    let page = try await historyTokenPage(name: name, params: params, revision: revision,
                                                          text: text, offset: items.count, limit: limit)
                    guard page.number("total") == next.number("total") else { throw CocoaError(.coderReadCorrupt) }
                    items += page.objects("items")
                }
                guard name == historyReadName, !historyPickerName.isEmpty, text == historyPickerQuery,
                      historyPanel == "filters", historyCurrent else { return }
                next["items"] = items
                historyPicker = next
                historyPickerCurrent = true
                return
            } catch {
                guard name == historyReadName, !historyPickerName.isEmpty, text == historyPickerQuery else { return }
                if attempt == 0, await readHistory() {
                    guard !historyPickerName.isEmpty, text == historyPickerQuery, historyCurrent else { return }
                    historyPickerNeedsRead = false
                    continue
                }
                historyPickerNeedsRead = false
                historyPickerError = error.localizedDescription
                return
            }
        }
    }

    func selectWaitingPerson(_ person: String) async {
        guard waitingActionsEnabled, person != waitingPerson,
              person.isEmpty || waiting.object("people").objects("items").contains(where: { $0.text("person") == person }) else { return }
        waitingPerson = person
        waitingLoadedDepth = pageSize
        busy = true
        defer { finishOperation() }
        await readWaiting()
    }

    func loadMoreWaiting() async {
        guard waitingActionsEnabled, waiting.objects("rows").count < waiting.number("total") else { return }
        busy = true
        defer { finishOperation() }
        let offset = waiting.objects("rows").count
        let limit = min(pageSize, waiting.number("total") - offset)
        waitingLoadedDepth = offset + limit
        waitingCurrent = false
        do {
            let page = try await query("menuRead", ["waiting", try json([
                "person": waitingPerson, "offset": offset, "limit": limit, "revision": waiting.text("revision")])])
            try validateWaitingPage(page, against: waiting, count: limit)
            waiting["rows"] = waiting.objects("rows") + page.objects("rows")
            waitingCurrent = true
            waitingError = nil
        } catch { await readWaiting() }
    }

    func loadMoreWaitingCollection(_ name: String) async {
        guard waitingActionsEnabled, name == "people" || name == "deferredProjects" else { return }
        let collection = waitingCollection(name, in: waiting)
        let offset = collection.objects("items").count
        guard offset < collection.number("total") else { return }
        busy = true
        defer { finishOperation() }
        let limit = min(pageSize, collection.number("total") - offset)
        waitingCollectionDepth[name] = offset + limit
        waitingCurrent = false
        do {
            let page = try await readWaitingCollection(name, snapshot: waiting, offset: offset, limit: limit)
            var next = waiting
            setWaitingCollection(name, items: collection.objects("items") + page.objects("items"), in: &next)
            waiting = next
            waitingCurrent = true
            waitingError = nil
        } catch { await readWaiting() }
    }

    private func readWaiting() async {
        waitingCurrent = false
        waitingError = nil
        for attempt in 0..<2 {
            do {
                var next = try await query("menuRead", ["waiting", try json([
                    "person": waitingPerson, "offset": 0, "limit": pageSize])])
                guard !next.text("revision").isEmpty, next.number("total") >= 0,
                      next.objects("rows").count == min(pageSize, next.number("total")) else {
                    throw CocoaError(.coderReadCorrupt)
                }
                var rows = next.objects("rows")
                // A removed person falls back to core's All selection. Rebuild
                // every requested window using that effective person and revision.
                let personChanged = next.text("person") != waitingPerson
                let target = min(personChanged ? pageSize : waitingLoadedDepth, next.number("total"))
                while rows.count < target {
                    let limit = min(pageSize, target - rows.count)
                    let page = try await query("menuRead", ["waiting", try json([
                        "person": next.text("person"), "offset": rows.count, "limit": limit, "revision": next.text("revision")])])
                    try validateWaitingPage(page, against: next, count: limit)
                    rows += page.objects("rows")
                }
                next["rows"] = rows
                for name in ["people", "deferredProjects"] {
                    let collection = waitingCollection(name, in: next)
                    var entries = collection.objects("items")
                    guard collection.number("total") >= entries.count else { throw CocoaError(.coderReadCorrupt) }
                    let target = min(waitingCollectionDepth[name] ?? entries.count, collection.number("total"))
                    while entries.count < target {
                        let limit = min(pageSize, target - entries.count)
                        let page = try await readWaitingCollection(name, snapshot: next, offset: entries.count, limit: limit)
                        entries += page.objects("items")
                    }
                    setWaitingCollection(name, items: entries, in: &next)
                }
                waitingPerson = next.text("person")
                if personChanged { waitingLoadedDepth = pageSize }
                waiting = next
                waitingCurrent = true
                return
            } catch {
                if attempt == 1 { waitingError = error.localizedDescription }
            }
        }
    }

    private func validateWaitingPage(_ page: CoreObject, against snapshot: CoreObject, count: Int) throws {
        guard page.text("revision") == snapshot.text("revision"), page.text("person") == snapshot.text("person"),
              page.number("total") == snapshot.number("total"), page.objects("rows").count == count else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    private func waitingCollection(_ name: String, in snapshot: CoreObject) -> CoreObject {
        name == "people" ? snapshot.object("people") : snapshot.object("deferred").object("rows")
    }

    private func readWaitingCollection(_ name: String, snapshot: CoreObject, offset: Int, limit: Int) async throws -> CoreObject {
        let page = try await query("menuRead", ["collection", try json([
            "view": "waiting", "collection": name, "params": ["person": snapshot.text("person")],
            "offset": offset, "limit": limit, "revision": snapshot.text("revision")])])
        guard page.text("view") == "waiting", page.text("collection") == name,
              page.text("revision") == snapshot.text("revision"),
              page.number("total") == waitingCollection(name, in: snapshot).number("total"),
              page.objects("items").count == limit else { throw CocoaError(.coderReadCorrupt) }
        return page
    }

    private func setWaitingCollection(_ name: String, items: [CoreObject], in snapshot: inout CoreObject) {
        var collection = waitingCollection(name, in: snapshot)
        guard !collection.isEmpty else { return }
        collection["items"] = items
        if name == "people" { snapshot["people"] = collection }
        else {
            var deferred = snapshot.object("deferred")
            deferred["rows"] = collection
            snapshot["deferred"] = deferred
        }
    }

    func openProject(_ row: CoreObject, descriptionSourceID: String? = nil) async {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented,
              selectedSurface != .project, selectedSurface != .trash, !row.text("id").isEmpty else { return }
        if selectedSurface == .review {
            let entries = (reviewGuidePresented ? reviewGuide : reviewOverview).objects("items")
            let stale = reviewGuidePresented ? reviewNested["staleProjects:"]?.objects("items") ?? [] : []
            guard reviewActionsEnabled, entries.contains(where: { $0.text("type") == "project"
                && ($0.text("projectId") == row.text("id") || (reviewGuidePresented && $0.text("id") == row.text("id"))) })
                || stale.contains(where: { $0.text("id") == row.text("id") })
                || reviewRows.contains(where: { $0.object("meta").objects("parts").contains(where: {
                    $0.text("kind") == "project" && $0.text("projectId") == row.text("id")
                }) }) else { return }
        }
        if selectedSurface == .focus {
            guard focusActionsEnabled, visibleDescriptionReference(descriptionSourceID, kind: "project", id: row.text("id"))
                || focus.objects("reviewProjects").contains(where: { $0.text("id") == row.text("id") })
                || focus.objects("sections").contains(where: { section in
                    section.objects("rows").contains(where: { task in
                        task.object("meta").objects("parts").contains(where: {
                            $0.text("kind") == "project" && $0.text("projectId") == row.text("id")
                        })
                    })
                }) else { return }
        }
        if selectedSurface == .waiting {
            guard waitingActionsEnabled, visibleDescriptionReference(descriptionSourceID, kind: "project", id: row.text("id"))
                || waiting.object("deferred").object("rows").objects("items")
                .contains(where: { $0.text("id") == row.text("id") }) else { return }
        }
        if selectedSurface == .someday {
            guard somedayActionsEnabled, visibleDescriptionReference(descriptionSourceID, kind: "project", id: row.text("id"))
                || someday.object("deferred").object("rows").objects("items")
                .contains(where: { $0.text("id") == row.text("id") }) else { return }
        }
        if selectedSurface == .reference {
            guard referenceActionsEnabled, reference.objects("items").contains(where: { item in
                item.text("type") == "task" && item.object("row").object("meta").objects("parts").contains(where: {
                    $0.text("kind") == "project" && $0.text("projectId") == row.text("id")
                })
            }) else { return }
        }
        if selectedSurface == .history {
            guard historyActionsEnabled, history.objects("items").contains(where: { item in
                (item.text("type") == "project" && item.text("id") == row.text("id")) ||
                (item.text("type") == "task" && item.object("row").object("meta").objects("parts").contains(where: {
                    $0.text("kind") == "project" && $0.text("projectId") == row.text("id")
                }))
            }) else { return }
        }
        if selectedSurface == .contexts {
            guard contextsActionsEnabled, contexts.objects("rows").contains(where: { task in
                task.object("meta").objects("parts").contains(where: {
                    $0.text("kind") == "project" && $0.text("projectId") == row.text("id")
                })
            }) else { return }
        }
        if selectedSurface == .search {
            guard searchActionsEnabled,
                  searchView.objects("projects").contains(where: { $0.text("id") == row.text("id") }) else { return }
            invalidateSearch()
        }
        projectTaskOrderPresented = false
        projectTaskOrderView = [:]
        projectTaskOrderError = nil
        projectTaskOrderCurrent = false
        projectCaller = selectedSurface
        projectFilterSession += 1
        projectFilterReadTask?.cancel()
        projectHeader = row
        projectDetail = [:]
        projectViewOptionsPresented = false
        projectFiltersPresented = false
        projectFilterSearchText = ""
        projectFilterLocationText = ""
        projectFilterPickerName = ""
        projectFilterPickerQuery = ""
        projectFilterPicker = [:]
        projectFilterPickerCurrent = false
        projectFilterPickerDepth = 100
        projectFilterPublishedSheetOpen = false
        projectFilterPendingEdit = nil
        projectFilterTextEdits = [:]
        projectFilterNeedsRead = false
        projectFilterPickerNeedsRead = false
        projectFilterError = nil
        projectFilterPickerError = nil
        projectTaskSortPresented = false
        projectTaskSortOptions = [:]
        projectTaskSortError = nil
        projectTaskSortReadError = nil
        projectCompletedCollapsed = true
        pendingProjectView = nil
        projectLoadedDepth = pageSize
        projectCurrent = false
        projectError = nil
        projectNotes = [:]
        projectNotesExpanded = false
        projectNotesCurrent = false
        projectNotesError = nil
        projectNotesLoadedDepth = pageSize
        projectNotesEditMode = false
        projectNotesDraft = ""
        projectNotesDraftDirection = ""
        projectNotesEditError = nil
        projectNotesEditReadError = nil
        projectNotesEditConflict = false
        projectNotesEditOptions = [:]
        projectNotesEditOptionsCurrent = false
        projectNotesEditLoaded = false
        projectNotesEditBaseRaw = nil
        projectNotesWriteRequest = nil
        projectNotesExpectedRaw = nil
        projectFlowError = nil
        projectFlowReadError = nil
        projectStatusOpen = false
        projectStatusError = nil
        projectStatusReadError = nil
        projectStatusOptions = [:]
        projectStatusOptionsCurrent = false
        projectStatusRequest = nil
        projectStatusExpectedID = nil
        projectStatusExpectedStatus = nil
        projectDateField = nil
        projectDatePicker = [:]
        projectDateOpeningTimeZone = nil
        projectReviewOpeningRaw = nil
        projectDateError = nil
        projectDateReadError = nil
        projectDateOptions = [:]
        projectDateOptionsField = nil
        projectDateOptionsCurrent = false
        projectDateRequest = nil
        projectDateExpectedID = nil
        projectDateExpectedField = nil
        projectDateExpectedValue = nil
        areaManagerPresented = false
        areaManagerProjectID = nil
        projectAreaPresented = false
        projectAreaOptions = [:]
        projectAreaOptionsCurrent = false
        projectAreaOpeningAssociation = nil
        projectAreaRequest = nil
        projectAreaCreatePresented = false
        projectAreaCreateProjectID = nil
        projectAreaCreatedID = nil
        projectAreaCreateDurableChange = false
        projectAreaCreateNameChecking = false
        areaCreateNameGeneration += 1
        projectAreaHasRequestedChoice = false
        projectAreaRequestedID = nil
        projectAreaExpectedID = nil
        projectAreaExpectedAreaID = nil
        projectAreaError = nil
        projectAreaReadError = nil
        projectTagsPresented = false
        projectTagsAddPresented = false
        projectTagsOptions = [:]
        projectTagsOptionsCurrent = false
        projectTagsOpeningRaw = nil
        projectTagsRequest = nil
        projectTagsExpectedID = nil
        projectTagsDraft = ""
        projectTagsError = nil
        projectTagsReadError = nil
        projectSectionsPresented = false
        projectSectionEditing = false
        projectSectionEditID = nil
        projectSectionTitle = ""
        projectSectionOptions = [:]
        projectSectionOptionsCurrent = false
        projectSectionRenameOptions = [:]
        projectSectionRenameOptionsCurrent = false
        projectSectionError = nil
        projectSectionReadError = nil
        projectSectionRequest = nil
        projectSectionExpectedID = nil
        projectSectionExpectedProjectID = nil
        projectSectionRenameRequest = nil
        projectSectionRenameExpectedID = nil
        projectSectionRenameExpectedProjectID = nil
        projectSectionDeleteOptions = [:]
        projectSectionDeleteOptionsCurrent = false
        projectSectionDeleteReadyID = nil
        projectSectionDeleteRequest = nil
        projectSectionDeleteExpectedID = nil
        projectSectionDeleteExpectedProjectID = nil
        projectSectionOrderOptions = [:]
        projectSectionOrderOptionsCurrent = false
        projectSectionOrderRequest = nil
        projectSectionOrderExpectedProjectID = nil
        projectSectionOrderExpectedIDs = nil
        morePresented = false
        selectedSurface = .project
        busy = true
        defer { finishOperation() }
        await readProjectDetail()
    }

    func closeProject() async {
        guard await flushProjectNotesEdit() else { return }
        guard selectedSurface == .project, !busy, !retryNeeded, !taskPresented,
              !projectRenameEditing && !projectSectionsPresented && !projectAreaPresented
              && !projectTagsPresented else { return }
        projectFilterSession += 1
        projectFilterReadTask?.cancel()
        projectFiltersPresented = false
        projectFilterPickerName = ""
        projectFilterNeedsRead = false
        projectFilterPickerNeedsRead = false
        projectDateField = nil
        projectDatePicker = [:]
        projectDateOpeningTimeZone = nil
        projectReviewOpeningRaw = nil
        projectAreaOptions = [:]
        projectAreaOptionsCurrent = false
        projectAreaOpeningAssociation = nil
        projectAreaCreateProjectID = nil
        projectAreaCreatedID = nil
        projectAreaCreateDurableChange = false
        projectAreaError = nil
        projectAreaReadError = nil
        projectTagsOptions = [:]
        projectTagsOptionsCurrent = false
        projectTagsOpeningRaw = nil
        projectTagsDraft = ""
        projectTagsError = nil
        projectTagsReadError = nil
        projectTaskOrderPresented = false
        projectTaskOrderCurrent = false
        selectedSurface = projectCaller
        projectCurrent = false
        projectError = nil
        await refresh()
    }

    func openProjectViewOptions() async {
        guard await flushProjectNotesEdit(), projectViewOpenEnabled else { return }
        projectViewOptionsPresented = true
    }

    func closeProjectViewOptions() { projectViewOptionsPresented = false }

    func openProjectFilters() async {
        guard await flushProjectNotesEdit(), projectViewOpenEnabled, !projectTaskSortPresented,
              !projectFiltersPresented else { return }
        projectViewOptionsPresented = false
        projectFiltersPresented = true
        projectFilterNeedsRead = true
        busy = true
        defer { finishOperation() }
        projectFilterNeedsRead = false
        _ = await readProjectDetail()
    }

    func closeProjectFilters() {
        guard projectFiltersPresented else { return }
        projectFiltersPresented = false
        closeProjectFilterPicker()
        projectFilterNeedsRead = true
        scheduleProjectFilterRead(delay: 0)
    }

    func editProjectFilter(_ edit: CoreObject) async {
        guard await flushProjectNotesEdit(), projectFilterActionsEnabled, !edit.isEmpty else { return }
        projectFilterPendingEdit = edit
        projectLoadedDepth = pageSize
        busy = true
        defer { finishOperation() }
        _ = await readProjectDetail()
    }

    func setProjectFilterText(_ text: String, location: Bool = false) {
        guard selectedSurface == .project, projectFiltersPresented, !retryNeeded, !taskPresented,
              !text.utf8.elementsEqual((location ? projectFilterLocationText : projectFilterSearchText).utf8) else { return }
        if location { projectFilterLocationText = text } else { projectFilterSearchText = text }
        let type = location ? "setLocation" : "setSearch"
        projectFilterTextEdits[type] = ["type": type, "value": text]
        if projectFilterPendingEdit?.text("type") == type { projectFilterPendingEdit = projectFilterTextEdits[type] }
        projectFilterNeedsRead = true
        projectCurrent = false
        projectError = nil
        projectFilterError = nil
        projectLoadedDepth = pageSize
        scheduleProjectFilterRead()
    }

    func retryProjectFilterRead() {
        guard selectedSurface == .project, !busy, !retryNeeded, !taskPresented else { return }
        projectFilterNeedsRead = true
        scheduleProjectFilterRead(delay: 0)
    }

    private func scheduleProjectFilterRead(delay: UInt64 = 200_000_000) {
        guard selectedSurface == .project, !busy, !retryNeeded, !taskPresented else { return }
        projectFilterReadTask?.cancel()
        let session = projectFilterSession
        projectFilterReadTask = Task {
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard !Task.isCancelled, session == projectFilterSession, selectedSurface == .project,
                  !busy, !retryNeeded, !taskPresented else { return }
            busy = true
            defer { finishOperation() }
            let needsRead = projectFilterNeedsRead
            projectFilterNeedsRead = false
            if projectFilterPendingEdit != nil || projectError != nil || projectFilterError != nil
                || (needsRead && (projectFilterTextEdits.isEmpty
                    || projectFilterPublishedSheetOpen != projectFiltersPresented)) {
                guard await readProjectDetail() else { return }
            }
            while let type = projectFilterTextEdits.keys.sorted().first,
                  let edit = projectFilterTextEdits[type] {
                projectFilterPendingEdit = edit
                guard await readProjectDetail() else { return }
                if let queued = projectFilterTextEdits[type],
                   queued.text("value").utf8.elementsEqual(edit.text("value").utf8) {
                    projectFilterTextEdits.removeValue(forKey: type)
                }
            }
            syncProjectFilterText()
            if projectFilterPickerNeedsRead { await readProjectFilterPicker() }
        }
    }

    private func syncProjectFilterText() {
        let state = projectDetail.object("filters").object("state")
        if projectFilterTextEdits["setSearch"] == nil { projectFilterSearchText = state.text("searchQuery") }
        if projectFilterTextEdits["setLocation"] == nil { projectFilterLocationText = state.text("location") }
    }

    func openProjectFilterPicker(_ name: String) {
        guard name == "tokens", projectFiltersPresented, projectFilterActionsEnabled,
              projectFilterPublishedSheetOpen else { return }
        projectFilterPickerName = name
        projectFilterPickerQuery = ""
        projectFilterPickerDepth = 100
        projectFilterPickerCurrent = false
        projectFilterPickerError = nil
        projectFilterPickerNeedsRead = true
        scheduleProjectFilterRead(delay: 0)
    }

    func closeProjectFilterPicker() {
        projectFilterPickerName = ""
        projectFilterPickerCurrent = false
        projectFilterPickerNeedsRead = false
        projectFilterPickerError = nil
    }

    func setProjectFilterPickerQuery(_ text: String) {
        guard projectFilterPickerName == "tokens", !retryNeeded,
              !text.utf8.elementsEqual(projectFilterPickerQuery.utf8) else { return }
        projectFilterPickerQuery = text
        projectFilterPickerDepth = 100
        projectFilterPickerCurrent = false
        projectFilterPickerError = nil
        projectFilterPickerNeedsRead = true
        scheduleProjectFilterRead()
    }

    func loadMoreProjectFilterPicker() {
        guard projectFilterPickerActionsEnabled,
              projectFilterPicker.objects("items").count < projectFilterPicker.number("total") else { return }
        projectFilterPickerDepth = projectFilterPicker.objects("items").count + pageSize
        retryProjectFilterPicker()
    }

    func retryProjectFilterPicker() {
        guard projectFilterPickerName == "tokens", !busy, !retryNeeded else { return }
        projectFilterPickerCurrent = false
        projectFilterPickerNeedsRead = true
        scheduleProjectFilterRead(delay: 0)
    }

    func toggleProjectShowCompleted() async {
        guard await flushProjectNotesEdit(), projectViewOptionsPresented, projectViewOpenEnabled,
              projectDetail.object("controls").flag("canToggleCompleted") else { return }
        projectViewOptionsPresented = false
        pendingProjectView = (!projectShowCompleted, true)
        busy = true
        defer { finishOperation() }
        await readProjectDetail()
    }

    func toggleProjectCompletedSection(_ id: String) async {
        guard await flushProjectNotesEdit(), projectViewOpenEnabled,
              projectDetail.objects("items").contains(where: {
                  $0.text("type") == "section" && $0.text("id") == id && $0.flag("collapsible")
              }) else { return }
        pendingProjectView = (projectShowCompleted, !projectCompletedCollapsed)
        busy = true
        defer { finishOperation() }
        await readProjectDetail()
    }

    private func projectDetailWindow(projectID: String, offset: Int, limit: Int, revision: String? = nil,
                                     showCompleted: Bool, collapsed: Bool, filters: CoreObject,
                                     sheetOpen: Bool, edit: CoreObject? = nil) async throws -> CoreObject {
        var input: CoreObject = ["projectId": projectID, "offset": offset, "limit": limit,
                                 "showCompleted": showCompleted, "completedCollapsed": collapsed,
                                 "filters": filters, "filterSheetOpen": sheetOpen]
        if let revision { input["revision"] = revision }
        if let edit { input["filterEdit"] = edit }
        #if DEBUG && targetEnvironment(simulator)
        if offset == 0, edit != nil, projectFilterTestReadFailures > 0 {
            projectFilterTestReadFailures -= 1
            throw CocoaError(.fileReadUnknown)
        }
        #endif
        return try await query("menuRead", ["projectDetailFilterView", try json(input)])
    }

    private func projectFilterOptionsPage(snapshot: CoreObject, query text: String, offset: Int,
                                          limit: Int, revision: String? = nil) async throws -> CoreObject {
        var input: CoreObject = ["projectId": snapshot.text("projectId"),
                                 "showCompleted": snapshot.object("controls").flag("showCompleted"),
                                 "completedCollapsed": snapshot.object("controls").flag("completedCollapsed"),
                                 "filters": snapshot.object("filters").object("state"),
                                 "picker": "tokens", "query": text, "offset": offset, "limit": limit]
        if let revision { input["revision"] = revision }
        return try await query("menuRead", ["projectDetailFilterOptions", try json(input)])
    }

    private func readProjectFilterPicker() async {
        let text = projectFilterPickerQuery
        let id = projectHeader.text("id")
        let session = projectFilterSession
        guard projectFiltersPresented, projectFilterPickerName == "tokens", projectCurrent else { return }
        projectFilterPickerNeedsRead = false
        projectFilterPickerCurrent = false
        projectFilterPickerError = nil
        for attempt in 0..<2 {
            do {
                let snapshot = projectDetail
                let first = try await projectFilterOptionsPage(snapshot: snapshot, query: text, offset: 0, limit: 100)
                guard selectedSurface == .project, session == projectFilterSession, id == projectHeader.text("id"),
                      projectFiltersPresented, projectFilterPickerName == "tokens",
                      text.utf8.elementsEqual(projectFilterPickerQuery.utf8) else { return }
                guard first.text("viewRevision") == snapshot.text("revision"),
                      first.text("projectId") == id, first.text("picker") == "tokens",
                      first.text("query").utf8.elementsEqual(text.utf8), first.number("offset") == 0,
                      !first.text("revision").isEmpty, first.number("total") >= 0,
                      first.objects("items").count == min(100, first.number("total")) else {
                    throw CocoaError(.coderReadCorrupt)
                }
                var items = first.objects("items")
                let target = min(projectFilterPickerDepth, first.number("total"))
                while items.count < target {
                    let limit = min(pageSize, target - items.count)
                    let page = try await projectFilterOptionsPage(snapshot: snapshot, query: text,
                        offset: items.count, limit: limit, revision: first.text("revision"))
                    guard page.text("revision") == first.text("revision"),
                          page.text("viewRevision") == snapshot.text("revision"),
                          page.text("projectId") == id, page.text("picker") == "tokens",
                          page.text("query").utf8.elementsEqual(text.utf8), page.number("offset") == items.count,
                          page.number("total") == first.number("total"),
                          page.objects("items").count == limit else { throw CocoaError(.coderReadCorrupt) }
                    items += page.objects("items")
                }
                guard selectedSurface == .project, session == projectFilterSession, id == projectHeader.text("id"),
                      projectFiltersPresented, projectFilterPickerName == "tokens",
                      text.utf8.elementsEqual(projectFilterPickerQuery.utf8),
                      snapshot.text("revision") == projectDetail.text("revision") else { return }
                var next = first
                next["items"] = items
                projectFilterPicker = next
                projectFilterPickerCurrent = true
                projectFilterPickerNeedsRead = false
                return
            } catch {
                guard selectedSurface == .project, session == projectFilterSession, id == projectHeader.text("id"),
                      projectFiltersPresented, projectFilterPickerName == "tokens",
                      text.utf8.elementsEqual(projectFilterPickerQuery.utf8) else { return }
                if attempt == 0, await readProjectDetail() { continue }
                projectFilterPickerError = error.localizedDescription
                return
            }
        }
    }

    func loadMoreProject() async {
        guard await flushProjectNotesEdit() else { return }
        guard projectActionsEnabled, projectDetail.objects("items").count < projectDetail.number("total") else { return }
        busy = true
        defer { finishOperation() }
        let session = projectFilterSession
        let snapshot = projectDetail
        let sheetOpen = projectFiltersPresented
        let offset = projectDetail.objects("items").count
        let limit = min(pageSize, projectDetail.number("total") - offset)
        projectLoadedDepth = offset + limit
        projectCurrent = false
        do {
            let window = try await projectDetailWindow(projectID: snapshot.text("projectId"), offset: offset, limit: limit,
                revision: snapshot.text("revision"), showCompleted: projectShowCompleted,
                collapsed: projectCompletedCollapsed, filters: snapshot.object("filters").object("state"),
                sheetOpen: sheetOpen)
            guard session == projectFilterSession, selectedSurface == .project,
                  snapshot.text("projectId") == projectHeader.text("id"), sheetOpen == projectFiltersPresented else { return }
            try validateProjectWindow(window, against: snapshot, count: limit)
            projectDetail["items"] = snapshot.objects("items") + window.objects("items")
            projectCurrent = true
            projectError = nil
        } catch {
            // Restart at zero after a stale or failed window; never append mixed revisions.
            guard session == projectFilterSession, selectedSurface == .project,
                  snapshot.text("projectId") == projectHeader.text("id") else { return }
            await readProjectDetail()
            if projectNotesExpanded && projectCurrent {
                if projectNotesEditMode {
                    do { try await readProjectNotesEditOptions() }
                    catch { projectNotesEditReadError = error.localizedDescription }
                }
                await readProjectNotes()
            }
        }
    }

    @discardableResult private func readProjectDetail() async -> Bool {
        projectCurrent = false
        projectFilterPickerCurrent = false
        projectError = nil
        let id = projectHeader.text("id")
        let session = projectFilterSession
        let sheetOpen = projectFiltersPresented
        let filters = projectDetail.object("filters").object("state")
        let edit = projectFilterPendingEdit
        let showCompleted = pendingProjectView?.showCompleted ?? projectShowCompleted
        var collapsed = pendingProjectView?.collapsed ?? projectCompletedCollapsed
        for attempt in 0..<2 {
            do {
                // Reference labels may be aliases; resolve the destination header through core.
                if projectHeader["title"] == nil { try await readProjectRenameOptions() }
                var next = try await projectDetailWindow(projectID: id, offset: 0, limit: pageSize,
                    showCompleted: showCompleted, collapsed: collapsed, filters: filters,
                    sheetOpen: sheetOpen, edit: edit)
                guard session == projectFilterSession, selectedSurface == .project,
                      id == projectHeader.text("id"), sheetOpen == projectFiltersPresented else { return false }
                // RN resets the completed pile when its grouping mode changes (including type/status edits).
                if !collapsed, !projectDetail.isEmpty,
                   next.object("controls").flag("groupCompletedTasksLast")
                    != projectDetail.object("controls").flag("groupCompletedTasksLast") {
                    collapsed = true
                    // Apply the one pending edit to its original state again; never cycle a token twice.
                    next = try await projectDetailWindow(projectID: id, offset: 0, limit: pageSize,
                        showCompleted: showCompleted, collapsed: collapsed, filters: filters,
                        sheetOpen: sheetOpen, edit: edit)
                }
                let metadata = next.object("metadata")
                let controls = next.object("controls")
                let filterView = next.object("filters")
                let resolved = filterView.object("state")
                guard next.text("projectId") == id, !next.text("revision").isEmpty,
                      !next.text("mutationRevision").isEmpty,
                      next.number("total") >= 0,
                      !filterView.isEmpty, !resolved.isEmpty,
                      next["chips"] is [CoreObject], !next.text("filterButtonLabel").isEmpty,
                      (next["empty"] is NSNull) == (next.number("total") > 0),
                      filterView["projects"] is NSNull, filterView.objects("timeEstimates").isEmpty,
                      !filterView.object("visibility").flag("timeEstimate"),
                      filterView.object("tokens").number("total") >= 0,
                      filterView.object("tokens").objects("items").count
                        == min(100, filterView.object("tokens").number("total")),
                      (edit?.text("type") != "setSearch"
                        || resolved.text("searchQuery").utf8.elementsEqual((edit?.text("value") ?? "").utf8)),
                      (edit?.text("type") != "setLocation"
                        || resolved.text("location").utf8.elementsEqual((edit?.text("value") ?? "").utf8)),
                      ["showCompleted", "completedCollapsed", "canToggleCompleted", "groupCompletedTasksLast"].allSatisfy({ key in
                          (controls[key] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true
                      }), controls.flag("showCompleted") == showCompleted,
                      controls.flag("completedCollapsed") == collapsed, !controls.text("label").isEmpty,
                      ["hasStartDate", "hasDueDate", "hasReviewDate"].allSatisfy({ key in
                          (metadata[key] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true
                      }),
                      next.objects("items").count == min(pageSize, next.number("total")) else {
                    throw CocoaError(.coderReadCorrupt)
                }
                var items = next.objects("items")
                let target = min(projectLoadedDepth, next.number("total"))
                while items.count < target {
                    let limit = min(pageSize, target - items.count)
                    let window = try await projectDetailWindow(projectID: id, offset: items.count, limit: limit,
                        revision: next.text("revision"), showCompleted: showCompleted, collapsed: collapsed,
                        filters: resolved, sheetOpen: sheetOpen)
                    try validateProjectWindow(window, against: next, count: limit)
                    items += window.objects("items")
                }
                next["items"] = items
                let sortOptions = try await readProjectTaskSortOptions(projectID: id, revision: next.text("mutationRevision"))
                guard session == projectFilterSession, selectedSurface == .project,
                      id == projectHeader.text("id"), sheetOpen == projectFiltersPresented else { return false }
                if projectNotes.text("revision") != next.text("mutationRevision") { projectNotesCurrent = false }
                if projectNotesEditOptions.text("revision") != next.text("mutationRevision") {
                    projectNotesEditOptionsCurrent = false
                }
                if projectStatusOptions.text("revision") != next.text("mutationRevision") {
                    projectStatusOptionsCurrent = false
                }
                if projectDateOptions.text("revision") != next.text("mutationRevision") {
                    projectDateOptionsCurrent = false
                }
                if projectAreaOptions.text("revision") != next.text("mutationRevision") {
                    projectAreaOptionsCurrent = false
                }
                if projectTagsOptions.text("revision") != next.text("mutationRevision") {
                    projectTagsOptionsCurrent = false
                }
                if projectSectionOptions.text("revision") != next.text("mutationRevision") {
                    projectSectionOptionsCurrent = false
                }
                if projectSectionOrderOptions.text("revision") != next.text("mutationRevision") {
                    projectSectionOrderOptionsCurrent = false
                }
                if projectSectionRenameOptions.text("revision") != next.text("mutationRevision") {
                    projectSectionRenameOptionsCurrent = false
                }
                if projectSectionDeleteOptions.text("revision") != next.text("mutationRevision") {
                    projectSectionDeleteOptionsCurrent = false
                }
                if showCompleted != projectShowCompleted {
                    preferenceDefaults.set(showCompleted, forKey: projectShowCompletedPreference)
                    NSLog("Native iOS Project completed preference applied releaseCheck=v1.3.3/native-ios-project-completed-view")
                }
                projectShowCompleted = showCompleted
                projectCompletedCollapsed = collapsed
                pendingProjectView = nil
                projectFilterPendingEdit = nil
                projectFilterPublishedSheetOpen = sheetOpen
                projectFilterError = nil
                projectDetail = next
                projectTaskSortOptions = sortOptions
                syncProjectFilterText()
                if !projectFilterPickerName.isEmpty { projectFilterPickerNeedsRead = true }
                projectCurrent = true
                if edit != nil {
                    NSLog("Native iOS Project task filters applied releaseCheck=v1.3.3/native-ios-project-task-filters")
                }
                return true
            } catch {
                guard session == projectFilterSession, selectedSurface == .project,
                      id == projectHeader.text("id"), sheetOpen == projectFiltersPresented else { return false }
                if attempt == 1 {
                    projectError = error.localizedDescription
                    if sheetOpen { projectFilterError = error.localizedDescription }
                }
            }
        }
        return false
    }

    private func validateProjectWindow(_ window: CoreObject, against snapshot: CoreObject, count: Int) throws {
        guard window.text("projectId") == snapshot.text("projectId"),
              window.text("revision") == snapshot.text("revision"),
              window.text("mutationRevision") == snapshot.text("mutationRevision"),
              window.number("total") == snapshot.number("total"),
              window.flag("readOnly") == snapshot.flag("readOnly"),
              NSDictionary(dictionary: window.object("controls")).isEqual(to: snapshot.object("controls")),
              try json(window.object("filters")) == json(snapshot.object("filters")),
              try json(window.objects("chips")) == json(snapshot.objects("chips")),
              window.text("filterButtonLabel") == snapshot.text("filterButtonLabel"),
              try json(["empty": window["empty"] ?? NSNull()])
                == json(["empty": snapshot["empty"] ?? NSNull()]),
              window.objects("items").count == count else { throw CocoaError(.coderReadCorrupt) }
    }

    func setProjectNotesDraft(_ value: String) {
        guard projectNotesEditInputEnabled, value != projectNotesDraft else { return }
        projectNotesDraft = value
        projectNotesEditError = nil
    }

    func refreshProjectNotesDraftDirection() async {
        let id = projectHeader.text("id")
        let title = projectHeader.text("title")
        let text = projectNotesDraft
        guard projectNotesEditLoaded, selectedSurface == .project, !id.isEmpty, !Task.isCancelled else { return }
        do {
            let result = try await query("projectNotesDraftDirection", [try json(["projectId": id, "text": text])])
            guard !Task.isCancelled, selectedSurface == .project, projectHeader.text("id") == id,
                  projectHeader.text("title") == title, projectNotesDraft == text,
                  result.count == 1, ["ltr", "rtl"].contains(result.text("direction")) else { return }
            projectNotesDraftDirection = result.text("direction")
        } catch {
            // Presentation reads must not interrupt editing or change write/retry state.
        }
    }

    private func readProjectNotesEditOptions() async throws {
        let id = projectHeader.text("id")
        guard selectedSurface == .project, projectCurrent, projectDetail.text("projectId") == id,
              !id.isEmpty else { throw CocoaError(.coderReadCorrupt) }
        for attempt in 0..<2 {
            let options = try await query("projectNotesEditOptions", [try json(["projectId": id])])
            let project = options.object("project")
            guard options.count == 3, !options.text("revision").isEmpty,
                  let canEdit = options["canEdit"] as? NSNumber,
                  CFGetTypeID(canEdit) == CFBooleanGetTypeID(),
                  project.count == 7, project.text("id") == id,
                  project["title"] is String, !project.text("status").isEmpty,
                  project["supportNotes"] is String || project["supportNotes"] is NSNull,
                  project["rev"] is Int || project["rev"] is NSNull,
                  project["revBy"] is String || project["revBy"] is NSNull,
                  !project.text("updatedAt").isEmpty else { throw CocoaError(.coderReadCorrupt) }
            if options.text("revision") != projectDetail.text("mutationRevision") {
                if attempt == 0 {
                    await readProjectDetail()
                    guard projectCurrent, projectHeader.text("id") == id else { throw CocoaError(.coderReadCorrupt) }
                    continue
                }
                throw CocoaError(.coderReadCorrupt)
            }
            let raw = project["supportNotes"] as? String
            if projectNotesEditLoaded && projectNotesDirty && raw != projectNotesEditBaseRaw {
                projectNotesEditConflict = true
                projectNotesEditOptionsCurrent = false
                projectNotesEditError = "Project Notes changed. Discard the draft to reload."
                return
            }
            if !projectNotesEditLoaded || !projectNotesDirty {
                projectNotesDraft = raw ?? ""
                projectNotesEditBaseRaw = raw
            }
            projectNotesEditLoaded = true
            projectNotesEditOptions = options
            projectNotesEditOptionsCurrent = true
            projectNotesEditConflict = !canEdit.boolValue && projectNotesDirty
            if projectNotesEditConflict {
                projectNotesEditError = "Project Notes are no longer editable. Discard the draft to reload."
            } else if !canEdit.boolValue {
                projectNotesEditMode = false
            }
            projectNotesEditReadError = nil
            return
        }
    }

    func retryProjectNotesEditRead() async {
        guard ready, selectedSurface == .project, !busy, !retryNeeded,
              projectNotesWriteRequest == nil, projectNotesExpanded else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await readSelectedSurface()
            guard projectCurrent else { throw CocoaError(.coderReadCorrupt) }
            if !projectNotesEditOptionsCurrent && !projectNotesEditConflict {
                try await readProjectNotesEditOptions()
            }
            if projectNotesEditReadError != nil { return }
            if !projectNotesEditConflict { projectNotesEditError = nil }
            projectNotesEditReadError = nil
        } catch { projectNotesEditReadError = error.localizedDescription }
    }

    func discardProjectNotesDraft() async {
        guard projectNotesCanDiscard else { return }
        projectNotesEditLoaded = false
        projectNotesEditOptionsCurrent = false
        projectNotesEditConflict = false
        projectNotesEditError = nil
        projectNotesEditReadError = nil
        projectNotesDraft = ""
        projectNotesEditBaseRaw = nil
        await retryProjectNotesEditRead()
    }

    func showProjectNotesEditor() async {
        guard projectActionsEnabled, projectNotesExpanded, !projectDetail.flag("readOnly") else { return }
        busy = true
        defer { finishOperation() }
        do {
            try await readProjectNotesEditOptions()
            if projectNotesEditOptionsCurrent && projectNotesEditOptions.flag("canEdit")
                && !projectNotesEditConflict { projectNotesEditMode = true }
        } catch { projectNotesEditReadError = error.localizedDescription }
    }

    func showProjectNotesPreview() async {
        guard await flushProjectNotesEdit(), projectActionsEnabled, projectNotesExpanded else { return }
        projectNotesEditMode = false
        busy = true
        defer { finishOperation() }
        await readProjectNotes()
    }

    func collapseProjectNotesForDetails() async -> Bool {
        guard await flushProjectNotesEdit(), projectActionsEnabled else { return false }
        return true
    }

    func toggleProjectNotes() async {
        guard await flushProjectNotesEdit(), projectActionsEnabled,
              !projectHeader.text("id").isEmpty else { return }
        if projectNotesExpanded {
            projectNotesExpanded = false
            projectNotesEditMode = false
            return
        }
        projectNotesExpanded = true
        projectNotesEditMode = !projectDetail.flag("readOnly")
        busy = true
        defer { finishOperation() }
        if projectNotesEditMode {
            do { try await readProjectNotesEditOptions() }
            catch { projectNotesEditReadError = error.localizedDescription }
        }
        await readProjectNotes()
    }

    func flushProjectNotesEdit() async -> Bool {
        if let task = projectNotesFlushTask { return await task.value }
        if !projectNotesExpanded || !projectNotesEditMode || !projectNotesEditLoaded {
            return projectNotesWriteRequest == nil && !retryNeeded
        }
        guard projectNotesEditReadError == nil, !projectNotesEditConflict,
              projectNotesEditError == nil, projectNotesWriteRequest == nil, !retryNeeded else { return false }
        guard projectNotesDirty else { return true }
        let id = UUID()
        let task = Task { await self.performProjectNotesFlush() }
        projectNotesFlushID = id
        projectNotesFlushTask = task
        let accepted = await task.value
        if projectNotesFlushID == id {
            projectNotesFlushTask = nil
            projectNotesFlushID = nil
        }
        return accepted
    }

    private func performProjectNotesFlush() async -> Bool {
        guard projectActionsEnabled, projectNotesExpanded, projectNotesEditMode,
              projectNotesEditLoaded, !busy else { return false }
        busy = true
        defer { finishOperation() }
        let id = projectHeader.text("id")
        let text = projectNotesDraft
        do {
            if !projectNotesEditOptionsCurrent
                || projectNotesEditOptions.text("revision") != projectDetail.text("mutationRevision") {
                try await readProjectNotesEditOptions()
            }
            guard projectNotesEditOptionsCurrent, !projectNotesEditConflict,
                  projectNotesEditOptions.flag("canEdit"), projectHeader.text("id") == id,
                  projectCurrent, projectNotesDraft == text else { return false }
            let project = projectNotesEditOptions.object("project")
            let expected: CoreObject = ["title": project.text("title"), "status": project.text("status"),
                                        "supportNotes": project["supportNotes"]!, "rev": project["rev"]!,
                                        "revBy": project["revBy"]!, "updatedAt": project.text("updatedAt")]
            let request = try json(["requestId": UUID().uuidString.lowercased(), "projectId": id,
                                    "text": text, "expected": expected])
            projectNotesWriteRequest = request
            projectNotesExpectedRaw = text
            let result = try await query("projectNotesWrite", [request])
            guard try acknowledgeProjectNotesWrite(result) else { return false }
        } catch {
            await handleProjectNotesWriteError(error)
            return false
        }
        do {
            try await readSelectedSurface()
            guard projectCurrent, projectNotesEditReadError == nil else { throw CocoaError(.coderReadCorrupt) }
            return true
        } catch {
            projectNotesEditReadError = error.localizedDescription
            return false
        }
    }

    @discardableResult private func acknowledgeProjectNotesWrite(_ result: CoreObject) throws -> Bool {
        guard projectNotesWriteRequest != nil, let expected = projectNotesExpectedRaw else {
            throw CocoaError(.coderReadCorrupt)
        }
        if result.count == 1 && result["blocked"] as? String == "" {
            projectNotesWriteRequest = nil
            projectNotesExpectedRaw = nil
            projectNotesEditOptionsCurrent = false
            retryNeeded = false
            projectNotesEditError = "Project Notes are no longer editable. Discard the draft to reload."
            return false
        }
        guard result.count == 2, result.text("id") == projectHeader.text("id"),
              result["supportNotes"] as? String == expected else { throw CocoaError(.coderReadCorrupt) }
        projectNotesEditBaseRaw = expected
        projectNotesEditLoaded = true
        projectNotesEditOptionsCurrent = false
        projectNotesWriteRequest = nil
        projectNotesExpectedRaw = nil
        retryNeeded = false
        projectNotesEditError = nil
        projectNotesEditReadError = nil
        error = nil
        return true
    }

    private func handleProjectNotesWriteError(_ failure: Error) async {
        if projectNotesWriteRequest != nil && isDefiniteRejection(failure) {
            projectNotesWriteRequest = nil
            projectNotesExpectedRaw = nil
            projectNotesEditOptionsCurrent = false
            retryNeeded = false
            projectNotesEditError = failure.localizedDescription
            do {
                try await readSelectedSurface()
            } catch { projectNotesEditReadError = error.localizedDescription }
        } else {
            retryNeeded = projectNotesWriteRequest != nil
            projectNotesEditError = failure.localizedDescription
            error = failure.localizedDescription
        }
    }

    func loadMoreProjectNotes() async {
        guard projectActionsEnabled, projectNotesExpanded, projectNotesCurrent,
              projectNotes.objects("blocks").count < projectNotes.number("total") else { return }
        busy = true
        defer { finishOperation() }
        let offset = projectNotes.objects("blocks").count
        let limit = min(pageSize, projectNotes.number("total") - offset)
        projectNotesLoadedDepth = offset + limit
        projectNotesCurrent = false
        do {
            let window = try await query("projectNotes", [projectHeader.text("id"), offset, limit, projectNotes.text("revision")])
            try validateProjectNotesWindow(window, against: projectNotes, count: limit)
            guard projectCurrent, projectHeader.text("id") == window.text("projectId"),
                  projectDetail.text("mutationRevision") == window.text("revision") else {
                throw CocoaError(.coderReadCorrupt)
            }
            projectNotes["blocks"] = projectNotes.objects("blocks") + window.objects("blocks")
            projectNotesCurrent = true
            projectNotesError = nil
        } catch { projectNotesError = error.localizedDescription }
    }

    func retryProjectNotes() async {
        guard projectActionsEnabled, projectNotesExpanded else { return }
        busy = true
        defer { finishOperation() }
        await readProjectNotes()
    }

    private func readProjectNotes() async {
        projectNotesCurrent = false
        projectNotesError = nil
        let id = projectHeader.text("id")
        for attempt in 0..<2 {
            do {
                guard projectCurrent, projectDetail.text("projectId") == id,
                      !projectDetail.text("mutationRevision").isEmpty else { throw CocoaError(.coderReadCorrupt) }
                var next = try await query("projectNotes", [id, 0, pageSize, ""])
                guard next.text("projectId") == id, !next.text("revision").isEmpty,
                      let total = next["total"] as? Int, total >= 0,
                      let firstBlocks = next["blocks"] as? [CoreObject],
                      firstBlocks.count == min(pageSize, total),
                      let readOnly = next["readOnly"] as? NSNumber,
                      CFGetTypeID(readOnly) == CFBooleanGetTypeID(),
                      readOnly.boolValue == projectDetail.flag("readOnly"),
                      ["ltr", "rtl"].contains(next.text("direction")),
                      validProjectNotesLabels(next.object("markdownLabels")) else {
                    throw CocoaError(.coderReadCorrupt)
                }
                if next.text("revision") != projectDetail.text("mutationRevision") {
                    if attempt == 0 {
                        await readProjectDetail()
                        continue
                    }
                    throw CocoaError(.coderReadCorrupt)
                }
                var blocks = next.objects("blocks")
                let target = min(projectNotesLoadedDepth, next.number("total"))
                while blocks.count < target {
                    let limit = min(pageSize, target - blocks.count)
                    let window = try await query("projectNotes", [id, blocks.count, limit, next.text("revision")])
                    try validateProjectNotesWindow(window, against: next, count: limit)
                    blocks += window.objects("blocks")
                }
                guard projectCurrent, projectHeader.text("id") == id,
                      projectDetail.text("mutationRevision") == next.text("revision") else {
                    throw CocoaError(.coderReadCorrupt)
                }
                next["blocks"] = blocks
                projectNotes = next
                projectNotesCurrent = true
                return
            } catch { projectNotesError = error.localizedDescription; return }
        }
    }

    private func validProjectNotesLabels(_ labels: CoreObject) -> Bool {
        labels.count == 3 && ["deletedTask", "deletedProject", "copyCode"].allSatisfy { labels[$0] is String }
    }

    private func validateProjectNotesWindow(_ window: CoreObject, against snapshot: CoreObject, count: Int) throws {
        guard window.text("projectId") == snapshot.text("projectId"),
              window.text("revision") == snapshot.text("revision"),
              window.number("total") == snapshot.number("total"),
              let readOnly = window["readOnly"] as? NSNumber,
              CFGetTypeID(readOnly) == CFBooleanGetTypeID(),
              readOnly.boolValue == snapshot.flag("readOnly"),
              window.text("direction") == snapshot.text("direction"),
              validProjectNotesLabels(window.object("markdownLabels")),
              ["deletedTask", "deletedProject", "copyCode"].allSatisfy({
                  window.object("markdownLabels").text($0) == snapshot.object("markdownLabels").text($0)
              }),
              window.objects("blocks").count == count else { throw CocoaError(.coderReadCorrupt) }
    }

    func openSearch() {
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented,
              !calendarComposerPresented, !mindSweepPresented, selectedSurface != .search else { return }
        searchCaller = selectedSurface
        morePresented = false
        selectedSurface = .search
        searchQuery = ""
        searchFilters = [:]
        searchView = [:]
        requestSearch(delay: 0)
    }

    func closeSearch() async {
        guard selectedSurface == .search, !busy, !retryNeeded, !taskPresented else { return }
        selectedSurface = searchCaller
        invalidateSearch()
        searchLoading = false
        searchNeedsRead = false
        searchError = nil
        await refresh()
    }

    func setSearchQuery(_ text: String) {
        guard selectedSurface == .search, !retryNeeded, !taskPresented, text != searchQuery else { return }
        searchQuery = text
        requestSearch()
    }

    func setSearchFilters(_ filters: CoreObject) {
        guard selectedSurface == .search, !busy, !retryNeeded, !taskPresented, !filters.isEmpty else { return }
        searchFilters = filters
        requestSearch()
    }

    func removeSearchChip(_ key: String) {
        guard searchActionsEnabled,
              let chip = searchView.objects("activeChips").first(where: { $0.text("key") == key }) else { return }
        setSearchFilters(chip.object("clearedFilters"))
    }

    func retrySearch() {
        guard selectedSurface == .search, !busy, !retryNeeded, !taskPresented else { return }
        requestSearch(delay: 0)
    }

    func openSearchTask(_ id: String) async {
        guard searchActionsEnabled,
              let row = searchView.objects("tasks").first(where: { $0.text("id") == id }),
              row.flag("inStore"), row.object("tap").text("kind") == "editor" else { return }
        invalidateSearch()
        await openTask(row.object("tap").text("id"))
    }

    func completeSearchTask(_ id: String) async {
        guard searchActionsEnabled,
              let row = searchView.objects("tasks").first(where: { $0.text("id") == id }),
              row.flag("canComplete"), !row.flag("readOnly") else { return }
        invalidateSearch()
        error = nil
        await complete(id)
    }

    private func invalidateSearch() {
        searchGeneration += 1
        searchTask?.cancel()
        searchNeedsRead = true
        searchLoading = selectedSurface == .search
    }

    private func requestSearch(delay: UInt64 = 200_000_000) {
        invalidateSearch()
        searchError = nil
        scheduleSearch(delay: delay)
    }

    private func scheduleSearch(delay: UInt64 = 200_000_000) {
        guard ready, selectedSurface == .search, !busy, !retryNeeded, !taskPresented else { return }
        let generation = searchGeneration
        searchTask = Task {
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard !Task.isCancelled, generation == searchGeneration, !busy, !retryNeeded, !taskPresented,
                  selectedSurface == .search else { return }
            await readSearch(generation: generation, ownsOperation: false)
        }
    }

    private func readSearch(generation: Int, ownsOperation: Bool) async {
        let text = searchQuery
        let filters = searchFilters
        do {
            let value = try await query("search", [try json([
                "query": text, "filters": filters.isEmpty ? NSNull() : filters as Any, "limit": 100])])
            guard generation == searchGeneration, selectedSurface == .search, !retryNeeded, !taskPresented,
                  ownsOperation || !busy else { return }
            // Empty input gets its entire default filter object from core. Never
            // synthesize defaults or copy an older response over newer input.
            if searchFilters.isEmpty { searchFilters = value.object("defaultFilters") }
            searchView = value
            publishedSearchGeneration = generation
            searchNeedsRead = false
            searchLoading = false
            searchError = nil
        } catch {
            guard generation == searchGeneration, selectedSurface == .search, !retryNeeded, !taskPresented,
                  ownsOperation || !busy else { return }
            searchNeedsRead = false
            searchLoading = false
            searchError = error.localizedDescription
        }
    }

    func openAreaPicker() async {
        guard ready, !busy, !retryNeeded, !capturePresented, !taskPresented,
              !projectRenameEditing,
              !calendarComposerPresented, !mindSweepPresented else { return }
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        busy = true
        defer { finishOperation() }
        do {
            area = try await query("areaFilter")
            areaPickerPresented = true
        } catch { self.error = error.localizedDescription }
    }

    func closeAreaPicker() {
        guard !busy, !retryNeeded else { return }
        areaPickerPresented = false
        if selectedSurface == .board && boardNeedsRead { scheduleBoardRead(delay: 0) }
        if selectedSurface == .contexts && !contextsCurrent { requestContextsRead(delay: 0) }
        if selectedSurface == .focus && !focusCurrent { requestFocusRead(delay: 0) }
    }

    func selectArea(_ next: CoreObject) async {
        guard ready, areaPickerPresented, !busy, !retryNeeded else { return }
        busy = true
        error = nil
        defer { finishOperation() }
        do {
            // This is core's final selection, never a native toggle/cycle.
            // The host journals it unchanged for exact recovery.
            _ = try await query("setAreaFilter", [try json(next)])
        } catch {
            retryNeeded = !isDefiniteRejection(error)
            self.error = error.localizedDescription
            return
        }
        do { try await readSelectedSurface() } catch { self.error = error.localizedDescription }
    }

    func loadMore() async {
        guard ready, selectedSurface == .inbox, !busy, !retryNeeded, items.count < inbox.number("total") else { return }
        busy = true
        defer { finishOperation() }
        do {
            let next = try await query("inboxView", [try json([
                "offset": items.count, "limit": pageSize, "revision": inbox.text("revision")])])
            guard next.text("revision") == inbox.text("revision") else { try await readInbox(); return }
            inbox["items"] = items + next.objects("items")
        } catch {
            // A minute or data revision can expire between windows. Restart the query, never mix revisions.
            do { try await readInbox() } catch { self.error = error.localizedDescription }
        }
    }

    func loadMoreFocus(_ key: String) async {
        guard focusActionsEnabled, let section = focus.objects("sections").first(where: { $0.text("key") == key }),
              section.objects("rows").count < section.number("rowTotal") else { return }
        focusLoadedDepth[key] = section.objects("rows").count + pageSize
        requestFocusRead(delay: 0)
    }

    private func visibleDescriptionReference(_ sourceID: String?, kind: String, id: String) -> Bool {
        guard let sourceID else { return false }
        let rows: [CoreObject]
        switch selectedSurface {
        case .focus where focusShowDetails:
            rows = focus.objects("sections").flatMap { $0.objects("rows") }
        case .waiting where waiting.flag("showDetails"):
            rows = waiting.objects("rows")
        case .someday where someday.flag("showDetails"):
            rows = someday.objects("items").filter { $0.text("type") == "task" }.map { $0.object("row") }
        default: return false
        }
        return rows.contains { row in
            row.text("id").utf8.elementsEqual(sourceID.utf8)
                && row.object("meta").object("description").objects("inline").contains { run in
                    run.text("type") == "link" && run.object("target").text("kind") == kind
                        && run.object("target").text("id").utf8.elementsEqual(id.utf8)
                }
        }
    }

    func openTask(_ id: String, descriptionSourceID: String? = nil) async {
        if selectedSurface == .project { guard await flushProjectNotesEdit() else { return } }
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented,
              !projectRenameEditing, selectedSurface != .trash else { return }
        if selectedSurface == .review {
            guard reviewActionsEnabled, reviewTaskIDs.contains(id) else { return }
        }
        if selectedSurface == .board {
            guard boardActionsEnabled, boardView.objects("columns").contains(where: {
                $0.objects("cards").contains(where: { $0.object("row").text("id") == id })
            }) else { return }
        }
        if selectedSurface == .calendar { guard calendarActionsEnabled, calendarEditableTask(id) else { return } }
        if selectedSurface == .focus {
            guard focusActionsEnabled, visibleDescriptionReference(descriptionSourceID, kind: "task", id: id)
                || focus.objects("sections").contains(where: {
                $0.objects("rows").contains(where: { $0.text("id") == id })
            }) else { return }
        }
        if selectedSurface == .contexts {
            guard contextsActionsEnabled, contexts.objects("rows").contains(where: { $0.text("id") == id }) else { return }
        }
        if selectedSurface == .history {
            guard historyActionsEnabled, history.objects("items").contains(where: {
                $0.text("type") == "task" && $0.object("row").text("id") == id
            }) else { return }
        }
        if selectedSurface == .reference {
            guard referenceActionsEnabled, reference.objects("items").contains(where: {
                $0.text("type") == "task" && $0.object("row").text("id") == id
            }) else { return }
        }
        if selectedSurface == .someday {
            guard somedayActionsEnabled, visibleDescriptionReference(descriptionSourceID, kind: "task", id: id)
                || someday.objects("items").contains(where: {
                $0.text("type") == "task" && $0.object("row").text("id") == id
            }) else { return }
        }
        if selectedSurface == .waiting {
            guard waitingActionsEnabled, visibleDescriptionReference(descriptionSourceID, kind: "task", id: id)
                || waiting.objects("rows").contains(where: { $0.text("id") == id }) else { return }
        }
        if selectedSurface == .project {
            guard projectActionsEnabled, projectDetail.objects("items").contains(where: {
                $0.text("type") == "task" && $0.object("row").text("id") == id
            }) else { return }
        }
        prepareTaskPresentation(id)
        await readTaskView()
    }

    private func prepareTaskPresentation(_ id: String, initialTab: String = "view") {
        resetTaskDestination()
        resetTaskTokens()
        resetTaskSchedule()
        resetTaskChecklistState()
        viewedTaskID = id
        taskInitialTab = initialTab
        taskView = [:]
        taskEditor = [:]
        taskOriginalDraft = [:]
        taskTitleDraft = ""
        taskNoteDraft = ""
        taskEstimateInput = ""
        taskEstimateResolvedInput = ""
        taskError = nil
        taskPresented = true
    }

    func closeTask() {
        guard !busy, !retryNeeded, !taskSavePending, taskChecklistWriteKind == nil,
              !taskChecklistReadPending, !taskScheduleUpdating else { return }
        guard !taskDirty else { return }
        dismissTask()
    }

    func discardTask() {
        guard !busy, !retryNeeded, !taskSavePending, taskChecklistWriteKind == nil,
              !taskChecklistReadPending, !taskScheduleUpdating else { return }
        dismissTask()
    }

    private func dismissTask() {
        resetTaskDestination()
        resetTaskTokens()
        resetTaskSchedule()
        resetTaskChecklistState()
        taskPresented = false
        viewedTaskID = ""
        // Reset can commit while the editor stays open; Close and Discard must
        // also refresh the caller, including its status membership and counts.
        Task { await refresh() }
    }

    private func resetTaskChecklistState() {
        taskChecklistSession += 1
        taskChecklistLoaded = false
        taskChecklist = []
        taskOriginalChecklist = []
        taskChecklistField = [:]
        taskChecklistInputs = [:]
        taskChecklistAppendInput = ""
        taskChecklistFocusIndex = nil
        taskChecklistWriteKind = nil
        taskChecklistWriteRequest = nil
        taskChecklistResetAcknowledgment = nil
        taskChecklistReadPending = false
    }

    func setTaskChecklistInput(_ index: Int, text: String) {
        guard taskPresented, taskChecklistLoaded, !busy, !retryNeeded, !taskSavePending,
              taskChecklistWriteKind == nil, !taskChecklistReadPending,
              index >= 0, index < taskChecklist.count else { return }
        if text == taskChecklist[index].text("title") { taskChecklistInputs.removeValue(forKey: index) }
        else { taskChecklistInputs[index] = text }
    }

    private func applyTaskChecklistEdit(_ edit: CoreObject?, id: String, session: Int) async throws -> Bool {
        guard taskPresented, viewedTaskID == id, taskChecklistSession == session else { throw CancellationError() }
        var input: CoreObject = ["id": id, "draft": taskDraft, "checklist": taskChecklist]
        if let edit { input["edit"] = edit }
        let result = try await query("checklistEdit", [try json(input)])
        guard taskPresented, viewedTaskID == id, taskChecklistSession == session else { throw CancellationError() }
        guard !result.object("draft").isEmpty, result["checklist"] is [CoreObject],
              !result.object("field").isEmpty else { throw CocoaError(.coderReadCorrupt) }
        let editor = try await query("editDraft", [try json([
            "id": id, "draft": result.object("draft"), "checklist": result.objects("checklist")])])
        guard taskPresented, viewedTaskID == id, taskChecklistSession == session else { throw CancellationError() }
        taskEditor = editor
        taskChecklist = result.objects("checklist")
        taskChecklistField = result.object("field")
        if let focusID = result["focusId"] as? String {
            taskChecklistFocusIndex = taskChecklist.firstIndex { $0.text("id") == focusID }
        } else { taskChecklistFocusIndex = nil }
        return result.flag("changed")
    }

    private func flushTaskChecklistInputs(id: String, session: Int, append: Bool = true) async throws {
        // Reverse order keeps global indexes stable when a pasted multiline title
        // inserts rows after its source item.
        for _ in 0..<8 {
            for index in taskChecklistInputs.keys.sorted(by: >) {
                guard let text = taskChecklistInputs[index] else { continue }
                guard index < taskChecklist.count else { throw CocoaError(.coderReadCorrupt) }
                _ = try await applyTaskChecklistEdit(["kind": "rename", "index": index, "text": text], id: id, session: session)
                if taskChecklistInputs[index] == text { taskChecklistInputs.removeValue(forKey: index) }
            }
            if append, !taskChecklistAppendInput.isEmpty {
                let title = taskChecklistAppendInput
                _ = try await applyTaskChecklistEdit(["kind": "append", "title": title], id: id, session: session)
                if taskChecklistAppendInput == title { taskChecklistAppendInput = "" }
            }
            if taskChecklistInputs.isEmpty && (!append || taskChecklistAppendInput.isEmpty) { return }
        }
        throw CocoaError(.coderReadCorrupt)
    }

    func editTaskChecklist(_ edit: CoreObject, refreshPreview: Bool = false) async {
        guard taskPresented, taskChecklistLoaded, !taskEditor.flag("readOnly"), !busy, !retryNeeded,
              taskChecklistWriteKind == nil, !taskChecklistReadPending else { return }
        let id = viewedTaskID
        let session = taskChecklistSession
        busy = true
        taskError = nil
        defer { finishOperation() }
        do {
            try await flushTaskChecklistInputs(id: id, session: session, append: edit.text("kind") != "append")
            _ = try await applyTaskChecklistEdit(edit, id: id, session: session)
            if edit.text("kind") == "append", taskChecklistAppendInput == edit.text("title") {
                taskChecklistAppendInput = ""
            }
            if refreshPreview { Task { await readTaskView() } }
        } catch {
            if taskPresented, viewedTaskID == id, taskChecklistSession == session {
                taskError = error.localizedDescription
            }
        }
    }

    func appendTaskChecklist() async {
        let title = taskChecklistAppendInput
        guard !title.isEmpty else { return }
        await editTaskChecklist(["kind": "append", "title": title], refreshPreview: true)
    }

    private func validTaskChecklistResetResult(_ result: CoreObject, id: String) -> Bool {
        result.text("id") == id && result["checklistBase"] is [CoreObject]
            && (result["status"] as? String)?.isEmpty == false
            && (result["completedAt"] is String || result["completedAt"] is NSNull)
            && result["isFocusedToday"] is Bool
    }

    private func acceptTaskChecklistReset(_ result: CoreObject, id: String, session: Int) async throws {
        guard taskPresented, viewedTaskID == id, taskChecklistSession == session,
              validTaskChecklistResetResult(result, id: id),
              let savedStatus = result["status"] as? String,
              let focusedToday = result["isFocusedToday"] as? Bool else {
            throw CocoaError(.coderReadCorrupt)
        }
        let completedAt: String
        if let storedDate = result["completedAt"] as? String { completedAt = storedDate }
        else if result["completedAt"] is NSNull { completedAt = "" }
        else { throw CocoaError(.coderReadCorrupt) }
        if taskChecklistResetAcknowledgment == nil {
            let originalStatus = taskOriginalDraft.text("status")
            var original = taskOriginalDraft
            original["status"] = savedStatus
            original["completedAt"] = completedAt
            original["focusedToday"] = focusedToday
            taskOriginalDraft = original
            taskOriginalChecklist = result.objects("checklistBase")
            if taskDraft.text("status") == originalStatus {
                var editor = taskEditor
                var draft = editor.object("draft")
                draft["status"] = savedStatus
                draft["completedAt"] = completedAt
                draft["focusedToday"] = focusedToday
                editor["draft"] = draft
                taskEditor = editor
            }
            taskChecklistResetAcknowledgment = result
        }
        taskChecklistReadPending = true
        _ = try await applyTaskChecklistEdit(["kind": "uncheckAll"], id: id, session: session)
        taskChecklistReadPending = false
        taskChecklistResetAcknowledgment = nil
        taskError = nil
        Task { await readTaskView() }
    }

    func resetTaskChecklist() async {
        guard taskPresented, taskChecklistLoaded, !taskEditor.flag("readOnly"), !busy, !retryNeeded,
              taskChecklistWriteKind == nil, !taskChecklistReadPending else { return }
        let id = viewedTaskID
        let session = taskChecklistSession
        busy = true
        taskError = nil
        defer { finishOperation() }
        do {
            try await resolveTaskEditorInputs()
            try await flushTaskChecklistInputs(id: id, session: session)
            let request: CoreObject = ["id": id, "requestId": UUID().uuidString.lowercased(),
                                       "checklistBase": taskOriginalChecklist]
            let payload = try json(request)
            taskChecklistWriteRequest = payload
            taskChecklistWriteKind = "reset"
            let result = try await query("checklistReset", [payload])
            guard validTaskChecklistResetResult(result, id: id) else {
                throw CocoaError(.coderReadCorrupt)
            }
            taskChecklistWriteKind = nil
            taskChecklistWriteRequest = nil
            retryNeeded = false
            try await acceptTaskChecklistReset(result, id: id, session: session)
        } catch {
            if isDefiniteRejection(error) {
                taskChecklistWriteKind = nil
                taskChecklistWriteRequest = nil
            }
            retryNeeded = taskChecklistWriteKind != nil
            taskError = error.localizedDescription
        }
    }

    func retryTaskChecklistRead() async {
        guard !busy, taskChecklistReadPending, let result = taskChecklistResetAcknowledgment else { return }
        busy = true
        defer { finishOperation() }
        do { try await acceptTaskChecklistReset(result, id: viewedTaskID, session: taskChecklistSession) }
        catch { taskError = error.localizedDescription }
    }

    func saveTask() async {
        guard taskPresented, !taskEditor.isEmpty, !taskEditor.flag("readOnly"), !busy, !retryNeeded,
              taskChecklistWriteKind == nil, !taskChecklistReadPending else { return }
        guard taskDirty else { dismissTask(); return }
        let id = viewedTaskID
        let session = taskChecklistSession
        busy = true
        taskError = nil
        defer { finishOperation() }
        do {
            try await resolveTaskEditorInputs()
            try await flushTaskChecklistInputs(id: id, session: session)
            guard !taskEditor.flag("readOnly") else { return }
            var base: CoreObject = [:]
            var patch: CoreObject = [:]
            let current = taskDraft
            for field in taskSaveFields {
                let original = taskOriginalDraft.text(field)
                let edited = current.text(field)
                if edited != original { base[field] = original; patch[field] = edited }
            }
            let associationFields = ["projectId", "areaId", "sectionId"]
            if associationFields.contains(where: { current.text($0) != taskOriginalDraft.text($0) }) {
                // A move can clear companion associations. Compare the complete
                // original tuple so a concurrent section/area edit is not erased.
                for field in associationFields {
                    base[field] = taskOriginalDraft.text(field)
                    patch[field] = current.text(field)
                }
            }
            if !taskDraftValuesEqual(current["relativeStartOffset"], taskOriginalDraft["relativeStartOffset"]) {
                base["relativeStartOffset"] = taskOriginalDraft["relativeStartOffset"] ?? NSNull()
                patch["relativeStartOffset"] = current["relativeStartOffset"] ?? NSNull()
            }
            let recurrenceChanged = taskRecurrenceFields.contains { !taskDraftValuesEqual(current[$0], taskOriginalDraft[$0]) }
            if recurrenceChanged {
                for field in taskRecurrenceFields {
                    base[field] = taskOriginalDraft[field]
                    patch[field] = current[field]
                }
            }
            let statusChanged = !taskDraftValuesEqual(current["status"], taskOriginalDraft["status"])
            if statusChanged {
                base["status"] = taskOriginalDraft.text("status")
                patch["status"] = current.text("status")
            }
            let checklistChanged = !taskDraftValuesEqual(taskChecklist, taskOriginalChecklist)
            let checklistSave = checklistChanged || statusChanged
            guard !patch.isEmpty || checklistSave else { dismissTask(); return }
            var request: CoreObject = ["id": viewedTaskID, "base": base, "patch": patch]
            if checklistSave || recurrenceChanged || (taskDateFields + ["relativeStartOffset"]).contains(where: { patch[$0] != nil }) {
                guard !taskOriginalSchedule.isEmpty else { throw CocoaError(.coderReadCorrupt) }
                request["scheduleBase"] = taskOriginalSchedule
            }
            if recurrenceChanged {
                guard !taskOriginalRecurrence.isEmpty else { throw CocoaError(.coderReadCorrupt) }
                request["recurrenceBase"] = taskOriginalRecurrence
            }
            if checklistSave {
                request["checklist"] = ["base": taskOriginalChecklist, "value": taskChecklist]
                request["requestId"] = UUID().uuidString.lowercased()
            }
            let payload = try json(request)
            if checklistSave {
                taskChecklistWriteKind = "save"
                taskChecklistWriteRequest = payload
                let result = try await query("checklistSave", [payload])
                guard result.text("id") == id else { throw CocoaError(.coderReadCorrupt) }
                taskChecklistWriteKind = nil
                taskChecklistWriteRequest = nil
            } else {
                taskSavePending = true
                _ = try await query("saveDraft", [payload])
                taskSavePending = false
            }
        } catch {
            if isDefiniteRejection(error) {
                taskSavePending = false
                taskChecklistWriteKind = nil
                taskChecklistWriteRequest = nil
            }
            retryNeeded = taskSavePending || taskChecklistWriteKind != nil
            taskError = error.localizedDescription
            return
        }
        dismissTask()
        do { try await readSelectedSurface() } catch { self.error = error.localizedDescription }
    }

    func editTaskMetadata(_ field: String, value: String) async {
        guard taskPresented, !taskEditor.isEmpty, !taskEditor.flag("readOnly"), !busy, !retryNeeded,
              ["priority", "energyLevel", "timeEstimate"].contains(field),
              taskEditor.object("layout").objects("sections").contains(where: {
                  ($0["fields"] as? [String] ?? []).contains(field)
              }) else { return }
        busy = true
        taskError = nil
        defer { finishOperation() }
        do {
            // Switching an estimate preset replaces its text buffer; other
            // controls first resolve it through core into the complete draft.
            try await resolveTaskEditorInputs(estimate: field != "timeEstimate")
            guard !taskEditor.flag("readOnly") else { return }
            let editor = try await query("editDraft", [try json(taskEditRequest(
                ["type": "fields", "patch": [field: value]]))])
            taskEditor = editor
            resetTaskEstimateInput()
            try await refreshTaskDestination()
        } catch { taskError = error.localizedDescription }
    }

    func commitTaskEstimateInput() async {
        guard taskPresented, !taskEditor.isEmpty, !taskEditor.flag("readOnly"), !busy, !retryNeeded, taskEstimatePending else { return }
        busy = true
        taskError = nil
        defer { finishOperation() }
        do {
            try await resolveTaskEditorInputs()
            try await refreshTaskDestination()
        } catch { taskError = error.localizedDescription }
    }

    private func resolveTaskEstimateInput() async throws {
        guard taskEstimatePending else { return }
        let id = viewedTaskID
        let session = taskScheduleSession
        let editor = try await query("editDraft", [try json(taskEditRequest(
            ["type": "timeEstimate", "text": taskEstimateInput]))])
        guard taskPresented, viewedTaskID == id, taskScheduleSession == session else { throw CancellationError() }
        taskEditor = editor
        resetTaskEstimateInput()
    }

    private func resetTaskEstimateInput() {
        taskEstimateInput = taskEditor.object("fields").object("timeEstimate").text("customText")
        taskEstimateResolvedInput = taskEstimateInput
    }

    private func taskDraftValuesEqual(_ lhs: Any?, _ rhs: Any?) -> Bool {
        (try? json(["value": lhs ?? NSNull()])) == (try? json(["value": rhs ?? NSNull()]))
    }

    private func resetTaskSchedule() {
        taskScheduleSession += 1
        taskScheduleTask?.cancel()
        taskScheduleTask = nil
        taskScheduleEdits = []
        taskScheduleFailure = nil
        taskScheduleFailedID = nil
        taskScheduleUpdating = false
        taskSchedulePending = false
        taskRelativeAmountInput = ""
        taskRelativeUnitInput = ""
        taskRelativeInputOwned = false
        taskRelativeInputCommitRequested = false
        taskOriginalSchedule = [:]
        taskOriginalRecurrence = [:]
        taskRecurrenceInputs = [:]
        taskRecurrenceInputOwned = []
        taskRecurrenceInputCommitRequested = []
    }

    private func taskDateFieldAvailable(_ field: String) -> Bool {
        taskPresented && !taskEditor.isEmpty && !taskEditor.flag("readOnly") && !retryNeeded && !taskSavePending
            && taskDateFields.contains(field) && taskEditor.object("layout").objects("sections").contains {
                ($0["fields"] as? [String] ?? []).contains(field)
            }
    }

    private func synchronizeTaskRelativeInput() {
        guard !taskScheduleEdits.contains(where: { $0.control == "relativeStart" }) else { return }
        let relative = taskEditor.object("fields").object("relativeStart")
        // A completed blank edit normalizes to zero in core. Feeding that reply
        // into a focused UITextField can replace the next digit being entered.
        // Keep raw text until an explicit blur/action AND the relative queue drain.
        if !taskRelativeInputOwned || taskRelativeInputCommitRequested {
            let resolvedInput = taskRelativeInputOwned && taskRelativeInputCommitRequested
            taskRelativeAmountInput = relative.isEmpty ? "" : String(relative.number("amount"))
            taskRelativeInputOwned = false
            taskRelativeInputCommitRequested = false
            if resolvedInput {
                NSLog("Native iOS relative input resolved releaseCheck=v1.3.3/native-ios-relative-input")
            }
        }
        taskRelativeUnitInput = relative.text("unit")
    }

    func beginTaskRelativeInput() {
        guard taskDateFieldAvailable("startTime") else { return }
        taskRelativeInputOwned = true
        taskRelativeInputCommitRequested = false
    }

    func commitTaskRelativeInput() {
        guard taskRelativeInputOwned else { return }
        taskRelativeInputCommitRequested = true
        synchronizeTaskRelativeInput()
    }

    func setTaskRelativeAmount(_ text: String) {
        guard taskDateFieldAvailable("startTime"), taskRelativeAmountInput != text else { return }
        // Claim ownership in the binding setter itself; FocusState onChange may
        // arrive after this callback. No core reply may win that opening gap.
        beginTaskRelativeInput()
        taskRelativeAmountInput = text
        enqueueTaskScheduleEdit("relativeStart", edit: ["type": "relativeStart", "amount": text, "unit": taskRelativeUnitInput])
    }

    func setTaskRelativeUnit(_ unit: String) {
        guard taskDateFieldAvailable("startTime"), !busy,
              taskEditor.object("fields").object("relativeStart").objects("units").contains(where: { $0.text("unit") == unit }) else { return }
        taskRelativeUnitInput = unit
        enqueueTaskScheduleEdit("relativeStart", edit: ["type": "relativeStart", "amount": taskRelativeAmountInput, "unit": unit])
    }

    func setTaskRelativeMode(_ relative: Bool) {
        guard taskDateFieldAvailable("startTime"), !busy,
              !taskEditor.object("fields").object("relativeStart").isEmpty else { return }
        let edit: CoreObject = relative
            ? ["type": "relativeStart", "amount": taskRelativeAmountInput, "unit": taskRelativeUnitInput]
            : ["type": "fields", "patch": ["relativeStartOffset": NSNull()]]
        enqueueTaskScheduleEdit("relativeStart", edit: edit)
    }

    func setTaskPickedDate(_ field: String, mode: String, value: String) {
        guard taskDateFieldAvailable(field), ["date", "time"].contains(mode), mode != "time" || field != "reviewAt" else { return }
        enqueueTaskScheduleEdit(field + ":" + mode,
            edit: ["type": mode == "date" ? "pickDate" : "pickTime", "field": field, mode: value])
    }

    private var taskRecurrenceAvailable: Bool {
        taskPresented && !taskEditor.isEmpty && !taskEditor.flag("readOnly") && !retryNeeded && !taskSavePending
            && taskEditor.object("layout").objects("sections").contains {
                ($0["fields"] as? [String] ?? []).contains("recurrence")
            }
    }

    private func synchronizeTaskRecurrenceInputs() {
        let recurrence = taskEditor.object("fields").object("recurrence")
        for field in ["interval", "count"] {
            guard !taskScheduleEdits.contains(where: { $0.control == "recurrence:" + field }) else { continue }
            if !taskRecurrenceInputOwned.contains(field) || taskRecurrenceInputCommitRequested.contains(field) {
                taskRecurrenceInputs[field] = String(recurrence.number(field))
                taskRecurrenceInputOwned.remove(field)
                taskRecurrenceInputCommitRequested.remove(field)
            }
        }
    }

    func beginTaskRecurrenceInput(_ field: String) {
        guard taskRecurrenceAvailable, ["interval", "count"].contains(field) else { return }
        taskRecurrenceInputOwned.insert(field)
        taskRecurrenceInputCommitRequested.remove(field)
    }

    func commitTaskRecurrenceInputs() {
        taskRecurrenceInputCommitRequested.formUnion(taskRecurrenceInputOwned)
        synchronizeTaskRecurrenceInputs()
    }

    func setTaskRecurrenceInput(_ field: String, text: String) {
        guard taskRecurrenceAvailable, ["interval", "count"].contains(field), taskRecurrenceInputs[field] != text else { return }
        beginTaskRecurrenceInput(field)
        taskRecurrenceInputs[field] = text
        enqueueTaskScheduleEdit("recurrence:" + field,
            edit: ["type": "recurrence", "edit": ["kind": field, "text": text]])
    }

    func editTaskRecurrence(_ edit: CoreObject) {
        guard taskRecurrenceAvailable, !busy else { return }
        enqueueTaskScheduleEdit("recurrence:" + edit.text("kind"),
            edit: ["type": "recurrence", "edit": edit], coalesces: false)
    }

    func toggleTaskFutureRecurrence() {
        guard taskRecurrenceAvailable, !busy else { return }
        enqueueTaskScheduleEdit("recurrence:showFuture", edit: ["type": "toggleFutureRecurrence"], coalesces: false)
    }

    func setTaskRecurrenceUntil(_ date: String) {
        guard taskRecurrenceAvailable else { return }
        enqueueTaskScheduleEdit("recurrence:until", edit: ["type": "recurrence", "edit": ["kind": "until", "date": date]])
    }

    func applyTaskMonthlyCustom(_ custom: CoreObject, intervalText: String) async -> Bool {
        guard taskRecurrenceAvailable, !busy else { return false }
        enqueueTaskScheduleEdit("recurrence:monthlyCustom",
            edit: ["type": "monthlyCustom", "custom": custom, "intervalText": intervalText])
        return await prepareTaskDatePicker()
    }

    func cancelTaskMonthlyCustom() {
        guard !busy, !taskScheduleUpdating else { return }
        if let failed = taskScheduleFailedID,
           taskScheduleEdits.contains(where: { $0.id == failed && $0.control == "recurrence:monthlyCustom" }) {
            taskScheduleEdits.removeAll { $0.id == failed }
            taskScheduleFailedID = nil
            taskScheduleFailure = nil
            taskSchedulePending = !taskScheduleEdits.isEmpty
            taskError = nil
        }
    }

    private func enqueueTaskScheduleEdit(_ control: String, edit: CoreObject, coalesces: Bool = true) {
        taskScheduleSequence += 1
        let next = TaskScheduleEdit(id: taskScheduleSequence, control: control, edit: edit, coalesces: coalesces)
        // Correcting a refused control removes that refused edit without moving
        // the correction ahead of any intervening, dependent control's edit.
        if coalesces, let failed = taskScheduleFailedID,
           taskScheduleEdits.contains(where: { $0.id == failed && $0.control == control && $0.coalesces }) {
            taskScheduleEdits.removeAll { $0.id == failed }
            taskScheduleFailure = nil
            taskScheduleFailedID = nil
        }
        // Only consecutive edits from the same control can replace each other.
        if coalesces, taskScheduleEdits.last?.coalesces == true, taskScheduleEdits.last?.control == control {
            taskScheduleEdits[taskScheduleEdits.count - 1] = next
        }
        else { taskScheduleEdits.append(next) }
        taskSchedulePending = true
        if taskScheduleFailure == nil { taskError = nil }
        if !busy { startTaskSchedulePump() }
    }

    private func startTaskSchedulePump() {
        guard taskScheduleTask == nil, !taskScheduleEdits.isEmpty, taskScheduleFailure == nil,
              taskPresented, !taskEditor.flag("readOnly"), !retryNeeded else { return }
        let session = taskScheduleSession
        let id = viewedTaskID
        taskScheduleUpdating = true
        taskScheduleTask = Task {
            defer {
                if taskScheduleSession == session {
                    taskScheduleTask = nil
                    taskScheduleUpdating = false
                    taskSchedulePending = !taskScheduleEdits.isEmpty
                    if !busy && !retryNeeded {
                        for field in taskTokenFields where taskTokenNeedsRead.contains(field) { requestTaskTokenRead(field, delay: 0) }
                    }
                }
            }
            while let operation = taskScheduleEdits.first {
                do {
                    try await resolveTaskEstimateInput()
                    try await resolveTaskTokenInputs()
                    guard taskPresented, taskScheduleSession == session, viewedTaskID == id else { return }
                    let edit = try await taskScheduleCommand(operation.edit)
                    guard taskPresented, taskScheduleSession == session, viewedTaskID == id else { return }
                    let editor = try await query("editDraft", [try json(taskEditRequest(edit))])
                    guard taskPresented, taskScheduleSession == session, viewedTaskID == id else { return }
                    taskEditor = editor
                    taskScheduleEdits.removeAll { $0.id == operation.id }
                    synchronizeTaskRelativeInput()
                    synchronizeTaskRecurrenceInputs()
                } catch {
                    guard taskPresented, taskScheduleSession == session, viewedTaskID == id else { return }
                    // A newer edit of this control explicitly supersedes a
                    // refused value. Other controls and Save cannot erase it.
                    if operation.coalesces, taskScheduleEdits.contains(where: { $0.id > operation.id && $0.control == operation.control && $0.coalesces }) {
                        taskScheduleEdits.removeAll { $0.id == operation.id }
                        continue
                    }
                    taskScheduleFailure = error
                    taskScheduleFailedID = operation.id
                    taskError = error.localizedDescription
                    return
                }
            }
        }
    }

    private func resolveTaskScheduleEdits() async throws {
        while !taskScheduleEdits.isEmpty || taskScheduleTask != nil {
            if let failure = taskScheduleFailure { throw failure }
            startTaskSchedulePump()
            guard let pump = taskScheduleTask else { throw CocoaError(.coderReadCorrupt) }
            await pump.value
        }
        if let failure = taskScheduleFailure { throw failure }
    }

    private func resolveTaskEditorInputs(estimate: Bool = true) async throws {
        repeat {
            try await resolveTaskScheduleEdits()
            if estimate { try await resolveTaskEstimateInput() }
            try await resolveTaskTokenInputs()
            // A final native wheel/input callback can arrive during either
            // awaited normalization. Drain it before capturing a save payload.
        } while !taskScheduleEdits.isEmpty || taskScheduleTask != nil
        // Explicit action callers already resigned input. Include any final
        // binding callback delivered during normalization before reconciling text.
        commitTaskRelativeInput()
        commitTaskRecurrenceInputs()
    }

    func retryTaskSchedule() async {
        guard taskPresented, !busy, !retryNeeded, !taskEditor.flag("readOnly") else { return }
        taskScheduleFailure = nil
        taskScheduleFailedID = nil
        if await prepareTaskDatePicker() { await readTaskView() }
    }

    /// Used by picker Open/Done; waits for the final wheel change without adding
    /// a synthetic change for the initial date shown by a native wheel.
    func prepareTaskDatePicker() async -> Bool {
        guard taskPresented, !taskEditor.isEmpty, !taskEditor.flag("readOnly"), !busy, !retryNeeded else { return false }
        busy = true
        taskError = nil
        defer { finishOperation() }
        do {
            try await resolveTaskEditorInputs()
            return true
        } catch { taskError = error.localizedDescription; return false }
    }

    func editTaskDate(_ field: String, action: String, preset: String = "") {
        guard taskDateFieldAvailable(field), !busy, ["clear", "dateOnly", "quick"].contains(action) else { return }
        // Resolve DTO values in queue order. A quick chip can toggle its selected
        // date, so two taps must never coalesce into one.
        enqueueTaskScheduleEdit(field + ":" + action,
            edit: ["type": "dateAction", "field": field, "action": action, "preset": preset], coalesces: false)
    }

    private func taskScheduleCommand(_ input: CoreObject) async throws -> CoreObject {
        if input.text("type") == "toggleFutureRecurrence" {
            return ["type": "fields", "patch": ["showFutureRecurrence": !taskDraft.flag("showFutureRecurrence")]]
        }
        if input.text("type") == "monthlyCustom" {
            // Normalize the dialog's raw interval through core within this queue.
            // Publish only the final custom edit, so a refused Apply keeps its buffer.
            let normalized = try await query("editDraft", [try json(taskEditRequest(
                ["type": "recurrence", "edit": ["kind": "interval", "text": input.text("intervalText")]]))])
            var custom = input.object("custom")
            custom["interval"] = normalized.object("fields").object("recurrence").number("interval")
            return ["type": "recurrence", "edit": ["kind": "monthlyCustom", "custom": custom]]
        }
        guard input.text("type") == "dateAction" else { return input }
        let field = input.text("field")
        let part = taskEditor.object("fields").object(field)
        let value: String
        switch input.text("action") {
        case "clear": value = ""
        case "dateOnly": value = part.text("dateOnly")
        case "quick":
            guard let choice = part.objects("quickDates").first(where: { $0.text("preset") == input.text("preset") }) else {
                throw CocoaError(.coderReadCorrupt)
            }
            value = choice.text("value")
        default: throw CocoaError(.coderReadCorrupt)
        }
        return ["type": "date", "field": field, "value": value]
    }

    func reportTaskDatePickerFailure() {
        taskError = CocoaError(.coderReadCorrupt).localizedDescription
    }

    func taskTokenChoicesCurrent(_ field: String) -> Bool {
        taskPresented && !taskEditor.flag("readOnly") && !busy && !retryNeeded
            && taskTokenSuggestionInputs[field] == taskTokenInputs[field]
            && taskTokenErrors[field] == nil && taskTokenSuggestions[field] != nil
    }

    func setTaskTokenInput(_ field: String, text: String) {
        guard taskPresented, !taskEditor.isEmpty, !taskEditor.flag("readOnly"), !retryNeeded, !taskSavePending,
              taskTokenFields.contains(field), taskTokenInputs[field] != text else { return }
        taskTokenInputs[field] = text
        taskTokenEdited.insert(field)
        requestTaskTokenRead(field)
    }

    func taskTokenFocusChanged(_ field: String, focused: Bool) {
        guard taskTokenFields.contains(field), taskPresented, !taskEditor.flag("readOnly") else { return }
        if focused { taskTokenCommitDisplay.remove(field) }
        else { commitTaskTokenInput(field) }
    }

    func commitTaskTokenInput(_ field: String) {
        guard taskPresented, !taskEditor.flag("readOnly"), !retryNeeded, taskTokenFields.contains(field) else { return }
        taskTokenEdited.insert(field)
        taskTokenCommitDisplay.insert(field)
        if !busy, taskTokenSuggestionInputs[field] == taskTokenInputs[field],
           let canonical = taskTokenSuggestions[field]?["draftValue"] as? String {
            taskTokenCanonical[field] = canonical
            canonicalizeTaskTokenDisplay(field)
        } else {
            taskTokenResolvedInputs[field] = nil
            requestTaskTokenRead(field, delay: 0)
        }
    }

    func retryTaskToken(_ field: String) {
        guard !busy, !retryNeeded, taskPresented, !taskEditor.flag("readOnly"), taskTokenFields.contains(field) else { return }
        requestTaskTokenRead(field, delay: 0)
    }

    func chooseTaskToken(_ field: String, kind: String, value: String) {
        guard taskTokenChoicesCurrent(field), ["matches", "quick"].contains(kind),
              let choice = taskTokenSuggestions[field]?.objects(kind).first(where: { $0.text("value") == value }),
              let text = choice["text"] as? String else { return }
        // Pure text replacement keeps RN's focused input and never disables it.
        setTaskTokenInput(field, text: text)
    }

    private func resetTaskTokens() {
        for field in taskTokenFields { invalidateTaskTokenRead(field) }
        taskTokenInputs = [:]
        taskTokenCanonical = [:]
        taskTokenResolvedInputs = [:]
        taskTokenSuggestions = [:]
        taskTokenSuggestionInputs = [:]
        taskTokenErrors = [:]
        taskTokenCommitDisplay = []
        taskTokenEdited = []
    }

    private func initializeTaskTokens() {
        for field in taskTokenFields {
            let text = taskEditor.object("draft").text(field)
            taskTokenInputs[field] = text
            taskTokenCanonical[field] = text
            taskTokenResolvedInputs[field] = text
            if !taskEditor.flag("readOnly") { taskTokenNeedsRead.insert(field) }
        }
    }

    private func invalidateTaskTokenRead(_ field: String) {
        taskTokenGeneration += 1
        taskTokenGenerations[field] = taskTokenGeneration
        taskTokenReadTasks[field]?.cancel()
        taskTokenReadTasks[field] = nil
        taskTokenSuggestionInputs[field] = nil
        taskTokenNeedsRead.remove(field)
    }

    private func requestTaskTokenRead(_ field: String, delay: UInt64 = 150_000_000) {
        invalidateTaskTokenRead(field)
        taskTokenErrors[field] = nil
        guard taskPresented, !taskEditor.isEmpty, !taskEditor.flag("readOnly"), !retryNeeded else { return }
        taskTokenNeedsRead.insert(field)
        guard !busy else { return }
        let generation = taskTokenGenerations[field]
        let id = viewedTaskID
        let raw = taskTokenInputs[field] ?? ""
        taskTokenReadTasks[field] = Task {
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard !Task.isCancelled, taskTokenGenerations[field] == generation, taskPresented, viewedTaskID == id else { return }
            guard !busy, !retryNeeded else { return }
            taskTokenNeedsRead.remove(field)
            do {
                let result = try await query("editorSuggestions", [id, field, raw, 4])
                guard taskPresented, viewedTaskID == id, taskTokenGenerations[field] == generation,
                      taskTokenInputs[field] == raw else { return }
                try acceptTaskTokenRead(result, field: field, raw: raw)
                if taskTokenCommitDisplay.contains(field) { canonicalizeTaskTokenDisplay(field) }
            } catch {
                guard taskPresented, viewedTaskID == id, taskTokenGenerations[field] == generation,
                      taskTokenInputs[field] == raw else { return }
                taskTokenErrors[field] = error.localizedDescription
            }
        }
    }

    private func acceptTaskTokenRead(_ result: CoreObject, field: String, raw: String) throws {
        guard let canonical = result["draftValue"] as? String else { throw CocoaError(.coderReadCorrupt) }
        // Opening a task must not rewrite untouched legacy token spelling.
        // RN normalizes a field only after editing or committing that input.
        if taskTokenEdited.contains(field) { taskTokenCanonical[field] = canonical }
        taskTokenResolvedInputs[field] = raw
        taskTokenSuggestions[field] = result
        taskTokenSuggestionInputs[field] = raw
        taskTokenErrors[field] = nil
    }

    private func canonicalizeTaskTokenDisplay(_ field: String) {
        guard let canonical = taskTokenCanonical[field], taskTokenResolvedInputs[field] == taskTokenInputs[field] else { return }
        taskTokenCommitDisplay.remove(field)
        guard taskTokenInputs[field] != canonical else { return }
        taskTokenInputs[field] = canonical
        taskTokenResolvedInputs[field] = canonical
        requestTaskTokenRead(field, delay: 0)
    }

    private func resolveTaskTokenInputs() async throws {
        guard !taskEditor.flag("readOnly") else { return }
        let id = viewedTaskID
        let session = taskScheduleSession
        // Background reads only publish one canonical field. Whole editor edits
        // are serialized here, against the latest draft, at an action boundary.
        while true {
            for field in taskTokenFields { invalidateTaskTokenRead(field) }
            let inputs = taskTokenInputs
            for field in taskTokenFields where taskTokenResolvedInputs[field] != inputs[field] {
                let raw = inputs[field] ?? ""
                do {
                    let result = try await query("editorSuggestions", [id, field, raw, 4])
                    guard taskPresented, viewedTaskID == id, taskScheduleSession == session else { throw CancellationError() }
                    if taskTokenInputs[field] == raw { try acceptTaskTokenRead(result, field: field, raw: raw) }
                } catch {
                    if taskTokenInputs[field] == raw { taskTokenErrors[field] = error.localizedDescription }
                    throw error
                }
            }
            guard inputs == taskTokenInputs, taskTokenFields.allSatisfy({ taskTokenResolvedInputs[$0] == inputs[$0] }) else { continue }
            var patch: CoreObject = [:]
            for field in taskTokenFields {
                if let canonical = taskTokenCanonical[field], taskEditor.object("draft").text(field) != canonical {
                    patch[field] = canonical
                }
            }
            if !patch.isEmpty {
                let editor = try await query("editDraft", [try json(taskEditRequest(
                    ["type": "fields", "patch": patch]))])
                guard taskPresented, viewedTaskID == id, taskScheduleSession == session else { throw CancellationError() }
                taskEditor = editor
            }
            guard inputs == taskTokenInputs, taskTokenFields.allSatisfy({ taskTokenResolvedInputs[$0] == inputs[$0] }) else { continue }
            for field in taskTokenFields {
                canonicalizeTaskTokenDisplay(field)
                if taskTokenSuggestionInputs[field] != taskTokenInputs[field] || taskTokenSuggestions[field] == nil {
                    taskTokenNeedsRead.insert(field)
                }
            }
            return
        }
    }

    func openTaskDestination(_ kind: String) async {
        guard taskPresented, !taskEditor.isEmpty, !taskEditor.flag("readOnly"), !busy, !retryNeeded,
              ["destination", "section"].contains(kind),
              kind == "destination" ? !taskDestination.object("destination").text("fieldId").isEmpty : taskDestination.object("section").flag("visible") else { return }
        taskDestinationKind = kind
        taskDestinationQuery = ""
        invalidateTaskDestinationRead()
        taskDestinationError = nil
        // The UI has synchronously resigned its input before this operation.
        busy = true
        defer { finishOperation() }
        do {
            try await resolveTaskEditorInputs()
            try await refreshTaskDestination()
        } catch { taskDestinationError = error.localizedDescription }
    }

    func closeTaskDestination() {
        guard !busy, !retryNeeded else { return }
        taskDestinationKind = ""
        taskDestinationQuery = ""
        invalidateTaskDestinationRead()
        taskDestinationError = nil
        // The value labels do not depend on query. Next opening fetches fresh choices.
    }

    func setTaskDestinationQuery(_ text: String) {
        guard taskPresented, !taskDestinationKind.isEmpty, !retryNeeded, !busy, text != taskDestinationQuery else { return }
        taskDestinationQuery = text
        requestTaskDestinationRead()
    }

    func retryTaskDestination() {
        guard taskPresented, !taskDestinationKind.isEmpty, !busy, !retryNeeded else { return }
        requestTaskDestinationRead(delay: 0)
    }

    func selectTaskDestination(kind: String, id: String) async {
        guard taskDestinationActionsEnabled else { return }
        let choice: CoreObject?
        if taskDestinationKind == "section" {
            guard kind == "section" else { return }
            choice = taskDestination.object("section").objects("choices").first { $0.text("id") == id }
        } else {
            choice = taskDestination.object("destination").objects("groups").first { $0.text("kind") == kind }?
                .objects("choices").first { $0.text("id") == id }
        }
        guard let choice, !choice.object("patch").isEmpty else { return }
        let patch = choice.object("patch")
        let taskID = viewedTaskID
        busy = true
        invalidateTaskDestinationRead()
        taskDestinationError = nil
        taskError = nil
        defer { finishOperation() }
        do {
            try await resolveTaskEditorInputs()
            guard taskPresented, viewedTaskID == taskID, !taskEditor.flag("readOnly") else { return }
            try await applyTaskDestinationPatch(patch, id: taskID)
            guard taskPresented, viewedTaskID == taskID else { return }
            taskDestinationKind = ""
            taskDestinationQuery = ""
            try await refreshTaskDestination()
        } catch {
            if taskDestinationKind.isEmpty { taskError = error.localizedDescription }
            else { taskDestinationError = error.localizedDescription }
        }
    }

    func clearTaskSection() async {
        guard taskPresented, !taskEditor.isEmpty, !taskEditor.flag("readOnly"), !busy, !retryNeeded,
              taskDestinationKind.isEmpty, taskDestination.object("section").flag("visible") else { return }
        let taskID = viewedTaskID
        busy = true
        taskError = nil
        defer { finishOperation() }
        do {
            try await resolveTaskEditorInputs()
            try await refreshTaskDestination()
            guard taskPresented, viewedTaskID == taskID, taskDestinationCurrent, !taskDestination.flag("readOnly"), taskDestination.object("section").flag("visible"),
                  let none = taskDestination.object("section").objects("choices").first(where: { $0.text("id").isEmpty }),
                  !none.object("patch").isEmpty else { return }
            try await applyTaskDestinationPatch(none.object("patch"), id: taskID)
            guard taskPresented, viewedTaskID == taskID else { return }
            try await refreshTaskDestination()
        } catch { taskError = error.localizedDescription }
    }

    private func applyTaskDestinationPatch(_ patch: CoreObject, id: String) async throws {
        let editor = try await query("editDraft", [try json(taskEditRequest(
            ["type": "fields", "patch": patch]))])
        guard taskPresented, viewedTaskID == id else { return }
        taskEditor = editor
        resetTaskEstimateInput()
        // Association labels belong to the old draft until the fresh read succeeds.
        invalidateTaskDestinationRead()
        taskDestination = [:]
    }

    private func resetTaskDestination() {
        invalidateTaskDestinationRead()
        taskDestination = [:]
        taskDestinationKind = ""
        taskDestinationQuery = ""
        taskDestinationError = nil
        taskDestinationDraftIdentity = ""
    }

    private func invalidateTaskDestinationRead() {
        taskDestinationGeneration += 1
        taskDestinationReadTask?.cancel()
        taskDestinationReadTask = nil
        taskDestinationCurrent = false
        taskDestinationNeedsRead = false
    }

    private func requestTaskDestinationRead(delay: UInt64 = 150_000_000) {
        invalidateTaskDestinationRead()
        taskDestinationError = nil
        guard taskPresented, !taskEditor.isEmpty, !retryNeeded else { return }
        taskDestinationNeedsRead = true
        guard !busy else { return }
        let generation = taskDestinationGeneration
        taskDestinationReadTask = Task {
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard !Task.isCancelled, generation == taskDestinationGeneration, taskPresented, !retryNeeded else { return }
            guard !busy else { taskDestinationNeedsRead = true; return }
            taskDestinationNeedsRead = false
            do { try await readTaskDestination(generation: generation) }
            catch {
                guard generation == taskDestinationGeneration, taskPresented else { return }
                taskDestinationError = error.localizedDescription
            }
        }
    }

    private func refreshTaskDestination() async throws {
        invalidateTaskDestinationRead()
        taskDestinationError = nil
        try await readTaskDestination(generation: taskDestinationGeneration)
    }

    private func readTaskDestination(generation: Int) async throws {
        let id = viewedTaskID
        let queryText = taskDestinationQuery
        let draft = taskDraft
        let identity = try json(draft)
        let next = try await query("destinationPicker", [try json(["id": id, "draft": draft, "query": queryText])])
        guard taskPresented, viewedTaskID == id, generation == taskDestinationGeneration else { return }
        guard queryText == taskDestinationQuery, identity == (try json(taskDraft)) else {
            requestTaskDestinationRead(delay: 0)
            return
        }
        guard next.text("id") == id, next.text("query") == queryText else { throw CocoaError(.coderReadCorrupt) }
        taskDestination = next
        taskDestinationDraftIdentity = identity
        taskDestinationCurrent = true
    }

    private func readTaskEditorLabels(_ editor: CoreObject) async throws {
        let options = editor.object("options")
        var keys = ["common.none", "taskEdit.priorityLabel", "taskEdit.energyLevel", "taskEdit.timeEstimateLabel",
                    "taskEdit.scheduling", "taskEdit.organization", "taskEdit.details",
                    "taskEdit.contextsLabel", "taskEdit.contextsPlaceholder", "taskEdit.tagsLabel", "taskEdit.tagsPlaceholder",
                    "taskEdit.startDateLabel", "taskEdit.dueDateLabel", "taskEdit.reviewDateLabel", "taskEdit.dateOnly",
                    "taskEdit.startModeAbsolute", "taskEdit.startModeRelative", "taskEdit.relativeStartAmount",
                    "taskEdit.relativeStartBeforeDue", "task.aria.startTime", "task.aria.dueTime", "calendar.changeTime", "common.done",
                    "taskEdit.recurrenceLabel", "recurrence.repeatEvery", "recurrence.dayUnit", "recurrence.weekUnit",
                    "recurrence.monthUnit", "recurrence.yearUnit", "recurrence.monthlyOnDay", "recurrence.custom",
                    "recurrence.endsLabel", "recurrence.endsNever", "recurrence.endsOnDate", "recurrence.endsAfterCount",
                    "recurrence.occurrenceUnit", "recurrence.afterCompletion", "recurrence.showFutureInCalendar",
                    "recurrence.showFutureInCalendarHint", "recurrence.customTitle", "recurrence.onLabel",
                    "recurrence.lastDay", "recurrence.lastDayOfMonth", "recurrence.onDayOfMonth", "recurrence.onNthWeekday",
                    "recurrence.weekdayMonFri", "recurrence.ordinal.first", "recurrence.ordinal.second",
                    "recurrence.ordinal.third", "recurrence.ordinal.fourth", "recurrence.ordinal.last"]
        keys += options.objects("recurrences").map { $0.text("labelKey") }
        keys += (options["priorities"] as? [String] ?? []).map { "priority." + $0 }
        keys += (options["energyLevels"] as? [String] ?? []).map { "energyLevel." + $0 }
        let translated = try await query("strings", [try json(keys)]).object("strings")
        strings.merge(translated) { _, new in new }
    }

    func readTaskView(more: Bool = false) async {
        guard ready, taskPresented, !busy, !retryNeeded, taskChecklistWriteKind == nil,
              !taskChecklistReadPending else { return }
        let id = viewedTaskID
        let session = taskChecklistSession
        let loaded = taskView.objects("rows").first { $0.text("type") == "checklist" }?.objects("items").count ?? 0
        let target = max(pageSize, loaded) + (more ? pageSize : 0)
        busy = true
        taskError = nil
        defer { finishOperation() }
        var attempt = 0
        while attempt < 2 {
            do {
                if taskEditor.isEmpty {
                    let editor = try await query("editorModel", [id])
                    try await readTaskEditorLabels(editor)
                    guard taskPresented, viewedTaskID == id, taskChecklistSession == session else { return }
                    taskEditor = editor
                    taskOriginalDraft = editor.object("draft")
                    taskOriginalSchedule = editor.object("scheduleBase")
                    taskOriginalRecurrence = editor.object("recurrenceBase")
                    synchronizeTaskRelativeInput()
                    synchronizeTaskRecurrenceInputs()
                    taskTitleDraft = editor.object("draft").text("title")
                    taskNoteDraft = editor.object("draft").text("description")
                    initializeTaskTokens()
                    resetTaskEstimateInput()
                }
                try await resolveTaskEditorInputs()
                try await refreshTaskDestination()
                if taskSchedulePending { try await resolveTaskEditorInputs() }
                if taskChecklistLoaded { try await flushTaskChecklistInputs(id: id, session: session) }
                var draft = taskDraft
                var firstInput: CoreObject = ["id": id, "draft": draft, "offset": 0, "limit": pageSize]
                if taskChecklistLoaded { firstInput["checklist"] = taskChecklist }
                var next = try await query("taskView", [try json(firstInput)])
                if !taskChecklistLoaded {
                    guard taskPresented, viewedTaskID == id, taskChecklistSession == session,
                          next["checklistBase"] is [CoreObject] else { throw CocoaError(.coderReadCorrupt) }
                    taskOriginalChecklist = next.objects("checklistBase")
                    taskChecklist = taskOriginalChecklist
                    _ = try await applyTaskChecklistEdit(nil, id: id, session: session)
                    taskChecklistLoaded = true
                    draft = taskDraft
                    next = try await query("taskView", [try json([
                        "id": id, "draft": draft, "checklist": taskChecklist, "offset": 0, "limit": pageSize])])
                }
                let checklist = taskChecklist
                let revision = next.text("revision")
                var rows = next.objects("rows")
                if let index = rows.firstIndex(where: { $0.text("type") == "checklist" }) {
                    var entries = rows[index].objects("items")
                    let total = rows[index].number("total")
                    while entries.count < min(target, total) {
                        let limit = min(pageSize, min(target, total) - entries.count)
                        let window = try await query("taskView", [try json([
                            "id": id, "draft": draft, "checklist": checklist,
                            "offset": entries.count, "limit": limit, "revision": revision])])
                        let checklist = window.objects("rows").first { $0.text("type") == "checklist" } ?? [:]
                        let page = checklist.objects("items")
                        guard window.text("revision") == revision, window.text("id") == id,
                              checklist.number("total") == total, page.count == limit else {
                            throw CocoaError(.coderReadCorrupt)
                        }
                        entries += page
                    }
                    rows[index]["items"] = entries
                    next["rows"] = rows
                }
                guard taskPresented, viewedTaskID == id, taskChecklistSession == session else { return }
                let draftChanged = (try json(draft)) != (try json(taskDraft))
                if taskSchedulePending || draftChanged || !taskDraftValuesEqual(checklist, taskChecklist)
                    || !taskChecklistInputs.isEmpty || !taskChecklistAppendInput.isEmpty {
                    // A final native input callback may arrive during the view
                    // or checklist reads. Regenerate before publishing Preview.
                    try await resolveTaskEditorInputs()
                    try await flushTaskChecklistInputs(id: id, session: session)
                    continue
                }
                taskView = next
                return
            } catch {
                attempt += 1
                if attempt == 2, taskPresented, viewedTaskID == id, taskChecklistSession == session {
                    taskError = error.localizedDescription
                }
            }
        }
    }

    func openCapture() async {
        guard ready, !busy, !retryNeeded, !areaPickerPresented, !taskPresented,
              !projectRenameEditing,
              !calendarComposerPresented, !mindSweepPresented, !processInboxPresented else { return }
        morePresented = false
        busy = true
        defer { finishOperation() }
        do {
            if capture.isEmpty {
                capture = try await query("captureOpen")
                captureID = UUID().uuidString
                draft = ""
                noteDraft = capture.object("options").text("note")
                contextQuery = ""
                contextPickerPresented = false
                previewedText = ""
                if (preferenceDefaults.object(forKey: preference) as? Bool) ?? initialAddAnother {
                    let result = try await query("captureEdit", [try json([
                        "text": draft, "options": capture.object("options"),
                        "edit": ["type": "setAddAnother", "value": true]])])
                    capture = result.object("view")
                }
            }
            notice = nil
            capturePresented = true
        } catch { self.error = error.localizedDescription }
    }

    func openProcessInbox() async {
        let caller = selectedSurface
        let fromInbox = caller == .inbox && !inbox.object("process").text("label").isEmpty
        let reviewInbox = reviewGuide.object("content")
        let fromReview = caller == .review && reviewGuidePresented && reviewActionsEnabled
            && reviewInbox.text("step") == "inbox"
            && (reviewKind == "daily" ? !reviewInbox.text("processLabel").isEmpty
                : reviewKind == "weekly" && !reviewInbox.text("countLabel").isEmpty)
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented, !taskPresented,
              !morePresented, !mindSweepPresented, !processInboxPresented,
              fromInbox || fromReview else { return }
        busy = true
        defer { finishOperation() }
        do {
            let started = try await query("inboxStart", ["guided"])
            guard selectedSurface == caller,
                  caller != .review || (reviewGuidePresented && ["daily", "weekly"].contains(reviewKind)
                      && reviewGuide.object("content").text("step") == "inbox") else { return }
            let session = started.text("sessionId")
            let view = started.object("view")
            guard !view.isEmpty ? view.text("sessionId") == session && !session.isEmpty : true else {
                throw CocoaError(.coderReadCorrupt)
            }
            processInboxCaller = caller
            processInboxSessionID = session.isEmpty ? nil : session
            processInboxView = view
            processInboxNotice = [:]
            processInboxToast = ""
            processInboxError = nil
            processInboxReadError = nil
            processInboxPendingEdits = []
            processInboxRequest = nil
            processInboxRequestMethod = nil
            processInboxRequestID = nil
            processInboxRequestTaskID = nil
            processInboxAfterRequestID = nil
            syncProcessInboxInputs()
            processInboxPresented = true
        } catch { self.error = error.localizedDescription }
    }

    private func syncProcessInboxInputs() {
        let draft = processInboxView.object("draft")
        var inputs: [String: String] = [:]
        for field in ["title", "description", "tokenInput", "projectSearch", "assignedTo", "delegateWho", "nextAction"] {
            inputs[field] = draft.text(field)
        }
        let extras = draft["extraActions"] as? [String] ?? []
        for index in extras.indices { inputs["extra-\(index)"] = extras[index] }
        processInboxInputs = inputs
    }

    func setProcessInboxInput(_ field: String, _ value: String) {
        guard processInboxControlsEnabled, value != processInboxInputs[field] else { return }
        let editable = ["title", "description", "tokenInput", "projectSearch", "assignedTo", "delegateWho", "nextAction"]
        let edit: CoreObject
        if editable.contains(field) {
            edit = ["type": "set", "field": field, "value": value]
        } else if field.hasPrefix("extra-"), let index = Int(field.dropFirst(6)), index >= 0,
                  index < processInboxView.object("project").object("conversion").objects("rows").count {
            edit = ["type": "setExtraAction", "index": index, "value": value]
        } else { return }
        processInboxInputs[field] = value
        // Adjacent text callbacks for one field supersede each other before the
        // next pure step read. An in-flight edit has already left this queue.
        if processInboxPendingEdits.last?.text("type") == edit.text("type")
            && processInboxPendingEdits.last?.text("field") == edit.text("field")
            && (edit.text("type") != "setExtraAction"
                || processInboxPendingEdits.last?.number("index") == edit.number("index")) {
            processInboxPendingEdits[processInboxPendingEdits.count - 1] = edit
        } else { processInboxPendingEdits.append(edit) }
        scheduleProcessInboxEdits()
    }

    private func processInboxStepInput(edit: CoreObject? = nil, mode: String? = nil) throws -> String {
        guard let session = processInboxSessionID, session == processInboxView.text("sessionId"),
              !processInboxView.text("taskId").isEmpty, !processInboxView.text("step").isEmpty else {
            throw CocoaError(.coderReadCorrupt)
        }
        var input: CoreObject = ["sessionId": session, "taskId": processInboxView.text("taskId"),
                                 "step": processInboxView.text("step")]
        if let edit { input["edit"] = edit }
        if let mode { input["mode"] = mode }
        return try json(input)
    }

    private func scheduleProcessInboxEdits() {
        guard processInboxEditTask == nil, !processInboxPendingEdits.isEmpty else { return }
        processInboxEditTask = Task {
            await drainProcessInboxEdits()
            processInboxEditTask = nil
        }
    }

    private func drainProcessInboxEdits() async {
        while !processInboxPendingEdits.isEmpty && processInboxPresented && processInboxRequest == nil {
            let edit = processInboxPendingEdits.removeFirst()
            do {
                let input = try processInboxStepInput(edit: edit)
                let next = try await query("inboxStep", [input])
                guard processInboxPresented, next.text("sessionId") == processInboxSessionID,
                      next.text("taskId") == processInboxView.text("taskId") else {
                    throw CocoaError(.coderReadCorrupt)
                }
                processInboxView = next
                processInboxReadError = nil
            } catch {
                // A read may have applied its edit before its reply failed. Retry
                // first reads the current view, then reapplies only desired text.
                processInboxReadError = error.localizedDescription
                return
            }
        }
    }

    private func waitForProcessInboxEdits() async -> Bool {
        while let task = processInboxEditTask { await task.value }
        if !processInboxPendingEdits.isEmpty && processInboxReadError == nil {
            await drainProcessInboxEdits()
        }
        return processInboxReadError == nil && processInboxPendingEdits.isEmpty
    }

    func editProcessInbox(_ edit: CoreObject, conversionAction: String? = nil, index: Int = 0) async {
        guard processInboxControlsEnabled, !edit.isEmpty || conversionAction != nil else { return }
        processInboxTransitioning = true
        busy = true
        defer { processInboxTransitioning = false; finishOperation() }
        guard await waitForProcessInboxEdits() else { return }
        do {
            var currentEdit = edit
            if let conversionAction {
                let conversion = processInboxView.object("project").object("conversion")
                switch conversionAction {
                case "nextSubmit": currentEdit = conversion.object("nextActionSubmit")
                case "add": currentEdit = conversion.object("addAction").object("edit")
                case "remove":
                    let rows = conversion.objects("rows")
                    currentEdit = rows.indices.contains(index) ? rows[index].object("remove") : [:]
                case "rowSubmit":
                    let rows = conversion.objects("rows")
                    currentEdit = rows.indices.contains(index) ? rows[index].object("submit") : [:]
                default: currentEdit = [:]
                }
            }
            guard !currentEdit.isEmpty else { return }
            let next = try await query("inboxStep", [try processInboxStepInput(edit: currentEdit)])
            guard next.text("sessionId") == processInboxSessionID,
                  next.text("taskId") == processInboxView.text("taskId") else { throw CocoaError(.coderReadCorrupt) }
            processInboxView = next
            processInboxReadError = nil
            processInboxError = nil
            syncProcessInboxInputs()
        } catch { processInboxReadError = error.localizedDescription }
    }

    func changeProcessInboxMode() async {
        guard processInboxControlsEnabled else { return }
        processInboxTransitioning = true
        busy = true
        defer { processInboxTransitioning = false; finishOperation() }
        guard await waitForProcessInboxEdits() else { return }
        let mode = processInboxView.text("mode") == "quick" ? "guided" : "quick"
        do {
            let next = try await query("inboxStep", [try processInboxStepInput(mode: mode)])
            guard next.text("sessionId") == processInboxSessionID,
                  next.text("taskId") == processInboxView.text("taskId") else { throw CocoaError(.coderReadCorrupt) }
            processInboxView = next
            processInboxReadError = nil
            syncProcessInboxInputs()
        } catch { processInboxReadError = error.localizedDescription }
    }

    func decideProcessInbox(_ choice: String) async {
        let choices = processInboxView.objects("choices").map { $0.text("id") }
        let conversion = processInboxView.object("project").object("conversion")
        let search = processInboxView.object("project").object("search")
        guard processInboxControlsEnabled,
              choices.contains(choice) || (choice == "back" && !processInboxView.text("back").isEmpty)
                || (choice == "fileIt" && !processInboxView.text("fileIt").isEmpty)
                || (choice == "createProject" && !conversion.isEmpty)
                || (choice == "submitProjectSearch" && !search.isEmpty) else { return }
        processInboxTransitioning = true
        busy = true
        defer { processInboxTransitioning = false; finishOperation() }
        guard await waitForProcessInboxEdits() else { return }
        do {
            let requestID = UUID().uuidString.lowercased()
            guard let session = processInboxSessionID else { throw CocoaError(.coderReadCorrupt) }
            let taskID = processInboxView.text("taskId")
            let request = try json(["sessionId": session, "taskId": taskID,
                                    "step": processInboxView.text("step"),
                                    "decision": ["choice": choice], "requestId": requestID])
            processInboxRequest = request
            processInboxRequestMethod = "inboxCommit"
            processInboxRequestID = requestID
            processInboxRequestTaskID = taskID
            processInboxError = nil
            let wrapper = try await query("inboxCommit", [request])
            try await acceptProcessInboxResponse(wrapper)
        } catch { handleProcessInboxWriteError(error) }
    }

    func skipProcessInbox() async {
        guard processInboxControlsEnabled else { return }
        processInboxTransitioning = true
        busy = true
        defer { processInboxTransitioning = false; finishOperation() }
        guard await waitForProcessInboxEdits() else { return }
        do {
            let requestID = UUID().uuidString.lowercased()
            guard let session = processInboxSessionID else { throw CocoaError(.coderReadCorrupt) }
            let taskID = processInboxView.text("taskId")
            let request = try json(["sessionId": session, "taskId": taskID, "requestId": requestID])
            processInboxRequest = request
            processInboxRequestMethod = "inboxSkip"
            processInboxRequestID = requestID
            processInboxRequestTaskID = taskID
            processInboxError = nil
            let wrapper = try await query("inboxSkip", [request])
            try await acceptProcessInboxResponse(wrapper)
        } catch { handleProcessInboxWriteError(error) }
    }

    private func handleProcessInboxWriteError(_ failure: Error) {
        if processInboxRequest != nil && isDefiniteRejection(failure) {
            processInboxRequest = nil
            processInboxRequestMethod = nil
            processInboxRequestID = nil
            processInboxRequestTaskID = nil
            retryNeeded = false
            processInboxError = failure.localizedDescription
        } else {
            retryNeeded = processInboxRequest != nil
            processInboxError = failure.localizedDescription
        }
    }

    private func installProcessInboxResult(_ result: CoreObject) throws {
        guard result["view"] != nil else { throw CocoaError(.coderReadCorrupt) }
        let next = result.object("view")
        if !next.isEmpty {
            guard next.text("sessionId") == processInboxSessionID,
                  !next.text("taskId").isEmpty else { throw CocoaError(.coderReadCorrupt) }
        }
        processInboxView = next
        processInboxNotice = result.object("notice")
        processInboxToast = result.object("toast").text("message")
        processInboxError = nil
        processInboxReadError = nil
        processInboxPendingEdits = []
        syncProcessInboxInputs()
    }

    private func acceptProcessInboxResponse(_ wrapper: CoreObject) async throws {
        switch wrapper.text("kind") {
        case "flow":
            // No library write occurred; this flow response may move steps.
            processInboxRequest = nil
            processInboxRequestMethod = nil
            processInboxRequestID = nil
            processInboxRequestTaskID = nil
            retryNeeded = false
            do { try installProcessInboxResult(wrapper.object("result")) }
            catch { processInboxReadError = error.localizedDescription }
        case "saved":
            guard processInboxRequest != nil, let requestID = processInboxRequestID,
                  wrapper.object("result").text("taskId") == processInboxRequestTaskID else {
                throw CocoaError(.coderReadCorrupt)
            }
            // The host has crossed the durable barrier. A failed next-view read
            // must never make this decision's UUID eligible for submission again.
            processInboxRequest = nil
            processInboxRequestMethod = nil
            processInboxRequestID = nil
            processInboxRequestTaskID = nil
            retryNeeded = false
            processInboxError = nil
            processInboxAfterRequestID = requestID
            await readProcessInboxAfterCommit()
        default: throw CocoaError(.coderReadCorrupt)
        }
    }

    private func readProcessInboxAfterCommit() async {
        guard let session = processInboxSessionID, let requestID = processInboxAfterRequestID else { return }
        do {
            let result = try await query("inboxAfterCommit", [try json(["sessionId": session, "requestId": requestID])])
            try installProcessInboxResult(result)
            processInboxAfterRequestID = nil
        } catch { processInboxReadError = error.localizedDescription }
    }

    func retryProcessInboxRead() async {
        guard processInboxPresented, !busy, !retryNeeded, processInboxRequest == nil,
              processInboxReadError != nil else { return }
        busy = true
        defer { finishOperation() }
        if processInboxAfterRequestID != nil { await readProcessInboxAfterCommit(); return }
        do {
            let current = try await query("inboxStep", [try processInboxStepInput()])
            guard current.text("sessionId") == processInboxSessionID,
                  current.text("taskId") == processInboxView.text("taskId") else { throw CocoaError(.coderReadCorrupt) }
            processInboxView = current
            processInboxReadError = nil
            processInboxPendingEdits = []
            for field in ["title", "description", "tokenInput", "projectSearch", "assignedTo", "delegateWho", "nextAction"] {
                if let desired = processInboxInputs[field], desired != current.object("draft").text(field) {
                    processInboxPendingEdits.append(["type": "set", "field": field, "value": desired])
                }
            }
            let extras = current.object("draft")["extraActions"] as? [String] ?? []
            for index in extras.indices {
                if let desired = processInboxInputs["extra-\(index)"], desired != extras[index] {
                    processInboxPendingEdits.append(["type": "setExtraAction", "index": index, "value": desired])
                }
            }
            await drainProcessInboxEdits()
        } catch { processInboxReadError = error.localizedDescription }
    }

    func closeProcessInbox() async {
        guard processInboxCloseEnabled else { return }
        processInboxTransitioning = true
        busy = true
        defer { processInboxTransitioning = false; finishOperation() }
        if let task = processInboxEditTask { await task.value }
        do {
            if let session = processInboxSessionID {
                do { _ = try await query("inboxEnd", [session]) }
                catch { if !isDefiniteRejection(error) { throw error } }
            }
            let caller = processInboxCaller
            processInboxPresented = false
            processInboxCaller = nil
            processInboxSessionID = nil
            processInboxView = [:]
            processInboxNotice = [:]
            processInboxToast = ""
            processInboxError = nil
            processInboxReadError = nil
            processInboxInputs = [:]
            processInboxPendingEdits = []
            processInboxAfterRequestID = nil
            if caller == .inbox {
                do { try await readInbox() }
                catch { self.error = error.localizedDescription }
            }
            else if caller == .review { await readReview() }
        } catch { processInboxReadError = error.localizedDescription }
    }

    func openMindSweep() async {
        let entry = inbox.object("mindSweep")
        let caller = selectedSurface
        let reviewStep = reviewGuide.object("content").text("step")
        let fromInbox = caller == .inbox && !entry.text("label").isEmpty
            && ["accessory", "primary"].contains(entry.text("placement"))
        let fromWeeklyReview = caller == .review && reviewGuidePresented && reviewKind == "weekly"
            && reviewActionsEnabled && ["inbox", "completed"].contains(reviewStep)
            && !reviewGuide.object("labels").text("mindSweep").isEmpty
        guard ready, !busy, !retryNeeded, !capturePresented, !areaPickerPresented,
              !taskPresented, !morePresented, !mindSweepPresented, !processInboxPresented,
              fromInbox || fromWeeklyReview else { return }
        busy = true
        defer { finishOperation() }
        do {
            let guide = try await query("mindSweepGuide", [try json(["scope": "all"])])
            guard selectedSurface == caller,
                  caller != .review || (reviewGuidePresented && reviewKind == "weekly"
                      && reviewGuide.object("content").text("step") == reviewStep) else { return }
            try validateMindSweepGuide(guide, scope: "all")
            mindSweepGuide = guide
            mindSweepRequestedScope = "all"
            mindSweepStep = -1
            mindSweepDraft = ""
            mindSweepCaptured = [:]
            mindSweepCountedIDs = []
            mindSweepAddFailed = false
            mindSweepGuideError = nil
            mindSweepCaller = caller
            mindSweepPresented = true
        } catch { self.error = error.localizedDescription }
    }

    func setMindSweepScope(_ scope: String) async {
        guard mindSweepControlsEnabled, mindSweepStep == -1,
              mindSweepGuide.objects("scopes").contains(where: { $0.text("value") == scope }),
              scope != mindSweepGuide.text("scope") || mindSweepGuideError != nil else { return }
        mindSweepRequestedScope = scope
        await readMindSweepGuide(scope)
    }

    func retryMindSweepGuide() async {
        guard mindSweepControlsEnabled, mindSweepStep == -1, mindSweepGuideError != nil else { return }
        await readMindSweepGuide(mindSweepRequestedScope)
    }

    private func readMindSweepGuide(_ scope: String) async {
        busy = true
        defer { finishOperation() }
        do {
            let guide = try await query("mindSweepGuide", [try json(["scope": scope])])
            guard let caller = mindSweepCaller, mindSweepPresented, selectedSurface == caller else { return }
            try validateMindSweepGuide(guide, scope: scope)
            mindSweepGuide = guide
            mindSweepGuideError = nil
        } catch { mindSweepGuideError = error.localizedDescription }
    }

    private func validateMindSweepGuide(_ guide: CoreObject, scope: String) throws {
        let groups = guide.objects("groups")
        let scopes = guide.objects("scopes")
        let ids = groups.map { $0.text("id") }
        guard guide.text("scope") == scope, !groups.isEmpty, groups.count <= 9,
              ids.allSatisfy({ !$0.isEmpty }), Set(ids).count == ids.count,
              groups.allSatisfy({ !$0.text("title").isEmpty && $0["prompts"] is [String] &&
                  ($0["prompts"] as? [String])?.count == 5 }),
              Set(scopes.map { $0.text("value") }) == Set(["all", "personal", "work"]),
              scopes.allSatisfy({ !$0.text("label").isEmpty }), !guide.object("text").isEmpty else {
            throw CocoaError(.coderReadCorrupt)
        }
    }

    func setMindSweepDraft(_ text: String) {
        guard mindSweepControlsEnabled, !mindSweepCurrentGroup.isEmpty,
              text != mindSweepDraft else { return }
        mindSweepDraft = text
    }

    func startMindSweep() {
        guard mindSweepControlsEnabled, mindSweepStep == -1, !mindSweepGuide.objects("groups").isEmpty else { return }
        mindSweepStep = 0
    }

    func backMindSweep() {
        guard mindSweepControlsEnabled, mindSweepStep > 0,
              mindSweepStep < mindSweepGuide.objects("groups").count else { return }
        mindSweepStep -= 1
    }

    func nextMindSweep() {
        guard mindSweepControlsEnabled, !mindSweepCurrentGroup.isEmpty else { return }
        mindSweepStep += 1
    }

    func closeMindSweep() {
        guard mindSweepControlsEnabled else { return }
        mindSweepPresented = false
        mindSweepCaller = nil
        mindSweepGuide = [:]
        mindSweepStep = -1
        mindSweepDraft = ""
        mindSweepCaptured = [:]
        mindSweepCountedIDs = []
        mindSweepAddFailed = false
        mindSweepGuideError = nil
    }

    func addMindSweep() async {
        guard mindSweepCanAdd else { return }
        let group = mindSweepCurrentGroup.text("id")
        let requestID = UUID().uuidString.lowercased()
        let request: String
        do { request = try json(["requestId": requestID, "title": mindSweepDraft]) }
        catch { mindSweepAddFailed = true; return }
        mindSweepRequest = request
        mindSweepRequestID = requestID
        mindSweepRequestGroup = group
        busy = true
        mindSweepAddFailed = false
        error = nil
        defer { finishOperation() }
        do {
            let result = try await query("mindSweepAdd", [request])
            try acknowledgeMindSweep(result)
            try await readMindSweepCaller()
        } catch {
            if mindSweepRequest != nil && isDefiniteRejection(error) {
                mindSweepRequest = nil
                mindSweepRequestID = nil
                mindSweepRequestGroup = nil
                mindSweepAddFailed = true
                self.error = nil
            } else {
                retryNeeded = mindSweepRequest != nil
                self.error = error.localizedDescription
            }
        }
    }

    private func acknowledgeMindSweep(_ result: CoreObject) throws {
        guard let id = mindSweepRequestID, let group = mindSweepRequestGroup,
              result.text("taskId") == id, !result.text("title").isEmpty else {
            throw CocoaError(.coderReadCorrupt)
        }
        // The host has crossed the durable barrier. A later caller read cannot
        // make this UUID eligible for submission again.
        mindSweepRequest = nil
        mindSweepRequestID = nil
        mindSweepRequestGroup = nil
        retryNeeded = false
        error = nil
        if mindSweepCountedIDs.insert(id).inserted {
            mindSweepCaptured[group, default: []].append(result.text("title"))
        }
        mindSweepDraft = ""
        mindSweepAddFailed = false
    }

    private func readMindSweepCaller() async throws {
        guard let caller = mindSweepCaller, selectedSurface == caller else { throw CocoaError(.coderReadCorrupt) }
        if caller == .inbox { try await readInbox() }
        else if caller == .review { await readReview() }
        else { throw CocoaError(.coderReadCorrupt) }
    }

    func textChanged() {
        previewGeneration += 1
        let generation = previewGeneration
        let text = draft
        let note = noteDraft
        let options = capture.object("options")
        let picker = contextPickerPresented ? ["kind": "context", "query": contextQuery] : nil
        previewTask?.cancel()
        guard !busy, !retryNeeded, capturePresented else { return }
        previewTask = Task {
            do {
                try await Task.sleep(nanoseconds: 120_000_000)
                let value = try await readCapture(text: text, note: note, options: options, picker: picker)
                guard !Task.isCancelled, generation == previewGeneration, !busy, !retryNeeded else { return }
                capture = value
                previewedText = text
            } catch {
                guard !Task.isCancelled, generation == previewGeneration else { return }
                notice = error.localizedDescription
            }
        }
    }

    func openContextPicker() {
        guard capturePresented, !busy, !retryNeeded else { return }
        contextQuery = ""
        contextPickerPresented = true
        textChanged()
    }

    func closeContextPicker() {
        guard !busy, !retryNeeded else { return }
        contextPickerPresented = false
        textChanged()
    }

    func editCapture(_ edit: CoreObject, clearContextQuery: Bool = false, closeContextPicker: Bool = false) async {
        await applyCaptureEdit(edit, clearContextQuery: clearContextQuery, closeContextPicker: closeContextPicker)
    }

    func submitContextQuery() async {
        guard contextPickerPresented else { return }
        await applyCaptureEdit(nil, clearContextQuery: true)
    }

    private func applyCaptureEdit(_ edit: CoreObject?, clearContextQuery: Bool = false, closeContextPicker: Bool = false) async {
        guard !busy, !retryNeeded else { return }
        busy = true
        invalidatePreview()
        defer { finishOperation() }
        let text = draft
        let note = noteDraft
        let originalQuery = contextQuery
        let picker = contextPickerPresented ? ["kind": "context", "query": clearContextQuery ? "" : contextQuery] : nil
        do {
            // Apply pending note text through core before changing another option.
            // Never copy a returned note over the local editor: typing may continue across an await.
            var options = capture.object("options")
            var resolvedEdit = edit
            if options.text("note") != note || edit == nil {
                // Done can arrive before the debounced preview. Resolve its frozen
                // query through core now, rather than dropping it or using a stale edit.
                let currentPicker = edit == nil ? ["kind": "context", "query": originalQuery] : picker
                let current = try await readCapture(text: text, note: note, options: options, picker: currentPicker)
                options = current.object("options")
                if edit == nil {
                    resolvedEdit = current.object("picker").object("submit")
                    if resolvedEdit?.isEmpty != false {
                        capture = current
                        previewedText = text
                        return
                    }
                }
            }
            guard let resolvedEdit else { return }
            var input: CoreObject = ["text": text, "options": options, "edit": resolvedEdit]
            if let picker { input["picker"] = picker }
            let result = try await query("captureEdit", [try json(input)])
            capture = result.object("view")
            previewedText = text
            if clearContextQuery && contextQuery == originalQuery { contextQuery = "" }
            if closeContextPicker { contextPickerPresented = false }
            notice = result.object("notice").text("message").nilIfEmpty
            preferenceDefaults.set(capture.object("options").flag("addAnother"), forKey: preference)
        } catch { notice = error.localizedDescription }
    }

    private func readCapture(text: String, note: String, options: CoreObject, picker: [String: String]?) async throws -> CoreObject {
        var input: CoreObject = ["text": text, "options": options]
        if let picker { input["picker"] = picker }
        if options.text("note") != note {
            input["edit"] = ["type": "setNote", "value": note]
            return try await query("captureEdit", [try json(input)]).object("view")
        }
        return try await query("captureView", [try json(input)])
    }

    func saveCapture() async {
        guard canSave else { return }
        busy = true
        invalidatePreview()
        defer { finishOperation() }
        do {
            let payload = try json(["text": draft, "options": capture.object("options"),
                                    "captureId": captureID, "openAfterSave": false])
            capturePending = true
            let result = try await query("captureSubmit", [payload])
            capturePending = false
            handleCaptureResult(result)
            try await readSelectedSurface()
        } catch {
            // The host owns the durable request. Freeze this exact draft until its outcome is known.
            if isDefiniteRejection(error) { capturePending = false }
            retryNeeded = capturePending
            self.error = error.localizedDescription
        }
    }

    func complete(_ id: String) async {
        if selectedSurface == .project { guard await flushProjectNotesEdit() else { return } }
        guard ready, !busy, !retryNeeded, !projectRenameEditing,
              selectedSurface != .history, selectedSurface != .trash else { return }
        if selectedSurface == .review {
            guard reviewActionsEnabled, reviewRows.contains(where: {
                $0.text("id") == id && !$0.flag("readOnly") && !$0.object("meta").text("statusLabel").isEmpty
            }) else { return }
        }
        if selectedSurface == .calendar { guard calendarActionsEnabled, calendarEditableTask(id) else { return } }
        if selectedSurface == .focus {
            guard focusActionsEnabled, focus.objects("sections").contains(where: { section in
                section.objects("rows").contains(where: {
                    $0.text("id") == id && !$0.flag("readOnly") && !$0.object("meta").text("statusLabel").isEmpty
                })
            }) else { return }
        }
        if selectedSurface == .contexts {
            guard contextsActionsEnabled, contexts.objects("rows").contains(where: {
                $0.text("id") == id && !$0.flag("readOnly") && !$0.object("meta").text("statusLabel").isEmpty
            }) else { return }
        }
        if selectedSurface == .reference {
            guard referenceActionsEnabled, reference.objects("items").contains(where: {
                let row = $0.object("row")
                return $0.text("type") == "task" && row.text("id") == id && !row.flag("readOnly")
                    && !row.object("meta").text("statusLabel").isEmpty
            }) else { return }
        }
        if selectedSurface == .someday {
            guard somedayActionsEnabled, someday.objects("items").contains(where: {
                $0.text("type") == "task" && $0.object("row").text("id") == id
            }) else { return }
        }
        if selectedSurface == .waiting {
            guard waitingActionsEnabled, waiting.objects("rows").contains(where: { $0.text("id") == id }) else { return }
        }
        if selectedSurface == .project {
            guard projectActionsEnabled, !projectDetail.flag("readOnly"), projectDetail.objects("items").contains(where: {
                $0.text("type") == "task" && $0.object("row").text("id") == id
            }) else { return }
        }
        busy = true
        invalidatePreview()
        defer { finishOperation() }
        do {
            _ = try await query("complete", [id])
        } catch {
            retryNeeded = !isDefiniteRejection(error)
            self.error = error.localizedDescription
            return
        }
        do { try await readSelectedSurface() } catch { self.error = error.localizedDescription }
    }

    func retry() async {
        guard !busy, !projectRenameEditing || projectRenameRequest != nil else { return }
        guard ready else { await start(); return }
        busy = true
        var boardTaskOpened = false
        defer {
            finishOperation()
            if boardTaskOpened { Task { await readTaskView() } }
        }
        do {
            let acknowledgment = try await host!.retryPending()
            if let kind = taskChecklistWriteKind {
                guard let request = taskChecklistWriteRequest else { throw CocoaError(.coderValueNotFound) }
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query(kind == "save" ? "checklistSave" : "checklistReset", [request]) }
                guard result.text("id") == viewedTaskID else { throw CocoaError(.coderReadCorrupt) }
                if kind == "reset", !validTaskChecklistResetResult(result, id: viewedTaskID) {
                    throw CocoaError(.coderReadCorrupt)
                }
                taskChecklistWriteKind = nil
                taskChecklistWriteRequest = nil
                retryNeeded = false
                taskError = nil
                if kind == "reset" {
                    try await acceptTaskChecklistReset(result, id: viewedTaskID, session: taskChecklistSession)
                    return
                }
                dismissTask()
                try await readSelectedSurface()
                return
            }
            if processInboxRequest != nil {
                let wrapper: CoreObject
                if let acknowledgment { wrapper = try decode(acknowledgment) }
                else if let method = processInboxRequestMethod, let request = processInboxRequest {
                    wrapper = try await query(method, [request])
                } else { throw CocoaError(.coderValueNotFound) }
                try await acceptProcessInboxResponse(wrapper)
                return
            }
            if let request = projectRenameRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectRenameRetryOutcome", [request]) }
                try acknowledgeProjectRename(result)
                do { try await refreshProjectRenameAfterWrite() }
                catch {
                    projectRenameReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectTaskOrderRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectTaskOrderRetryOutcome", [request]) }
                try acknowledgeProjectTaskOrder(result)
                await readProjectDetail()
                await readProjectTaskOrder()
                return
            }
            if let request = projectTaskSortRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectTaskSortRetryOutcome", [request]) }
                try acknowledgeProjectTaskSort(result)
                do { try await refreshProjectFlowAfterWrite() }
                catch { projectTaskSortReadError = error.localizedDescription }
                return
            }
            if let request = projectFlowRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectFlowRetryOutcome", [request]) }
                try acknowledgeProjectFlow(result)
                do { try await refreshProjectFlowAfterWrite() }
                catch {
                    projectFlowReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectStatusRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectStatusRetryOutcome", [request]) }
                try acknowledgeProjectStatus(result)
                do { try await refreshProjectStatusAfterWrite() }
                catch {
                    projectStatusReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectDateRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectDateRetryOutcome", [request]) }
                try acknowledgeProjectDate(result)
                do { try await refreshProjectDateAfterWrite() }
                catch {
                    projectDateReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectAreaRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectAreaRetryOutcome", [request]) }
                if await retainCreatedProjectAreaAfterBlockedWrite(result) { return }
                try acknowledgeProjectArea(result)
                do { try await refreshProjectAreaAfterWrite() }
                catch {
                    projectAreaReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectTagsRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectTagsWriteRetryOutcome", [request]) }
                let accepted = try acknowledgeProjectTags(result)
                do {
                    try await refreshProjectTagsAfterWrite()
                    if !accepted, projectTagsPresented {
                        try await readProjectTagsOptions(projectID: projectHeader.text("id"))
                    }
                } catch {
                    projectTagsReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectSectionRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectSectionCreateRetryOutcome", [request]) }
                try acknowledgeProjectSection(result)
                do { try await refreshProjectSectionsAfterWrite() }
                catch {
                    projectSectionReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectSectionRenameRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectSectionRenameRetryOutcome", [request]) }
                try acknowledgeProjectSectionRename(result)
                do { try await refreshProjectSectionsAfterWrite() }
                catch {
                    projectSectionReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectSectionDeleteRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectSectionDeleteRetryOutcome", [request]) }
                try acknowledgeProjectSectionDelete(result)
                do { try await refreshProjectSectionsAfterWrite() }
                catch {
                    projectSectionReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectSectionOrderRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectSectionOrderRetryOutcome", [request]) }
                try acknowledgeProjectSectionOrder(result)
                do { try await refreshProjectSectionsAfterWrite() }
                catch {
                    projectSectionReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectNotesWriteRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectNotesWriteRetryOutcome", [request]) }
                let accepted = try acknowledgeProjectNotesWrite(result)
                if accepted {
                    do {
                        try await readSelectedSurface()
                        if projectNotesEditReadError != nil { throw CocoaError(.coderReadCorrupt) }
                    } catch {
                        projectNotesEditReadError = error.localizedDescription
                        self.error = error.localizedDescription
                    }
                }
                return
            }
            if let request = focusSavedFilterRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("focusSavedFilterRetryOutcome", [request]) }
                try acknowledgeFocusSavedFilter(result)
                await readFocus(ownsOperation: true)
                return
            }
            if let request = focusOrderRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("focusOrderRetryOutcome", [request]) }
                try acknowledgeFocusOrder(result)
                await readFocus(ownsOperation: true)
                return
            }
            if let request = referenceSortRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("taskListSortRetryOutcome", [request]) }
                try acknowledgeReferenceSort(result)
                await readReference()
                return
            }
            if let request = focusGroupRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("focusGroupRetryOutcome", [request]) }
                try acknowledgeFocusGroup(result)
                await readFocus(ownsOperation: true)
                return
            }
            if let request = taskFocusRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("taskFocusRetryOutcome", [request]) }
                try acknowledgeTaskFocus(result)
                try await readSelectedSurface()
                return
            }
            if let request = projectFocusRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectFocusRetryOutcome", [request]) }
                try acknowledgeProjectFocus(result)
                do { try await readSelectedSurface() }
                catch {
                    projectFocusReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = areaRenameRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("areaRenameRetryOutcome", [request]) }
                try acknowledgeAreaRename(result)
                do {
                    try await refreshAreaManagerAfterWrite()
                    completeAreaRenameAfterRefresh()
                } catch {
                    areaRenameReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = areaDeleteRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("areaDeleteRetryOutcome", [request]) }
                try acknowledgeAreaDelete(result)
                do { try await refreshAreaManagerAfterWrite() }
                catch {
                    areaDeleteReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = areaOrderRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("areaOrderRetryOutcome", [request]) }
                try acknowledgeAreaOrder(result)
                do { try await refreshAreaManagerAfterWrite() }
                catch {
                    areaOrderReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = areaColorRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("areaColorRetryOutcome", [request]) }
                try acknowledgeAreaColor(result)
                do {
                    try await refreshAreaManagerAfterWrite()
                } catch {
                    areaColorReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = areaCreateRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("areaCreateRetryOutcome", [request]) }
                let fromProject = projectAreaCreatePresented || areaManagerProjectID != nil
                let projectID = projectAreaCreateProjectID
                try acknowledgeAreaCreate(result)
                if fromProject {
                    await completeProjectAreaCreation(projectID: projectID)
                    return
                }
                do {
                    try await refreshAreaManagerAfterWrite()
                    areaManagerPresented = false
                } catch {
                    areaCreateReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if let request = projectCreateRequest {
                let result: CoreObject
                if let acknowledgment { result = try decode(acknowledgment) }
                else { result = try await query("projectCreateRetryOutcome", [request]) }
                try acknowledgeProjectCreate(result, retrying: true)
                do { try await readSelectedSurface() }
                catch {
                    projectCreateReadError = error.localizedDescription
                    self.error = error.localizedDescription
                }
                return
            }
            if calendarComposerSaveRequest != nil {
                guard let acknowledgment else { throw CocoaError(.coderValueNotFound) }
                await acknowledgeCalendarComposerSave(try decode(acknowledgment))
                return
            }
            if boardActionPending {
                guard let acknowledgment else { throw CocoaError(.coderValueNotFound) }
                boardTaskOpened = await acknowledgeBoardAction(try decode(acknowledgment))
                return
            }
            if mindSweepRequest != nil {
                guard let acknowledgment else { throw CocoaError(.coderValueNotFound) }
                try acknowledgeMindSweep(try decode(acknowledgment))
                try await readMindSweepCaller()
                return
            }
            if capturePending {
                guard let acknowledgment else { throw CocoaError(.coderValueNotFound) }
                let result = try decode(acknowledgment)
                capturePending = false
                handleCaptureResult(result)
            }
            if taskSavePending {
                guard acknowledgment != nil else { throw CocoaError(.coderValueNotFound) }
                taskSavePending = false
                taskChecklistWriteKind = nil
                taskChecklistWriteRequest = nil
                taskError = nil
                dismissTask()
            }
            if calendarPreferencePending {
                guard acknowledgment != nil else { throw CocoaError(.coderValueNotFound) }
                acknowledgeCalendarPreference()
                installCalendarComposerAnchor()
            }
            retryNeeded = false
            error = nil
            try await readSelectedSurface()
            if (selectedSurface == .waiting && !waitingCurrent) ||
                (selectedSurface == .someday && !somedayCurrent) {
                throw CocoaError(.coderReadCorrupt)
            }
            if !calendarPreferencePending { calendarComposerNavigation = nil }
        } catch {
            if projectRenameRequest != nil {
                await handleProjectRenameWriteError(error)
                return
            }
            if projectTaskOrderRequest != nil {
                await handleProjectTaskOrderError(error)
                return
            }
            if projectTaskSortRequest != nil {
                await handleProjectTaskSortWriteError(error)
                return
            }
            if projectFlowRequest != nil {
                await handleProjectFlowWriteError(error)
                return
            }
            if projectStatusRequest != nil {
                await handleProjectStatusWriteError(error)
                return
            }
            if projectDateRequest != nil {
                await handleProjectDateWriteError(error)
                return
            }
            if projectAreaRequest != nil {
                await handleProjectAreaWriteError(error)
                return
            }
            if projectTagsRequest != nil {
                await handleProjectTagsWriteError(error)
                return
            }
            if projectSectionRequest != nil {
                await handleProjectSectionWriteError(error)
                return
            }
            if projectSectionRenameRequest != nil {
                await handleProjectSectionRenameWriteError(error)
                return
            }
            if projectSectionDeleteRequest != nil {
                await handleProjectSectionDeleteWriteError(error)
                return
            }
            if projectSectionOrderRequest != nil {
                await handleProjectSectionOrderWriteError(error)
                return
            }
            if projectNotesWriteRequest != nil {
                await handleProjectNotesWriteError(error)
                return
            }
            if focusSavedFilterRequest != nil {
                await handleFocusSavedFilterError(error)
                return
            }
            if focusOrderRequest != nil {
                await handleFocusOrderError(error)
                return
            }
            if referenceSortRequest != nil {
                await handleReferenceSortError(error)
                return
            }
            if focusGroupRequest != nil {
                await handleFocusGroupWriteError(error)
                return
            }
            if taskFocusRequest != nil {
                await handleTaskFocusWriteError(error)
                return
            }
            if projectFocusRequest != nil {
                await handleProjectFocusWriteError(error)
                return
            }
            if areaRenameRequest != nil {
                await handleAreaRenameWriteError(error)
                return
            }
            if areaDeleteRequest != nil {
                await handleAreaDeleteWriteError(error)
                return
            }
            if areaOrderRequest != nil {
                await handleAreaOrderWriteError(error)
                return
            }
            if areaColorRequest != nil {
                await handleAreaColorWriteError(error)
                return
            }
            if areaCreateRequest != nil {
                await handleAreaCreateWriteError(error)
                return
            }
            if projectCreateRequest != nil {
                await handleProjectCreateWriteError(error)
                return
            }
            let mindSweepRefused = mindSweepRequest != nil && isDefiniteRejection(error)
            if isDefiniteRejection(error) {
                if processInboxRequest != nil {
                    processInboxRequest = nil
                    processInboxRequestMethod = nil
                    processInboxRequestID = nil
                    processInboxRequestTaskID = nil
                    processInboxError = error.localizedDescription
                }
                capturePending = false
                taskSavePending = false
                boardActionRequest = nil
                if mindSweepRequest != nil {
                    mindSweepRequest = nil
                    mindSweepRequestID = nil
                    mindSweepRequestGroup = nil
                    mindSweepAddFailed = true
                    self.error = nil
                }
                if calendarComposerSaveRequest != nil {
                    calendarComposerSaveRequest = nil
                    calendarComposerError = error.localizedDescription
                    self.error = nil
                }
                retryNeeded = false
                if calendarPreferencePending {
                    calendarPreferencePending = false
                    calendarPreferenceTarget = nil
                    calendarComposerNavigation = nil
                    calendarCurrent = false
                    calendarNeedsRead = true
                }
            }
            if taskPresented { taskError = error.localizedDescription }
            else if calendarComposerPresented {
                calendarComposerError = error.localizedDescription
                if retryNeeded { self.error = error.localizedDescription }
            }
            else if mindSweepPresented {
                if !mindSweepRefused { self.error = error.localizedDescription }
            }
            else if processInboxPresented {
                processInboxError = error.localizedDescription
                if retryNeeded { self.error = error.localizedDescription }
            }
            else { self.error = error.localizedDescription }
        }
    }

    private func handleCaptureResult(_ result: CoreObject) {
        switch result.text("kind") {
        case "saved":
            notice = nil
            captureID = UUID().uuidString
            if result.text("next") == "addAnother" {
                draft = result.object("reset").text("text")
                capture["options"] = result.object("reset").object("options")
                noteDraft = result.object("reset").object("options").text("note")
                previewedText = "\u{0}"
            } else {
                capturePresented = false
                capture = [:]
                draft = ""
                noteDraft = ""
            }
        case "refused": notice = result.object("notice").text("message")
        case "confirmLines":
            // Bulk import requires the snapshot/file IO contract, outside this foundation.
            bulkConfirm = result.object("confirm")
        default: notice = capture.object("failureNotices").object("save").text("message")
        }
    }

    private func readInbox() async throws {
        inbox = try await query("inboxView", [try json(["offset": 0, "limit": pageSize])])
    }

    func openFocusSavedFilter(_ operation: CoreObject, message: String = "") async {
        guard focusControlsEnabled, focusSavedFilterRequest == nil else { return }
        let controls = focus.object("controls")
        let saving = operation.text("type") == "save"
        var dialog = saving ? controls.object("filterSheet").object("save").object("dialog")
            : operation.text("type") == "delete" ? controls.object("savedFilters").object("deleteConfirm")
            : controls.object("filterSheet").object("removeConfirm")
        guard !dialog.isEmpty else { return }
        dialog["message"] = message
        focusSavedFilterOperation = operation
        focusSavedFilterDialog = dialog
        focusSavedFilterName = saving ? dialog.text("defaultName") : ""
        await readFocusSavedFilterOptions()
    }

    func closeFocusSavedFilter() {
        guard !busy, !retryNeeded, focusSavedFilterRequest == nil else { return }
        focusSavedFilterOperation = [:]
        focusSavedFilterDialog = [:]
        focusSavedFilterOptions = [:]
        focusSavedFilterName = ""
        focusSavedFilterError = nil
    }

    private func readFocusSavedFilterOptions() async {
        guard !busy, !retryNeeded, focusSavedFilterPresented, focusSavedFilterRequest == nil else { return }
        busy = true
        focusSavedFilterError = nil
        focusSavedFilterOptions = [:]
        defer { finishOperation() }
        do {
            focusReadTask?.cancel()
            focusGeneration += 1
            await readFocus(ownsOperation: true)
            guard focusCurrent else { throw CocoaError(.fileReadUnknown) }
            let options = try await query("focusSavedFilterOptions", [try json([
                "controls": focusState, "operation": focusSavedFilterOperation])])
            guard options.count == 3, !options.text("revision").isEmpty, !options.text("expected").isEmpty,
                  try json(options.object("controls")).utf8.elementsEqual(json(focusState).utf8) else {
                throw CocoaError(.coderReadCorrupt)
            }
            focusSavedFilterOptions = options
            // A refreshed conflict needs a confirmation showing the current target label.
            let operation = focusSavedFilterOperation
            let offered = operation.text("type") == "delete"
                ? focus.object("controls").object("savedFilters").object("chips").objects("items")
                    .first(where: { $0.text("id") == operation.text("id") })
                : focus.object("controls").object("filterSheet").objects("advancedChips")
                    .first(where: { $0.text("criterionId") == operation.text("criterionId") })
            if let offered, operation.text("type") != "save" { focusSavedFilterDialog["message"] = offered.text("label") }
        } catch { focusSavedFilterError = label("settings.feedback.actionFailed") }
    }

    func confirmFocusSavedFilter() async {
        guard focusSavedFilterCanConfirm else { return }
        busy = true
        focusSavedFilterError = nil
        focusReadTask?.cancel()
        focusGeneration += 1
        defer { finishOperation() }
        do {
            focusSavedFilterRequest = try json(["requestId": UUID().uuidString.lowercased(),
                "controls": focusSavedFilterOptions.object("controls"), "operation": focusSavedFilterOperation,
                "name": focusSavedFilterOperation.text("type") == "save" ? focusSavedFilterName as Any : NSNull(),
                "expected": focusSavedFilterOptions.text("expected")])
            try acknowledgeFocusSavedFilter(await query("focusSavedFilterWrite", [focusSavedFilterRequest!]))
            await readFocus(ownsOperation: true)
        } catch { await handleFocusSavedFilterError(error) }
    }

    private func acknowledgeFocusSavedFilter(_ result: CoreObject) throws {
        guard let request = focusSavedFilterRequest, let data = request.data(using: .utf8),
              let input = try NativeJSON.jsonObject(with: data) as? CoreObject else { throw CocoaError(.coderReadCorrupt) }
        let operation = input.object("operation")
        let kind = operation.text("type")
        let expectedID = kind == "save" ? input.text("requestId")
            : kind == "delete" ? operation.text("id") : input.object("controls").text("savedFilterId")
        let controls = result.object("controls")
        guard result.count == 2, !expectedID.isEmpty, result.text("id").utf8.elementsEqual(expectedID.utf8),
              controls.count == 3, !controls.object("filters").isEmpty, !controls.text("sortBy").isEmpty,
              controls["savedFilterId"] is String || controls["savedFilterId"] is NSNull else { throw CocoaError(.coderReadCorrupt) }
        focusState = controls
        focusLoadedDepth = [:]
        focusCurrent = false
        focusNeedsRead = true
        focusSavedFilterRequest = nil
        retryNeeded = false
        error = nil
        focusSavedFilterOperation = [:]
        focusSavedFilterDialog = [:]
        focusSavedFilterOptions = [:]
        focusSavedFilterName = ""
        focusSavedFilterError = nil
        if kind == "save" { focusPanel = ""; closeFocusPicker() }
    }

    private func handleFocusSavedFilterError(_ failure: Error) async {
        if focusSavedFilterRequest != nil && isDefiniteRejection(failure) {
            focusSavedFilterRequest = nil
            focusSavedFilterOptions = [:]
            retryNeeded = false
            await readFocus(ownsOperation: true)
        } else { retryNeeded = focusSavedFilterRequest != nil }
        focusSavedFilterError = label("settings.feedback.actionFailed")
    }

    func retryFocusSavedFilter() async {
        if retryNeeded { await retry() }
        else { await readFocusSavedFilterOptions() }
    }

    func openFocusOrder() async {
        guard focusActionsEnabled, !focus.object("controls").object("reorder").isEmpty else { return }
        busy = true
        focusOrderError = nil
        defer { finishOperation() }
        focusReadTask?.cancel()
        focusGeneration += 1
        await readFocus(ownsOperation: true)
        guard focusCurrent else { return }
        focusOrderPresented = true
        focusOrderShowHint = true
        await readFocusOrder(generation: focusGeneration, ownsOperation: true)
    }

    func closeFocusOrder() {
        guard !busy, !retryNeeded, focusOrderRequest == nil else { return }
        focusOrderPresented = false
        focusOrderCurrent = false
        focusOrderView = [:]
        focusOrderError = nil
    }

    private func readFocusOrder(generation: Int, ownsOperation: Bool) async {
        guard focusOrderPresented, focusOrderRequest == nil else { return }
        focusOrderCurrent = false
        do {
            let next = try await query("focusOrderOptions", [try json(["controls": focusState])])
            guard focusReadAllowed(generation, ownsOperation: ownsOperation), focusOrderPresented,
                  focusOrderRequest == nil else { return }
            let rows = next.objects("rows")
            guard next.count == 5, !next.text("revision").isEmpty,
                  next["canReorder"] is Bool, next["rows"] is [CoreObject],
                  rows.count <= 100, Set(rows.map { $0.text("id") }).count == rows.count,
                  rows.allSatisfy({ !$0.text("id").isEmpty }),
                  try json(next.object("controls")).utf8.elementsEqual(json(focusState).utf8),
                  !next.flag("canReorder") || (!rows.isEmpty && !next.text("expectedOrder").isEmpty) else {
                throw CocoaError(.coderReadCorrupt)
            }
            focusOrderView = next
            focusOrderCurrent = true
            focusOrderError = nil
            if !next.flag("canReorder") { focusOrderPresented = false }
        } catch {
            guard focusReadAllowed(generation, ownsOperation: ownsOperation), focusOrderPresented else { return }
            focusOrderError = label("settings.feedback.actionFailed")
        }
    }

    func retryFocusOrder() async {
        if retryNeeded { await retry(); return }
        guard !busy, focusOrderPresented, selectedSurface == .focus else { return }
        busy = true
        defer { finishOperation() }
        focusReadTask?.cancel()
        focusGeneration += 1
        await readFocus(ownsOperation: true)
    }

    func moveFocusTask(from source: IndexSet, to destination: Int) async {
        guard focusOrderInputEnabled, source.count == 1, let index = source.first else { return }
        var ids = focusOrderView.objects("rows").map { $0.text("id") }
        guard ids.indices.contains(index), (0...ids.count).contains(destination),
              destination != index, destination != index + 1 else { return }
        ids.move(fromOffsets: source, toOffset: destination)
        await saveFocusOrder(ids)
    }

    func moveFocusTask(_ row: CoreObject, up: Bool) async {
        guard focusOrderInputEnabled, let ids = row[up ? "moveUp" : "moveDown"] as? [String] else { return }
        await saveFocusOrder(ids)
    }

    private func saveFocusOrder(_ ids: [String]) async {
        guard focusOrderInputEnabled else { return }
        focusOrderShowHint = false
        busy = true
        focusOrderError = nil
        focusReadTask?.cancel()
        focusGeneration += 1
        defer { finishOperation() }
        do {
            focusOrderRequest = try json(["requestId": UUID().uuidString.lowercased(),
                "controls": focusOrderView.object("controls"), "ids": ids,
                "expectedOrder": focusOrderView.text("expectedOrder")])
            try acknowledgeFocusOrder(await query("focusOrderWrite", [focusOrderRequest!]))
            UISelectionFeedbackGenerator().selectionChanged()
            await readFocus(ownsOperation: true)
        } catch { await handleFocusOrderError(error) }
    }

    private func acknowledgeFocusOrder(_ result: CoreObject) throws {
        guard let request = focusOrderRequest, let data = request.data(using: .utf8),
              let input = try NativeJSON.jsonObject(with: data) as? CoreObject,
              result.count == 1, let ids = result["ids"] as? [String],
              let requested = input["ids"] as? [String],
              try json(ids).utf8.elementsEqual(json(requested).utf8) else { throw CocoaError(.coderReadCorrupt) }
        focusOrderRequest = nil
        focusOrderCurrent = false
        focusOrderError = nil
        focusCurrent = false
        focusLoadedDepth = [:]
        retryNeeded = false
        error = nil
    }

    private func handleFocusOrderError(_ failure: Error) async {
        if focusOrderRequest != nil && isDefiniteRejection(failure) {
            focusOrderRequest = nil
            retryNeeded = false
            await readFocus(ownsOperation: true)
        } else { retryNeeded = focusOrderRequest != nil }
        focusOrderError = label("settings.feedback.actionFailed")
    }

    func openFocusPanel(_ name: String) {
        guard focusControlsEnabled, ["view", "filters"].contains(name) else { return }
        focusPanel = name
    }

    func closeFocusPanel() {
        guard !busy, !retryNeeded, focusGroupRequest == nil, !focusSavedFilterPresented else { return }
        focusPanel = ""
        closeFocusPicker()
    }

    func setFocusGroup(_ groupBy: String) async {
        guard focusControlsEnabled, focusPanel == "view", focusGroupRequest == nil else { return }
        busy = true
        focusGroupError = nil
        defer { finishOperation() }
        do {
            // Drain accepted filter/sort edits before freezing the checked request.
            focusReadTask?.cancel()
            focusGeneration += 1
            await readFocus(ownsOperation: true)
            guard focusCurrent else { throw CocoaError(.fileReadUnknown) }
            let options = try await query("focusGroupOptions", [try json(["controls": focusState])])
            let controls = options.object("controls")
            let expected = options.object("expected")
            guard options.count == 4, !options.text("revision").isEmpty,
                  !controls.isEmpty, expected.count == 2,
                  expected["groupBy"] is String || expected["groupBy"] is NSNull,
                  expected["updatedAt"] is String || expected["updatedAt"] is NSNull,
                  options.objects("choices").contains(where: { $0.text("value") == groupBy }),
                  try json(controls).utf8.elementsEqual(json(focusState).utf8) else {
                throw CocoaError(.coderReadCorrupt)
            }
            var detached = controls
            detached["savedFilterId"] = NSNull()
            focusGroupExpectedResult = ["groupBy": groupBy, "controls": detached]
            let request = try json(["requestId": UUID().uuidString.lowercased(), "controls": controls,
                                    "groupBy": groupBy, "expected": expected])
            focusGroupRequest = request
            try acknowledgeFocusGroup(await query("focusGroupWrite", [request]))
            await readFocus(ownsOperation: true)
        } catch { await handleFocusGroupWriteError(error) }
    }

    private func acknowledgeFocusGroup(_ result: CoreObject) throws {
        guard focusGroupRequest != nil, let expected = focusGroupExpectedResult,
              try json(result).utf8.elementsEqual(json(expected).utf8) else {
            throw CocoaError(.coderReadCorrupt)
        }
        focusState = result.object("controls")
        focusLoadedDepth = [:]
        focusCurrent = false
        focusNeedsRead = true
        focusGroupRequest = nil
        focusGroupExpectedResult = nil
        focusGroupError = nil
        retryNeeded = false
        error = nil
    }

    private func handleFocusGroupWriteError(_ failure: Error) async {
        if focusGroupRequest != nil && isDefiniteRejection(failure) {
            focusGroupRequest = nil
            focusGroupExpectedResult = nil
            retryNeeded = false
            await readFocus(ownsOperation: true)
        } else { retryNeeded = focusGroupRequest != nil }
        focusGroupError = label(retryNeeded ? "settings.feedback.saveFailed" : "settings.feedback.actionFailed")
    }

    func retryFocusGroup() async {
        if retryNeeded { await retry() }
        else {
            focusGroupError = nil
            retryFocus()
        }
    }

    func toggleFocusShowDetails() {
        guard focusControlsEnabled else { return }
        focusShowDetails.toggle()
        preferenceDefaults.set(focusShowDetails, forKey: focusShowDetailsPreference)
    }

    func toggleFocusSection(_ key: String) {
        guard focusControlsEnabled, focusSectionKeys.contains(key) else { return }
        if !collapsedFocusSections.insert(key).inserted { collapsedFocusSections.remove(key) }
        saveFocusExpandedSections()
    }

    func toggleOtherFocusSections() {
        let otherKeys = focusSectionKeys.filter { $0 != "focus" }
        let visible = Set(focus.objects("sections").filter { $0.number("total") > 0 }.map { $0.text("key") })
            .union(focus.objects("reviewProjects").isEmpty ? [] : ["reviewProjects"])
        let visibleOthers = visible.intersection(Set(otherKeys))
        guard focusControlsEnabled, !visibleOthers.isEmpty else { return }
        if visibleOthers.contains(where: { !collapsedFocusSections.contains($0) }) {
            collapsedFocusSections.formUnion(otherKeys)
        } else {
            collapsedFocusSections.subtract(otherKeys)
        }
        collapsedFocusSections.remove("focus")
        saveFocusExpandedSections()
    }

    private func saveFocusExpandedSections() {
        preferenceDefaults.set(Dictionary(uniqueKeysWithValues: focusSectionKeys.map {
            ($0, !collapsedFocusSections.contains($0))
        }), forKey: focusExpandedSectionsPreference)
    }

    func editFocusControl(_ edit: CoreObject) {
        guard focusControlsEnabled, !edit.isEmpty else { return }
        enqueueFocusEdit(["edit": edit])
        focusLoadedDepth = [:]
        requestFocusRead(delay: 0)
    }

    func selectFocusSavedFilter(_ id: String) {
        guard focusControlsEnabled, focus.object("controls").object("savedFilters").object("chips").objects("items")
            .contains(where: { $0.text("id") == id }) else { return }
        // A saved chip's edit changes from apply to clear when selected. Resolve
        // each queued tap against current core controls, including rapid repeats.
        enqueueFocusEdit(["savedID": id])
        focusLoadedDepth = [:]
        requestFocusRead(delay: 0)
    }

    func setFocusLocation(_ text: String) {
        guard selectedSurface == .focus, !retryNeeded, !taskPresented, focusLocationText != text else { return }
        focusLocationText = text
        let entry: CoreObject = ["edit": ["type": "filter", "edit": ["type": "setLocation", "value": text]]]
        enqueueFocusEdit(entry)
        focusLoadedDepth = [:]
        requestFocusRead()
    }

    private func focusFilterEditType(_ entry: CoreObject) -> String {
        let edit = entry.object("edit")
        return edit.text("type") == "filter" ? edit.object("edit").text("type") : ""
    }

    private func enqueueFocusEdit(_ entry: CoreObject) {
        focusEditSequence += 1
        var next = entry
        next["sequence"] = focusEditSequence
        let kind = focusFilterEditType(next)
        // Only a core-refused location may be discarded. Put the explicit
        // correction/Clear after intervening edits, preserving accepted order.
        if kind == "setLocation" || kind == "clear", let refused = focusRefusedLocationID {
            focusEdits.removeAll { $0.number("sequence") == refused }
            focusRefusedLocationID = nil
        }
        if kind == "setLocation", let last = focusEdits.last, focusFilterEditType(last) == kind {
            focusEdits[focusEdits.count - 1] = next
        } else { focusEdits.append(next) }
    }

    func openFocusPicker(_ name: String) {
        guard focusControlsEnabled, ["tokens", "projects"].contains(name) else { return }
        focusPickerName = name
        focusPickerQuery = ""
        focusPickerDepth = 100
        focusPicker = focus.object("controls").object("filterSheet").object(name)
        focusPickerPublishedName = name
        focusPickerPublishedQuery = ""
        focusPickerCurrent = focusCurrent
        if !focusCurrent { requestFocusRead(delay: 0) }
    }

    func closeFocusPicker() {
        focusPickerName = ""
        focusPickerQuery = ""
        focusPickerCurrent = false
        // A response belonging to the closed picker must not replace a later one.
        if focusLoading { requestFocusRead(delay: 0) }
    }

    func setFocusPickerQuery(_ text: String) {
        guard !focusPickerName.isEmpty, !retryNeeded, text != focusPickerQuery else { return }
        focusPickerQuery = text
        focusPickerDepth = 100
        requestFocusRead()
    }

    func loadMoreFocusControls(saved: Bool = false) {
        guard (saved ? focusControlsEnabled : focusPickerActionsEnabled) else { return }
        let list = saved ? focus.object("controls").object("savedFilters").object("chips") : focusPicker
        guard list.objects("items").count < list.number("total") else { return }
        if saved { focusSavedDepth = list.objects("items").count + 100 }
        else { focusPickerDepth = list.objects("items").count + 100 }
        requestFocusRead(delay: 0)
    }

    func retryFocus() {
        guard selectedSurface == .focus, !busy, !retryNeeded, !taskPresented else { return }
        requestFocusRead(delay: 0)
    }

    private func requestFocusRead(delay: UInt64 = 150_000_000) {
        focusGeneration += 1
        focusReadTask?.cancel()
        focusCurrent = false
        focusOrderCurrent = false
        focusPickerCurrent = false
        focusLoading = true
        focusError = nil
        focusNeedsRead = true
        scheduleFocusRead(delay: delay)
    }

    private func scheduleFocusRead(delay: UInt64 = 150_000_000) {
        guard selectedSurface == .focus, !busy, !retryNeeded, !taskPresented, !areaPickerPresented else { return }
        focusReadTask?.cancel()
        focusReadTask = Task {
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard !Task.isCancelled, selectedSurface == .focus, !busy, !retryNeeded, !taskPresented, !areaPickerPresented else { return }
            await readFocus()
        }
    }

    private func focusReadAllowed(_ generation: Int, ownsOperation: Bool) -> Bool {
        !Task.isCancelled && generation == focusGeneration && selectedSurface == .focus && !retryNeeded
            && !taskPresented && (ownsOperation || (!busy && !areaPickerPresented))
    }

    private func focusPage(state: CoreObject, edit: CoreObject? = nil) async throws -> CoreObject {
        #if DEBUG && targetEnvironment(simulator)
        if focusInitialReadFailures > 0 {
            focusInitialReadFailures -= 1
            throw CocoaError(.fileReadUnknown)
        }
        #endif
        var input: CoreObject = ["limit": pageSize, "controls": state]
        if let edit { input["controlEdit"] = edit }
        return try await query("menuRead", ["focus", try json(input)])
    }

    private func focusControlList(_ name: String, snapshot: CoreObject, query text: String? = nil,
                                  depth: Int) async throws -> CoreObject {
        let state = snapshot.object("controls").object("state")
        let revision = snapshot.text("revision")
        var items: [CoreObject] = []
        var result: CoreObject = [:]
        repeat {
            var input: CoreObject = ["controls": state, "list": name, "offset": items.count,
                                     "limit": 100, "revision": revision]
            if let text { input["query"] = text }
            let page = try await query("menuRead", ["focusControls", try json(input)])
            try Task.checkCancellation()
            guard page.text("revision") == revision, page.text("list") == name, page.number("total") >= items.count,
                  page.objects("items").count == min(100, page.number("total") - items.count),
                  result.isEmpty || page.number("total") == result.number("total") else { throw CocoaError(.coderReadCorrupt) }
            result = page
            items += page.objects("items")
        } while items.count < min(depth, result.number("total"))
        result["items"] = items
        return result
    }

    private func readFocus(ownsOperation: Bool = false) async {
        let generation = focusGeneration
        let edits = focusEdits
        let pickerName = focusPickerName
        let pickerQuery = focusPickerQuery
        let pickerDepth = focusPickerDepth
        let savedDepth = focusSavedDepth
        let loaded = focusLoadedDepth
        focusNeedsRead = false
        focusCurrent = false
        focusOrderCurrent = false
        focusPickerCurrent = false
        focusLoading = true
        focusError = nil
        defer { if generation == focusGeneration { focusLoading = false } }
        for attempt in 0..<2 {
            do {
                var next = try await focusPage(state: focusState)
                guard focusReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                for entry in edits {
                    var edit = entry.object("edit")
                    if !entry.text("savedID").isEmpty {
                        let saved = try await focusControlList("savedFilters", snapshot: next, depth: savedDepth)
                        guard focusReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                        guard let choice = saved.objects("items").first(where: { $0.text("id") == entry.text("savedID") }) else { continue }
                        edit = choice.object("edit")
                    }
                    do {
                        next = try await focusPage(state: next.object("controls").object("state"), edit: edit)
                    } catch {
                        guard focusReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                        // This is a pure read: INVALID_INPUT is a definite
                        // refusal, not an uncertain write or transport failure.
                        if focusFilterEditType(entry) == "setLocation", error.localizedDescription.hasPrefix("INVALID_INPUT:") {
                            let sequence = entry.number("sequence")
                            if edits.contains(where: {
                                $0.number("sequence") > sequence && ["setLocation", "clear"].contains(focusFilterEditType($0))
                            }) {
                                focusEdits.removeAll { $0.number("sequence") == sequence }
                                continue
                            }
                            focusRefusedLocationID = sequence
                            focusError = error.localizedDescription
                            return
                        }
                        throw error
                    }
                    guard focusReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                }
                let revision = next.text("revision")
                let state = next.object("controls").object("state")
                guard !revision.isEmpty, !state.isEmpty else { throw CocoaError(.coderReadCorrupt) }
                var sections = next.objects("sections")
                for index in sections.indices {
                    let key = sections[index].text("key")
                    let total = sections[index].number("rowTotal")
                    var rows = sections[index].objects("rows")
                    var groups = sections[index].objects("groups")
                    guard sections[index]["rowTotal"] is NSNumber, total >= 0,
                          rows.count == min(pageSize, total) else { throw CocoaError(.coderReadCorrupt) }
                    let target = min(max(pageSize, loaded[key] ?? pageSize), total)
                    while rows.count < target {
                        let limit = min(pageSize, target - rows.count)
                        let window = try await query("menuRead", ["focusSection", try json([
                            "key": key, "offset": rows.count, "limit": limit, "revision": revision, "controls": state])])
                        guard focusReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                        guard window.text("revision") == revision, window.text("key") == key,
                              window.number("total") == sections[index].number("total"), window.number("rowTotal") == total,
                              window.objects("rows").count == limit else { throw CocoaError(.coderReadCorrupt) }
                        // Group starts are absolute section indices; never add the window offset.
                        groups += window.objects("groups")
                        rows += window.objects("rows")
                    }
                    sections[index]["rows"] = rows
                    if sections[index]["groups"] is [CoreObject] { sections[index]["groups"] = groups }
                }
                next["sections"] = sections
                var controls = next.object("controls")
                var saved = controls.object("savedFilters")
                if !saved.isEmpty && saved.object("chips").objects("items").count < min(savedDepth, saved.object("chips").number("total")) {
                    saved["chips"] = try await focusControlList("savedFilters", snapshot: next, depth: savedDepth)
                    controls["savedFilters"] = saved
                    next["controls"] = controls
                }
                var picker: CoreObject = [:]
                if !pickerName.isEmpty {
                    picker = try await focusControlList(pickerName, snapshot: next, query: pickerQuery, depth: pickerDepth)
                }
                guard focusReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                focusState = state
                focusEdits.removeAll()
                focusRefusedLocationID = nil
                focusLocationText = controls.object("filterSheet").text("location")
                focus = next
                focusCurrent = true
                if !edits.isEmpty {
                    NSLog("Native iOS Focus controls applied releaseCheck=v1.3.3/native-ios-focus-controls")
                }
                if !pickerName.isEmpty {
                    focusPicker = picker
                    focusPickerPublishedName = pickerName
                    focusPickerPublishedQuery = pickerQuery
                    focusPickerCurrent = true
                }
                if focusOrderPresented { await readFocusOrder(generation: generation, ownsOperation: ownsOperation) }
                return
            } catch {
                guard focusReadAllowed(generation, ownsOperation: ownsOperation) else { return }
                if attempt == 1 { focusError = error.localizedDescription }
            }
        }
    }

    private func readSelectedSurface() async throws {
        if selectedSurface == .board {
            boardReadTask?.cancel()
            boardGeneration += 1
            boardCurrent = false
        }
        if selectedSurface == .calendar { calendarCurrent = false }
        if selectedSurface == .review { reviewCurrent = false }
        if selectedSurface == .focus {
            focusReadTask?.cancel()
            focusGeneration += 1
            focusCurrent = false
        }
        if selectedSurface == .project { projectCurrent = false }
        if selectedSurface == .waiting { waitingCurrent = false }
        if selectedSurface == .someday { somedayCurrent = false }
        if selectedSurface == .reference { referenceCurrent = false }
        if selectedSurface == .history { historyCurrent = false }
        if selectedSurface == .trash { trashCurrent = false }
        if selectedSurface == .contexts {
            contextsReadTask?.cancel()
            contextsGeneration += 1
            contextsCurrent = false
        }
        area = try await query("areaFilter")
        moreMenu = try await query("menuRead", ["more", "{}"])
        switch selectedSurface {
        case .inbox: try await readInbox()
        case .focus: await readFocus(ownsOperation: true)
        case .review: await readReview()
        case .calendar: await readCalendar()
        case .board: await readBoard(ownsOperation: true)
        case .projects: try await readProjectsWithCreateOptions()
        case .project:
            await readProjectDetail()
            if projectTaskOrderPresented { await readProjectTaskOrder() }
            if projectNotesExpanded && projectCurrent {
                if projectNotesEditMode {
                    do { try await readProjectNotesEditOptions() }
                    catch { projectNotesEditReadError = error.localizedDescription }
                }
                await readProjectNotes()
            }
        case .waiting: await readWaiting()
        case .contexts: await readContexts(ownsOperation: true)
        case .someday: await readSomeday()
        case .reference: await readReference()
        case .history: await readHistory()
        case .trash: await readTrash()
        case .search:
            invalidateSearch()
            await readSearch(generation: searchGeneration, ownsOperation: true)
        }
    }

    private func query(_ method: String, _ args: [Any] = []) async throws -> CoreObject {
        guard let host else { throw CocoaError(.coderInvalidValue) }
        #if DEBUG && targetEnvironment(simulator)
        if method == "taskListSortOptions", referenceSortTestReadFailure {
            referenceSortTestReadFailure = false
            throw CocoaError(.fileReadUnknown)
        }
        if method == "menuRead", args.first as? String == "projectDetailFilterView",
           pendingProjectView != nil, projectViewTestReadFailures > 0 {
            projectViewTestReadFailures -= 1
            throw CocoaError(.fileReadUnknown)
        }
        if method == "menuRead", args.first as? String == "projects",
           pendingProjectTagFilter != nil, projectTagTestReadFailure {
            projectTagTestReadFailure = false
            throw CocoaError(.fileReadUnknown)
        }
        if method == "menuRead", args.first as? String == "reference",
           referenceViewPreferencePending, referenceViewTestReadFailures > 0 {
            referenceViewTestReadFailures -= 1
            throw CocoaError(.fileReadUnknown)
        }
        if method == "menuRead", ["done", "archive"].contains(args.first as? String ?? ""),
           historyViewPreferencePending.contains(args.first as? String ?? ""), historyViewTestReadFailures > 0 {
            historyViewTestReadFailures -= 1
            throw CocoaError(.fileReadUnknown)
        }
        if method == "menuRead", args.first as? String == "boardList",
           boardPendingEdit != nil, boardPickerTestReadFailures > 0 {
            boardPickerTestReadFailures -= 1
            throw CocoaError(.fileReadUnknown)
        }
        if projectAreaCreatedID != nil {
            if method == "projectAreaOptions", projectAreaTestReadFailure {
                projectAreaTestReadFailure = false
                throw CocoaError(.fileReadUnknown)
            }
            if method == "projectAreaWrite", projectAreaTestBlockedWrite {
                projectAreaTestBlockedWrite = false
                return ["blocked": ""]
            }
        }
        #endif
        let result = try await host.call(method, argumentsJSON: json(args))
        return try decode(result)
    }

    private func decode(_ result: String) throws -> CoreObject {
        guard let object = try NativeJSON.jsonObject(with: Data(result.utf8)) as? CoreObject else {
            throw CocoaError(.coderReadCorrupt)
        }
        return object
    }

    private func json(_ value: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
    }

    private func invalidatePreview() { previewGeneration += 1; previewTask?.cancel() }
    private func isDefiniteRejection(_ error: Error) -> Bool {
        error is CoreHostRejection
    }
    private func finishOperation() {
        busy = false
        if taskPresented && !retryNeeded {
            startTaskSchedulePump()
            for field in taskTokenFields where taskTokenNeedsRead.contains(field) { requestTaskTokenRead(field, delay: 0) }
        }
        if taskPresented && taskDestinationNeedsRead && !retryNeeded { requestTaskDestinationRead(delay: 0) }
        if capturePresented && (!captureIsCurrent || (contextPickerPresented && !contextPickerReady)) { textChanged() }
        if refreshRequested {
            refreshRequested = false
            Task { await refresh() }
        }
        if selectedSurface == .board && boardNeedsRead && !retryNeeded && !taskPresented { scheduleBoardRead() }
        if selectedSurface == .calendar && calendarNeedsRead && !retryNeeded && !taskPresented
            && !calendarComposerPresented { scheduleCalendarRead() }
        if selectedSurface == .focus && focusNeedsRead && !retryNeeded && !taskPresented { scheduleFocusRead() }
        if selectedSurface == .contexts && contextsNeedsRead && !retryNeeded && !taskPresented {
            scheduleContextsRead()
        }
        if selectedSurface == .search && searchNeedsRead && !retryNeeded && !taskPresented {
            scheduleSearch()
        }
        if selectedSurface == .someday && (somedayTextNeedsRead || somedayPickerNeedsRead) && !retryNeeded && !taskPresented {
            scheduleSomedayRead()
        }
        if selectedSurface == .history && (historyNeedsRead || historyPickerNeedsRead) && !retryNeeded && !taskPresented {
            scheduleHistoryRead()
        }
        if selectedSurface == .reference && (referenceTextNeedsRead || referencePickerNeedsRead) && !retryNeeded && !taskPresented {
            scheduleReferenceRead()
        }
        if selectedSurface == .project && !retryNeeded && !taskPresented
            && (projectFilterNeedsRead || ((projectFilterTextEdits.isEmpty == false || projectFilterPickerNeedsRead)
                && projectError == nil && projectFilterError == nil)) {
            scheduleProjectFilterRead(delay: 0)
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

private struct TaskScheduleEdit {
    let id: Int
    let control: String
    let edit: CoreObject
    let coalesces: Bool
}
