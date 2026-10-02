import Foundation
import JavaScriptCore
import Security
import Darwin

/// Core refused a command before writing, and its pending journal is now clear.
/// Other errors, even with the same core code, may still require exact retry.
public struct CoreHostRejection: LocalizedError, Sendable {
    public let message: String
    public var errorDescription: String? { message }
}

/// Recovery could not prove this authenticated request landed; no replay write was attempted.
public struct CoreHostAppLockRecovery: LocalizedError, Sendable {
    public var errorDescription: String? { "App lock outcome is unknown. Cancel the pending change to use the saved setting." }
}

/// One off-main owner for the core runtime, database and pending command journal.
/// Every result is the JSON-encoded core value, with host/core failures thrown.
public final class CoreHost: @unchecked Sendable {
    private let queue = DispatchQueue(label: "tech.dongdongbh.mindwtr.native-core", qos: .userInitiated)
    private let engine: Engine

    public init(databaseURL: URL, bundleURL: URL) {
        engine = Engine(queue: queue, databaseURL: databaseURL, bundleURL: bundleURL)
    }

    #if DEBUG
    public convenience init(databaseURL: URL, bundleURL: URL, legacyStorage: LegacyRNStorage) {
        self.init(databaseURL: databaseURL, bundleURL: bundleURL, faults: HostIOFaults(), legacyStorage: legacyStorage)
    }

    init(databaseURL: URL, bundleURL: URL, faults: HostIOFaults, legacyStorage: LegacyRNStorage? = nil) {
        engine = Engine(queue: queue, databaseURL: databaseURL, bundleURL: bundleURL, legacyStorage: legacyStorage)
        engine.faults = faults
    }
    #endif

    public func start() async throws -> String { try await perform { try $0.start() } }

    public func call(_ method: String, argumentsJSON: String = "[]") async throws -> String {
        try await perform { try $0.call(method, argumentsJSON: argumentsJSON) }
    }

    public func readEditorDraft() async throws -> EditorDraftSnapshot? {
        try await perform { try $0.readEditorDraft() }
    }

    public func checkpointEditorDraft(_ snapshot: EditorDraftSnapshot) async throws {
        try await perform { try $0.checkpointEditorDraft(snapshot) }
    }

    public func discardEditorDraft(expectedSession: String) async throws {
        try await perform { try $0.discardEditorDraft(expectedSession: expectedSession) }
    }

    public func discardCorruptEditorDraft() async throws {
        try await perform { try $0.discardCorruptEditorDraft() }
    }

    public func saveEditorDraft(_ method: String, argumentsJSON: String,
                                expectedSession: String, expectedGeneration: Int) async throws -> String {
        try await perform { try $0.saveEditorDraft(method, argumentsJSON: argumentsJSON,
                                                   expectedSession: expectedSession,
                                                   expectedGeneration: expectedGeneration) }
    }

    @discardableResult
    public func retryPending() async throws -> String? { try await perform { try $0.retryPending() } }

    public func cancelAppLockRecovery() async throws { try await perform { try $0.cancelAppLockRecovery() } }

    public func close() async {
        await withCheckedContinuation { continuation in
            queue.async { [engine] in
                engine.shutdown()
                continuation.resume()
            }
        }
    }

    private func perform<T: Sendable>(_ work: @escaping @Sendable (Engine) throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { [engine] in
                do { continuation.resume(returning: try work(engine)) }
                catch { continuation.resume(throwing: error) }
            }
        }
    }

    deinit { queue.async { [engine] in engine.shutdown() } }
}

private struct PendingCommand: Codable {
    let version: Int
    let method: String
    let argumentsJSON: String
    var terminal: TerminalResult? = nil
    var editorDraft: EditorDraftAttempt? = nil
}

private enum TerminalResult: Codable {
    case success(String)
    case rejected(String)

    func value() throws -> String {
        switch self {
        case .success(let value): return value
        case .rejected(let message): throw CoreHostRejection(message: message)
        }
    }
}

// DispatchQueue may move between threads; every entry point enforces queue
// ownership. The public facade holds only immutable references and schedules all
// access here. No JSValue, JSContext or SQLite handle crosses this boundary.
private final class Engine: @unchecked Sendable {
    private let queue: DispatchQueue
    private let databaseURL: URL
    private let bundleURL: URL
    private let journalURL: URL
    private let editorDrafts: EditorDraftStore
    private let legacyStorage: LegacyRNStorage?
    private var context: JSContext?
    private var database: SQLiteBridge?
    private var lockFD: Int32 = -1
    private var started = false
    private var recoveryActivationPending = false
    private var unresolvedAppLockRecovery = false
    private var closed = false
    private var pending: PendingCommand?
    // Authorizes one interactive Commit; after journaling, the journal owns exact replay.
    private var preparedSomedaySectionTaskEnvelope: Data?
    private var confirmedTaskCancellationEnvelope: String?
    private var confirmedTaskDeleteEnvelope: String?
    private var confirmedSomedaySectionMoveEnvelope: String?
    private var confirmedSomedaySectionUndoEnvelope: String?
    private var boardReadLogged = false
    private var boardActionLogged = false
    private var startupBoardResult: String?
    private var startupTaskDeleteResult: String?
    private var startupTaskPromoteResult: String?
    private var startupCalendarResult: String?
    private var startupMindSweepResult: String?
    private var startupProjectCreateResult: String?
    private var startupProjectSectionCreateResult: String?
    private var startupProjectSectionRenameResult: String?
    private var startupProjectSectionDeleteResult: String?
    private var startupProjectSectionOrderResult: String?
    private var startupAppLockResult: String?
    private var startupGtdWorkflowResult: String?
    private var startupGeneralPreferenceResult: String?
    private var startupTaxonomyResult: String?
    private var startupPersonEditResult: String?
    private var startupPersonDeleteResult: String?
    private var startupPersonCreateResult: String?
    private var startupAreaCreateResult: String?
    private var startupAreaColorResult: String?
    private var startupAreaRenameResult: String?
    private var startupAreaOrderResult: String?
    private var startupAreaDeleteResult: String?
    private var startupProjectFocusResult: String?
    private var startupTaskFocusResult: String?
    private var startupFocusOrderResult: String?
    private var startupFocusSavedFilterResult: String?
    private var startupCalendarDeleteResult: String?
    private var startupCalendarUnscheduleResult: String?
    private var startupSavedSearchResult: String?
    private var startupProjectRenameResult: String?
    private var startupProjectFlowResult: String?
    private var startupProjectTaskSortResult: String?
    private var startupProjectTaskOrderResult: String?
    private var startupProjectNotesWriteResult: String?
    private var startupProjectTagsWriteResult: String?
    private var startupProjectAttachmentWriteResult: String?
    private var startupProjectStatusResult: String?
    private var startupProjectDateResult: String?
    private var startupProjectAreaResult: String?
    private var startupInboxResult: String?
    private var startupChecklistResult: String?
    private var startupFocusGroupResult: String?
    private var startupTaskListSortResult: String?
    private var startupUnassignedAreaColorResult: String?
    private var startupSomedaySectionCreateResult: String?
    private var startupSomedaySectionRenameResult: String?
    private var startupSomedaySectionDeleteResult: String?
    private var startupSomedaySectionOrderResult: String?
    private var startupSomedaySectionTaskResult: String?
    private var startupSomedaySectionMoveResult: String?
    private var startupSomedaySectionUndoResult: String?
    #if DEBUG
    var faults: HostIOFaults?
    #endif

    private static let methods: [String: Int] = [
        "window": 3, "inboxView": 1, "focus": 1, "focusWindow": 4, "theme": 1, "areaFilter": 0, "setAreaFilter": 1,
        "captureOpen": 0, "captureView": 1, "captureEdit": 1, "captureSubmit": 1,
        "language": 2, "languageSaved": 2, "strings": 1, "complete": 1, "taskView": 1, "taskShare": 1, "taskViewReferenceTarget": 1, "editorModel": 1, "taskEditorDraftDirection": 1, "taskEditorResumeCheck": 1, "taskAttachmentList": 1, "taskAttachmentOpen": 1, "taskAttachmentLinks": 1, "taskAttachmentRemove": 1, "editDraft": 1, "saveDraft": 1, "search": 1,
        "projects": 0, "projectDetail": 4, "projectNotes": 4, "projectAttachmentList": 1, "projectAttachmentOpen": 1, "projectCreateOptions": 0, "projectCreate": 1, "projectCreateRetryOutcome": 1,
        "projectSectionOptions": 1, "projectSectionCreate": 1, "projectSectionCreateRetryOutcome": 1,
        "projectSectionRenameOptions": 1, "projectSectionRename": 1, "projectSectionRenameRetryOutcome": 1,
        "projectSectionDeleteOptions": 1, "projectSectionDelete": 1, "projectSectionDeleteRetryOutcome": 1,
        "projectSectionOrderOptions": 1, "projectSectionOrder": 1, "projectSectionOrderRetryOutcome": 1,
        "appLockOptions": 1, "appLock": 1, "appLockRetryOutcome": 1,
        "gtdWorkflowOptions": 1, "gtdArchiveOptions": 1, "gtdReviewOptions": 1, "gtdInboxOptions": 1, "gtdCaptureAreaOptions": 1, "gtdCaptureParseOptions": 1, "gtdTaskEditorOpenOptions": 1, "gtdTaskEditorPresetOptions": 1, "gtdWorkflowDraft": 1, "gtdWorkflow": 1, "gtdWorkflowRetryOutcome": 1,
        "generalPreferenceOptions": 1, "generalPreference": 1, "generalPreferenceRetryOutcome": 1,
        "manageTaxonomyOptions": 1, "manageTaxonomy": 1, "manageTaxonomyRetryOutcome": 1,
        "managePersonEditOptions": 1, "managePersonEdit": 1, "managePersonEditRetryOutcome": 1,
        "managePersonDeleteOptions": 1, "managePersonDelete": 1, "managePersonDeleteRetryOutcome": 1,
        "managePersonCreateResolve": 1, "managePersonCreate": 1, "managePersonCreateRetryOutcome": 1,
        "areaCreateOptions": 0, "areaCreateResolve": 1, "areaCreate": 1, "manageAreaCreate": 1, "areaCreateRetryOutcome": 1,
        "areaColorOptions": 0, "areaColor": 1, "areaColorRetryOutcome": 1,
        "areaRename": 1, "areaRenameRetryOutcome": 1, "manageAreaEdit": 1, "manageAreaEditRetryOutcome": 1,
        "areaOrderOptions": 0, "areaOrder": 1, "areaOrderRetryOutcome": 1,
        "areaDeleteOptions": 0, "areaDelete": 1, "areaDeleteRetryOutcome": 1,
        "manageAreaDelete": 1, "manageAreaDeleteRetryOutcome": 1,
        "projectFocusOptions": 1, "projectFocusWrite": 1, "projectFocusRetryOutcome": 1,
        "focusGroupOptions": 1, "focusGroupWrite": 1, "focusGroupRetryOutcome": 1,
        "taskListSortOptions": 1, "taskListSortWrite": 1, "taskListSortRetryOutcome": 1,
        "unassignedAreaColorOptions": 1, "unassignedAreaColorWrite": 1, "unassignedAreaColorRetryOutcome": 1,
        "somedaySectionCreateOptions": 1, "somedaySectionCreateWrite": 1, "somedaySectionCreateRetryOutcome": 1,
        "somedaySectionRenameOptions": 1, "somedaySectionRenameWrite": 1, "somedaySectionRenameRetryOutcome": 1,
        "somedaySectionDeleteOptions": 1, "somedaySectionDeleteWrite": 1, "somedaySectionDeleteRetryOutcome": 1,
        "somedaySectionOrderOptions": 1, "somedaySectionOrderWrite": 1, "somedaySectionOrderRetryOutcome": 1,
        "somedaySectionTaskOptions": 1, "somedaySectionTaskPrepare": 1, "somedaySectionTaskCommit": 1, "somedaySectionTaskRetryOutcome": 1,
        "taskCancellationUndo": 1, "taskDelete": 1, "taskDeleteUndo": 1, "taskPromote": 1,
        "somedaySectionMoveOptions": 1, "somedaySectionMoveWrite": 1, "somedaySectionMoveUndo": 1,
        "somedaySectionMoveRetryOutcome": 1, "somedaySectionMoveUndoRetryOutcome": 1,
        "taskFocusOptions": 1, "taskFocusWrite": 1, "taskFocusRetryOutcome": 1,
        "focusOrderOptions": 1, "focusOrderWrite": 1, "focusOrderRetryOutcome": 1,
        "focusSavedFilterOptions": 1, "focusSavedFilterWrite": 1, "focusSavedFilterRetryOutcome": 1,
        "savedSearchOptions": 1, "savedSearchWrite": 1, "savedSearchRetryOutcome": 1,
        "projectRenameOptions": 1, "projectRenameWrite": 1, "projectRenameRetryOutcome": 1,
        "projectFlowOptions": 1, "projectFlowWrite": 1, "projectFlowRetryOutcome": 1,
        "projectTaskSortOptions": 1, "projectTaskSortWrite": 1, "projectTaskSortRetryOutcome": 1,
        "projectTaskOrderWrite": 1, "projectTaskOrderRetryOutcome": 1,
        "projectNotesEditOptions": 1, "projectNotesReferenceTarget": 1, "projectNotesDraftDirection": 1, "projectNotesWrite": 1, "projectNotesWriteRetryOutcome": 1,
        "projectTagsEditOptions": 1, "projectTagsWrite": 1, "projectTagsWriteRetryOutcome": 1,
        "projectAttachmentEditOptions": 1, "projectAttachmentWrite": 1, "projectAttachmentWriteRetryOutcome": 1,
        "projectStatusOptions": 1, "projectStatusWrite": 1, "projectStatusRetryOutcome": 1,
        "projectDateOptions": 1, "projectDateWrite": 1, "projectDateRetryOutcome": 1,
        "projectAreaOptions": 1, "projectAreaWrite": 1, "projectAreaRetryOutcome": 1,
        "menuRead": 2, "destinationPicker": 1, "editorSuggestions": 4, "calendarPreference": 1, "calendarUnschedule": 1, "calendarDelete": 1, "boardAction": 1,
        "calendarComposerOpen": 1, "calendarComposerEdit": 1, "calendarComposerSave": 1,
        "mindSweepGuide": 1, "mindSweepAdd": 1,
        "inboxStart": 1, "inboxStep": 1, "inboxEnd": 1,
        "inboxCommit": 1, "inboxSkip": 1, "inboxAfterCommit": 1,
        "checklistEdit": 1, "checklistSave": 1, "checklistReset": 1,
    ]
    private static let mutations: Set<String> = ["taskDelete", "taskDeleteUndo", "taskPromote", "taskCancellationUndo", "captureSubmit", "complete", "setAreaFilter", "saveDraft", "calendarUnschedule", "calendarDelete", "calendarPreference", "focusGroupWrite", "taskListSortWrite", "unassignedAreaColorWrite", "somedaySectionCreateWrite", "somedaySectionRenameWrite", "somedaySectionDeleteWrite", "somedaySectionOrderWrite", "somedaySectionTaskCommit", "somedaySectionMoveWrite", "somedaySectionMoveUndo", "boardAction", "calendarComposerSave", "mindSweepAdd", "inboxCommit", "inboxSkip", "checklistSave", "checklistReset", "projectCreate", "projectSectionCreate", "projectSectionRename", "projectSectionDelete", "projectSectionOrder", "areaCreate", "manageAreaCreate", "managePersonCreate", "appLock", "gtdWorkflow", "generalPreference", "manageTaxonomy", "managePersonEdit", "managePersonDelete", "areaColor", "areaRename", "manageAreaEdit", "areaOrder", "areaDelete", "manageAreaDelete", "projectFocusWrite", "taskFocusWrite", "focusOrderWrite", "focusSavedFilterWrite", "savedSearchWrite", "projectRenameWrite", "projectFlowWrite", "projectTaskSortWrite", "projectTaskOrderWrite", "projectNotesWrite", "projectTagsWrite", "projectAttachmentWrite", "projectStatusWrite", "projectDateWrite", "projectAreaWrite"]
    private static let scheduleFields: Set<String> = ["startTime", "dueDate", "reviewAt", "relativeStartOffset"]
    private static let recurrenceFields: Set<String> = ["recurrence", "recurrenceStrategy", "recurrenceRRule", "showFutureRecurrence"]

    private static func validTaskAttachmentList(_ value: Any?) -> Bool {
        guard let rows = value as? [[String: Any]], rows.count <= 1_000,
              let data = try? JSONSerialization.data(withJSONObject: rows), data.count <= 2_000_000 else { return false }
        let ids = rows.compactMap { $0["id"] as? String }
        return ids.count == rows.count && Set(ids).count == ids.count
            && ids.allSatisfy { !$0.isEmpty && $0.utf16.count <= 500 }
    }

    private static func validTaskAttachmentHalf(_ value: Any?) -> Bool {
        guard let half = value as? [String: Any], Set(half.keys) == Set(["base", "value"]) else { return false }
        return validTaskAttachmentList(half["base"]) && validTaskAttachmentList(half["value"])
    }

    private static func validTaskAttachmentOwner(_ value: Any?) -> Bool {
        guard let owner = value as? [String: Any], Set(owner.keys) == Set(["kind", "taskId", "attachments"]),
              owner["kind"] as? String == "task", let taskID = owner["taskId"] as? String,
              !taskID.isEmpty, taskID.utf16.count <= 500 else { return false }
        return validTaskAttachmentList(owner["attachments"])
    }

    private static func validTaskLinkEditing(_ value: Any?) -> Bool {
        guard let edit = value as? [String: Any], Set(edit.keys) == Set(["attachmentId", "title", "uri"]),
              let id = edit["attachmentId"] as? String, !id.isEmpty, id.utf16.count <= 500,
              let title = edit["title"] as? String, title.utf16.count <= 100_000,
              let uri = edit["uri"] as? String, uri.utf16.count <= 100_000 else { return false }
        return true
    }

    init(queue: DispatchQueue, databaseURL: URL, bundleURL: URL, legacyStorage: LegacyRNStorage? = nil) {
        self.queue = queue
        self.databaseURL = databaseURL
        self.bundleURL = bundleURL
        self.legacyStorage = legacyStorage
        journalURL = databaseURL.appendingPathExtension("pending.json")
        editorDrafts = EditorDraftStore(databaseURL: databaseURL)
    }

    private func loadPendingJournal(checkingEditorSnapshot: Bool = true) throws -> PendingCommand? {
        guard FileManager.default.fileExists(atPath: journalURL.path) else { return nil }
        let journalData = try Data(contentsOf: journalURL)
        guard let raw = try NativeJSON.jsonObject(with: journalData) as? [String: Any],
              Set(raw.keys).isSubset(of: ["version", "method", "argumentsJSON", "terminal", "editorDraft"]),
              raw["editorDraft"] == nil || (raw["editorDraft"] as? [String: Any]).map({
                  Set($0.keys) == Set(["id", "sessionID", "taskID", "generation", "method", "argumentsJSON"])
              }) == true,
              let saved = try? JSONDecoder().decode(PendingCommand.self, from: journalData) else {
            throw HostFailure("Invalid pending command journal")
        }
        guard saved.version == 2 else { throw HostFailure("Unsupported pending command journal; raw captures cannot be safely replanned") }
        _ = try journalArguments(saved, checkingEditorSnapshot: checkingEditorSnapshot)
        switch saved.terminal {
        case .success(let value):
            _ = try NativeJSON.jsonObject(with: Data(value.utf8), options: [.fragmentsAllowed])
        case .rejected(let message):
            guard isDefiniteRejection(message, method: saved.method) else { throw HostFailure("Invalid terminal command journal") }
        case nil: break
        }
        return saved
    }

    func start() throws -> String {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !closed else { throw HostFailure("Core host is closed") }
        do {
            if started {
                return try startupWindow()
            }
            let source = try String(contentsOf: bundleURL, encoding: .utf8)
            guard !source.isEmpty else { throw HostFailure("Core bundle is empty") }
            try FileManager.default.createDirectory(at: databaseURL.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            try DurableFile.sync(databaseURL.deletingLastPathComponent().deletingLastPathComponent(), directory: true)
            lockFD = open(databaseURL.appendingPathExtension("host-lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
            guard lockFD >= 0, flock(lockFD, LOCK_EX | LOCK_NB) == 0 else { throw HostFailure("Native database is already in use or cannot be locked") }
            if pending == nil { pending = try loadPendingJournal() }
            guard let runtime = JSContext() else { throw HostFailure("Cannot create JavaScriptCore runtime") }
            context = runtime
            installBridge(runtime)
            runtime.evaluateScript(source, withSourceURL: bundleURL)
            try checkException()
            guard let host = runtime.objectForKeyedSubscript("MindwtrHost"), !host.isUndefined, !host.isNull else {
                throw HostFailure("Core bundle has no host contract")
            }
            if let command = pending, command.method == "draftCommit" {
                if case .success(let value) = command.terminal { try validateDraftAcknowledgment(command, value: value) }
                else { try validateDraftAcknowledgment(command) }
            }
            if let command = pending, command.method == "boardCommit" {
                // Full immutable authority is checked before opening SQLite, even
                // for terminal journals whose remaining work is only cleanup.
                _ = try invoke("boardValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateBoardAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "taskDeleteCommit" {
                _ = try invoke("taskDeleteValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validatePreparedAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "taskPromoteCommit" {
                _ = try invoke("validatePreparedTaskPromotion", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validatePreparedAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "taskDeleteUndoCommit" {
                _ = try invoke("taskDeleteUndoValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validatePreparedAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "calendarDeleteCommit" {
                _ = try invoke("calendarDeleteValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateCalendarDeleteAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "calendarUnscheduleCommit" {
                _ = try invoke("calendarUnscheduleValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateCalendarAcknowledgment(command, value: value) }
            }
            if let command = pending, ["calendarComposerCommit", "calendarComposerCreateCommit"].contains(command.method) {
                _ = try invoke(command.method == "calendarComposerCommit" ? "calendarComposerValidate" : "calendarComposerCreateValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateCalendarAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "mindSweepCommit" {
                _ = try invoke("mindSweepValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateMindSweepAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "inboxPreparedCommit" {
                _ = try invoke("inboxPreparedValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validatePreparedAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "taskCancellationUndoCommit" {
                _ = try invoke("taskCancellationUndoValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validatePreparedAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "checklistPreparedCommit" {
                _ = try invoke("checklistPreparedValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validatePreparedAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectCreateCommit" {
                _ = try invoke("projectCreateValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectCreateAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectSectionCreateCommit" {
                _ = try invoke("projectSectionCreateValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectSectionCreateAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectSectionRenameCommit" {
                _ = try invoke("projectSectionRenameValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectSectionRenameAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectSectionDeleteCommit" {
                _ = try invoke("projectSectionDeleteValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectSectionDeleteAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectSectionOrderCommit" {
                _ = try invoke("projectSectionOrderValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectSectionOrderAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "appLockCommit" {
                _ = try invoke("appLockValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateAppLockAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "gtdWorkflowCommit" {
                _ = try invoke("gtdWorkflowValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateGtdWorkflowAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "generalPreferenceCommit" {
                _ = try invoke("generalPreferenceValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateGeneralPreferenceAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "manageTaxonomyCommit" {
                _ = try invoke("manageTaxonomyValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateTaxonomyAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "managePersonEditCommit" {
                _ = try invoke("managePersonEditValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validatePersonEditAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "managePersonDeleteCommit" {
                _ = try invoke("managePersonDeleteValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validatePersonDeleteAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "managePersonCreateCommit" {
                _ = try invoke("managePersonCreateValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validatePersonCreateAcknowledgment(command, value: value) }
            }
            if let command = pending, ["areaCreateCommit", "manageAreaCreateCommit"].contains(command.method) {
                _ = try invoke("areaCreateValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateAreaCreateAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "areaColorCommit" {
                _ = try invoke("areaColorValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateAreaColorAcknowledgment(command, value: value) }
            }
            if let command = pending, ["areaRenameCommit", "manageAreaEditCommit"].contains(command.method) {
                _ = try invoke("areaRenameValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateAreaRenameAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "areaOrderCommit" {
                _ = try invoke("areaOrderValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateAreaOrderAcknowledgment(command, value: value) }
            }
            if let command = pending, ["areaDeleteCommit", "manageAreaDeleteCommit"].contains(command.method) {
                _ = try invoke("areaDeleteValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateAreaDeleteAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectFocusCommit" {
                _ = try invoke("projectFocusValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectFocusAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "taskFocusCommit" {
                _ = try invoke("taskFocusValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateTaskFocusAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "focusOrderCommit" {
                _ = try invoke("focusOrderValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateFocusOrderAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "focusSavedFilterCommit" {
                _ = try invoke("focusSavedFilterValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateFocusSavedFilterAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "savedSearchCommit" {
                _ = try invoke("savedSearchValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateSavedSearchAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectRenameCommit" {
                _ = try invoke("projectRenameValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectRenameAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectFlowCommit" {
                _ = try invoke("projectFlowValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectFlowAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectTaskSortCommit" {
                _ = try invoke("projectTaskSortValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectTaskSortAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectTaskOrderCommit" {
                _ = try invoke("projectTaskOrderValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectTaskOrderAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectNotesWriteCommit" {
                _ = try invoke("projectNotesWriteValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectNotesWriteAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectTagsWriteCommit" {
                _ = try invoke("projectTagsWriteValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectTagsWriteAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectAttachmentWriteCommit" {
                _ = try invoke("projectAttachmentWriteValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectAttachmentWriteAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectStatusCommit" {
                _ = try invoke("projectStatusValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectStatusAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectDateCommit" {
                _ = try invoke("projectDateValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectDateAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "projectAreaCommit" {
                _ = try invoke("projectAreaValidate", arguments: journalArguments(command))
                if case .success(let value) = command.terminal { try validateProjectAreaAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "focusGroupWrite" {
                try validateFocusGroupJournal(command)
                if case .success(let value) = command.terminal { try validateFocusGroupAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "taskListSortWrite" {
                try validateTaskListSortJournal(command)
                if case .success(let value) = command.terminal { try validateTaskListSortAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "unassignedAreaColorWrite" {
                try validateUnassignedAreaColorJournal(command)
                if case .success(let value) = command.terminal { try validateUnassignedAreaColorAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "somedaySectionCreateWrite" {
                try validateSomedaySectionCreateJournal(command)
                if case .success(let value) = command.terminal { try validateSomedaySectionCreateAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "somedaySectionRenameWrite" {
                try validateSomedaySectionRenameJournal(command)
                if case .success(let value) = command.terminal { try validateSomedaySectionRenameAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "somedaySectionDeleteWrite" {
                try validateSomedaySectionDeleteJournal(command)
                if case .success(let value) = command.terminal { try validateSomedaySectionDeleteAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "somedaySectionOrderWrite" {
                try validateSomedaySectionOrderJournal(command)
                if case .success(let value) = command.terminal { try validateSomedaySectionOrderAcknowledgment(command, value: value) }
            }
            if let command = pending, command.method == "somedaySectionTaskCommit" {
                try validateSomedaySectionTaskJournal(command)
                if case .success(let value) = command.terminal { try validateSomedaySectionTaskAcknowledgment(command, value: value) }
            }
            if let command = pending, ["somedaySectionMoveCommit", "somedaySectionMoveUndoCommit"].contains(command.method) {
                try validateSomedaySectionMoveJournal(command)
                if case .success(let value) = command.terminal { try validateSomedaySectionMoveAcknowledgment(command, value: value) }
            }
            let legacy = try legacyStorage?.bootState()
            if let legacy {
                _ = try invoke("legacyCheck", arguments: [legacy.stateJSON, legacy.backupJSON])
                if !FileManager.default.fileExists(atPath: databaseURL.path), legacyStorage?.hasStoredValues == true {
                    let state = try NativeJSON.jsonObject(with: Data(legacy.stateJSON.utf8)) as? [String: Any]
                    let hadSQLite = state?["jsonAhead"] as? Bool == true || state?["reconciled"] as? Bool == true
                        || state?["backupVersion"] as? String != nil
                    // A SQLite-era backup may predate later local writes. Only a
                    // genuinely JSON-only legacy installation can create this DB.
                    guard !hadSQLite, !legacy.backupJSON.isEmpty else {
                        throw HostFailure("Legacy library database is missing; recovery is required")
                    }
                }
            }
            let sqlite = try SQLiteBridge(url: databaseURL)
            database = sqlite
            #if DEBUG
            sqlite.faults = faults
            #endif
            try sqlite.prepareRecovery(at: databaseURL.appendingPathExtension("prewrite"))
            recoveryActivationPending = pending != nil
            _ = try invoke(recoveryActivationPending ? "bootRecovery" : "boot", arguments: [legacy?.stateJSON ?? "", legacy?.backupJSON ?? ""])
            started = true
            // A durable no-write rejection needs only cleanup, not another failed
            // startup. The interactive retry still returns its original error.
            return try startupWindow()
        } catch {
            if !(error is CoreHostAppLockRecovery) { releaseRuntime() }
            throw error
        }
    }

    func cancelAppLockRecovery() throws {
        dispatchPrecondition(condition: .onQueue(queue))
        guard started, !closed, unresolvedAppLockRecovery, let command = pending,
              command.method == "appLockCommit" else { throw HostFailure("No unresolved App lock recovery") }
        // An explicit cancellation abandons this UUID; it does not claim the old write failed or succeeded.
        _ = try finish(command, with: .rejected("STALE_REVISION: App lock outcome unknown; pending change cancelled"))
        unresolvedAppLockRecovery = false
        NSLog("Native iOS App lock recovery cancelled releaseCheck=v1.3.4/ios-app-lock outcome=cancelled")
    }

    private func startupWindow() throws -> String {
        let recoveringBoard = pending?.method == "boardCommit"
        let recoveringTaskDelete = pending?.method == "taskDeleteCommit"
        let recoveringTaskPromote = pending?.method == "taskPromoteCommit"
        let recoveringCalendarMethod = pending?.method == "calendarComposerCreateCommit" ? "calendarComposerCreateCommit"
            : pending?.method == "calendarComposerCommit" ? "calendarComposerCommit" : nil
        let recoveringMindSweep = pending?.method == "mindSweepCommit"
        let recoveringProjectCreate = pending?.method == "projectCreateCommit"
        let recoveringProjectSectionCreate = pending?.method == "projectSectionCreateCommit"
        let recoveringProjectSectionRename = pending?.method == "projectSectionRenameCommit"
        let recoveringProjectSectionDelete = pending?.method == "projectSectionDeleteCommit"
        let recoveringProjectSectionOrder = pending?.method == "projectSectionOrderCommit"
        let recoveringAppLock = pending?.method == "appLockCommit"
        let recoveringGtdWorkflow = pending?.method == "gtdWorkflowCommit"
        let recoveringGeneralPreference = pending?.method == "generalPreferenceCommit"
        let recoveringTaxonomy = pending?.method == "manageTaxonomyCommit"
        let recoveringPersonEdit = pending?.method == "managePersonEditCommit"
        let recoveringPersonDelete = pending?.method == "managePersonDeleteCommit"
        let recoveringPersonCreate = pending?.method == "managePersonCreateCommit"
        let recoveringAreaCreateMethod = ["areaCreateCommit", "manageAreaCreateCommit"].first { $0 == pending?.method }
        let recoveringAreaColor = pending?.method == "areaColorCommit"
        let recoveringAreaRenameMethod = ["areaRenameCommit", "manageAreaEditCommit"].first { $0 == pending?.method }
        let recoveringAreaOrder = pending?.method == "areaOrderCommit"
        let recoveringAreaDeleteMethod = ["areaDeleteCommit", "manageAreaDeleteCommit"].first { $0 == pending?.method }
        let recoveringProjectFocus = pending?.method == "projectFocusCommit"
        let recoveringTaskFocus = pending?.method == "taskFocusCommit"
        let recoveringFocusOrder = pending?.method == "focusOrderCommit"
        let recoveringFocusSavedFilter = pending?.method == "focusSavedFilterCommit"
        let recoveringCalendarDelete = pending?.method == "calendarDeleteCommit"
        let recoveringCalendarUnschedule = pending?.method == "calendarUnscheduleCommit"
        let recoveringSavedSearch = pending?.method == "savedSearchCommit"
        let recoveringProjectRename = pending?.method == "projectRenameCommit"
        let recoveringProjectFlow = pending?.method == "projectFlowCommit"
        let recoveringProjectTaskSort = pending?.method == "projectTaskSortCommit"
        let recoveringProjectTaskOrder = pending?.method == "projectTaskOrderCommit"
        let recoveringProjectNotesWrite = pending?.method == "projectNotesWriteCommit"
        let recoveringProjectTagsWrite = pending?.method == "projectTagsWriteCommit"
        let recoveringProjectAttachmentWrite = pending?.method == "projectAttachmentWriteCommit"
        let recoveringProjectStatus = pending?.method == "projectStatusCommit"
        let recoveringProjectDate = pending?.method == "projectDateCommit"
        let recoveringProjectArea = pending?.method == "projectAreaCommit"
        let recoveringInbox = pending?.method == "inboxPreparedCommit"
        let recoveringChecklist = pending?.method == "checklistPreparedCommit"
        let recoveringFocusGroup = pending?.method == "focusGroupWrite"
        let recoveringTaskListSort = pending?.method == "taskListSortWrite"
        let recoveringUnassignedAreaColor = pending?.method == "unassignedAreaColorWrite"
        let recoveringSomedaySectionCreate = pending?.method == "somedaySectionCreateWrite"
        let recoveringSomedaySectionRename = pending?.method == "somedaySectionRenameWrite"
        let recoveringSomedaySectionDelete = pending?.method == "somedaySectionDeleteWrite"
        let recoveringSomedaySectionOrder = pending?.method == "somedaySectionOrderWrite"
        let recoveringSomedaySectionTask = pending?.method == "somedaySectionTaskCommit"
        let recoveringSomedaySectionMove = pending?.method == "somedaySectionMoveCommit"
        let recoveringSomedaySectionUndo = pending?.method == "somedaySectionMoveUndoCommit"
        let terminal = try resolvePending()
        if recoveringBoard, let terminal, case .success(let value) = terminal { startupBoardResult = value }
        if recoveringTaskDelete, let terminal, case .success(let value) = terminal { startupTaskDeleteResult = value }
        if recoveringTaskPromote, let terminal, case .success(let value) = terminal { startupTaskPromoteResult = value }
        if recoveringCalendarMethod != nil, let terminal, case .success(let value) = terminal { startupCalendarResult = value }
        if recoveringMindSweep, let terminal, case .success(let value) = terminal { startupMindSweepResult = value }
        if recoveringProjectCreate, let terminal, case .success(let value) = terminal { startupProjectCreateResult = value }
        if recoveringProjectSectionCreate, let terminal, case .success(let value) = terminal { startupProjectSectionCreateResult = value }
        if recoveringProjectSectionRename, let terminal, case .success(let value) = terminal { startupProjectSectionRenameResult = value }
        if recoveringProjectSectionDelete, let terminal, case .success(let value) = terminal { startupProjectSectionDeleteResult = value }
        if recoveringProjectSectionOrder, let terminal, case .success(let value) = terminal { startupProjectSectionOrderResult = value }
        if recoveringAppLock, let terminal, case .success(let value) = terminal { startupAppLockResult = value }
        if recoveringGtdWorkflow, let terminal, case .success(let value) = terminal { startupGtdWorkflowResult = value }
        if recoveringGeneralPreference, let terminal, case .success(let value) = terminal { startupGeneralPreferenceResult = value }
        if recoveringTaxonomy, let terminal, case .success(let value) = terminal { startupTaxonomyResult = value }
        if recoveringPersonEdit, let terminal, case .success(let value) = terminal { startupPersonEditResult = value }
        if recoveringPersonDelete, let terminal, case .success(let value) = terminal { startupPersonDeleteResult = value }
        if recoveringPersonCreate, let terminal, case .success(let value) = terminal { startupPersonCreateResult = value }
        if recoveringAreaCreateMethod != nil, let terminal, case .success(let value) = terminal { startupAreaCreateResult = value }
        if recoveringAreaColor, let terminal, case .success(let value) = terminal { startupAreaColorResult = value }
        if recoveringAreaRenameMethod != nil, let terminal, case .success(let value) = terminal { startupAreaRenameResult = value }
        if recoveringAreaOrder, let terminal, case .success(let value) = terminal { startupAreaOrderResult = value }
        if recoveringAreaDeleteMethod != nil, let terminal, case .success(let value) = terminal { startupAreaDeleteResult = value }
        if recoveringProjectFocus, let terminal, case .success(let value) = terminal { startupProjectFocusResult = value }
        if recoveringTaskFocus, let terminal, case .success(let value) = terminal { startupTaskFocusResult = value }
        if recoveringFocusOrder, let terminal, case .success(let value) = terminal { startupFocusOrderResult = value }
        if recoveringFocusSavedFilter, let terminal, case .success(let value) = terminal { startupFocusSavedFilterResult = value }
        if recoveringCalendarDelete, let terminal, case .success(let value) = terminal { startupCalendarDeleteResult = value }
        if recoveringCalendarUnschedule, let terminal, case .success(let value) = terminal { startupCalendarUnscheduleResult = value }
        if recoveringSavedSearch, let terminal, case .success(let value) = terminal { startupSavedSearchResult = value }
        if recoveringProjectRename, let terminal, case .success(let value) = terminal { startupProjectRenameResult = value }
        if recoveringProjectFlow, let terminal, case .success(let value) = terminal { startupProjectFlowResult = value }
        if recoveringProjectTaskSort, let terminal, case .success(let value) = terminal { startupProjectTaskSortResult = value }
        if recoveringProjectTaskOrder, let terminal, case .success(let value) = terminal { startupProjectTaskOrderResult = value }
        if recoveringProjectNotesWrite, let terminal, case .success(let value) = terminal { startupProjectNotesWriteResult = value }
        if recoveringProjectTagsWrite, let terminal, case .success(let value) = terminal { startupProjectTagsWriteResult = value }
        if recoveringProjectAttachmentWrite, let terminal, case .success(let value) = terminal { startupProjectAttachmentWriteResult = value }
        if recoveringProjectStatus, let terminal, case .success(let value) = terminal { startupProjectStatusResult = value }
        if recoveringProjectDate, let terminal, case .success(let value) = terminal { startupProjectDateResult = value }
        if recoveringProjectArea, let terminal, case .success(let value) = terminal { startupProjectAreaResult = value }
        if recoveringInbox, let terminal, case .success(let value) = terminal { startupInboxResult = value }
        if recoveringChecklist, let terminal, case .success(let value) = terminal { startupChecklistResult = value }
        if recoveringFocusGroup, let terminal, case .success(let value) = terminal { startupFocusGroupResult = value }
        if recoveringTaskListSort, let terminal, case .success(let value) = terminal { startupTaskListSortResult = value }
        if recoveringUnassignedAreaColor, let terminal, case .success(let value) = terminal { startupUnassignedAreaColorResult = value }
        if recoveringSomedaySectionCreate, let terminal, case .success(let value) = terminal { startupSomedaySectionCreateResult = value }
        if recoveringSomedaySectionRename, let terminal, case .success(let value) = terminal { startupSomedaySectionRenameResult = value }
        if recoveringSomedaySectionDelete, let terminal, case .success(let value) = terminal { startupSomedaySectionDeleteResult = value }
        if recoveringSomedaySectionOrder, let terminal, case .success(let value) = terminal { startupSomedaySectionOrderResult = value }
        if recoveringSomedaySectionTask, let terminal, case .success(let value) = terminal { startupSomedaySectionTaskResult = value }
        if recoveringSomedaySectionMove, let terminal, case .success(let value) = terminal { startupSomedaySectionMoveResult = value }
        if recoveringSomedaySectionUndo, let terminal, case .success(let value) = terminal { startupSomedaySectionUndoResult = value }
        try resumeActivationIfNeeded()
        _ = try invoke("pruneReceipts", arguments: [])
        let value = try invoke("window", arguments: [0, 50, ""])
        let recoveredAreas = startupAreaCreateResult ?? startupAreaColorResult ?? startupAreaRenameResult
            ?? startupAreaOrderResult ?? startupAreaDeleteResult
        let recoveredProjectMetadata = startupProjectFlowResult ?? startupProjectTaskSortResult ?? startupProjectTaskOrderResult ?? startupProjectNotesWriteResult ?? startupProjectTagsWriteResult
            ?? startupProjectAttachmentWriteResult ?? startupProjectStatusResult ?? startupProjectDateResult ?? startupProjectAreaResult
        let recoveredProjects = startupProjectCreateResult ?? startupProjectSectionCreateResult
            ?? startupProjectSectionRenameResult ?? startupProjectSectionDeleteResult ?? startupProjectSectionOrderResult
            ?? recoveredAreas ?? startupProjectFocusResult
            ?? startupProjectRenameResult ?? recoveredProjectMetadata
        let recoveredFocus = startupTaskFocusResult ?? startupFocusOrderResult ?? startupFocusSavedFilterResult
            ?? startupFocusGroupResult ?? startupSavedSearchResult ?? startupCalendarUnscheduleResult ?? startupCalendarDeleteResult
        let recoveredSomedaySections = startupSomedaySectionCreateResult ?? startupSomedaySectionRenameResult
            ?? startupSomedaySectionDeleteResult ?? startupSomedaySectionOrderResult
            ?? startupSomedaySectionTaskResult
        let recoveredManage = startupGtdWorkflowResult ?? startupAppLockResult ?? startupGeneralPreferenceResult ?? startupUnassignedAreaColorResult ?? startupPersonCreateResult
            ?? startupPersonDeleteResult ?? startupPersonEditResult ?? startupTaxonomyResult
        let recoveredLists = startupInboxResult ?? startupChecklistResult ?? startupTaskListSortResult
            ?? recoveredManage ?? recoveredSomedaySections
            ?? startupSomedaySectionMoveResult ?? startupSomedaySectionUndoResult
        guard let recovered = startupTaskDeleteResult ?? startupTaskPromoteResult ?? startupBoardResult ?? startupCalendarResult ?? startupMindSweepResult
            ?? recoveredProjects ?? recoveredFocus ?? recoveredLists else { return value }
        guard var window = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any] else {
            throw HostFailure("Malformed startup window")
        }
        let projectRecoveryMethod: String? = [
            (startupProjectCreateResult, "projectCreateCommit"),
            (startupProjectSectionCreateResult, "projectSectionCreateCommit"),
            (startupProjectSectionRenameResult, "projectSectionRenameCommit"),
            (startupProjectSectionDeleteResult, "projectSectionDeleteCommit"),
            (startupProjectSectionOrderResult, "projectSectionOrderCommit"),
            (startupAreaCreateResult, recoveringAreaCreateMethod ?? "areaCreateCommit"),
            (startupAreaColorResult, "areaColorCommit"),
            (startupAreaRenameResult, recoveringAreaRenameMethod ?? "areaRenameCommit"),
            (startupAreaOrderResult, "areaOrderCommit"),
            (startupAreaDeleteResult, recoveringAreaDeleteMethod ?? "areaDeleteCommit"),
            (startupProjectFocusResult, "projectFocusCommit"),
            (startupProjectRenameResult, "projectRenameCommit"),
            (startupProjectFlowResult, "projectFlowCommit"),
            (startupProjectTaskSortResult, "projectTaskSortCommit"),
            (startupProjectTaskOrderResult, "projectTaskOrderCommit"),
            (startupProjectNotesWriteResult, "projectNotesWriteCommit"),
            (startupProjectTagsWriteResult, "projectTagsWriteCommit"),
            (startupProjectAttachmentWriteResult, "projectAttachmentWriteCommit"),
            (startupProjectStatusResult, "projectStatusCommit"),
            (startupProjectDateResult, "projectDateCommit"),
            (startupProjectAreaResult, "projectAreaCommit"),
        ].first(where: { $0.0 != nil })?.1
        window["recovery"] = ["method": startupTaskDeleteResult != nil ? "taskDeleteCommit"
            : startupTaskPromoteResult != nil ? "taskPromoteCommit"
            : startupBoardResult != nil ? "boardCommit"
            : startupCalendarResult != nil ? (recoveringCalendarMethod ?? "calendarComposerCommit")
            : startupMindSweepResult != nil ? "mindSweepCommit"
            : projectRecoveryMethod ?? (startupTaskFocusResult != nil ? "taskFocusCommit"
                : startupFocusOrderResult != nil ? "focusOrderCommit"
                : startupCalendarDeleteResult != nil ? "calendarDeleteCommit"
                : startupCalendarUnscheduleResult != nil ? "calendarUnscheduleCommit"
                : startupSavedSearchResult != nil ? "savedSearchCommit"
                : startupFocusSavedFilterResult != nil ? "focusSavedFilterCommit"
                : startupInboxResult != nil ? "inboxPreparedCommit" : startupChecklistResult != nil ? "checklistPreparedCommit"
                : startupTaskListSortResult != nil ? "taskListSortWrite"
                : startupPersonCreateResult != nil ? "managePersonCreateCommit"
                : startupAppLockResult != nil ? "appLockCommit"
                : startupGtdWorkflowResult != nil ? "gtdWorkflowCommit"
                : startupGeneralPreferenceResult != nil ? "generalPreferenceCommit"
                : startupTaxonomyResult != nil ? "manageTaxonomyCommit"
                : startupPersonEditResult != nil ? "managePersonEditCommit"
                : startupPersonDeleteResult != nil ? "managePersonDeleteCommit"
                : startupUnassignedAreaColorResult != nil ? "unassignedAreaColorWrite"
                : startupSomedaySectionCreateResult != nil ? "somedaySectionCreateWrite"
                : startupSomedaySectionRenameResult != nil ? "somedaySectionRenameWrite"
                : startupSomedaySectionDeleteResult != nil ? "somedaySectionDeleteWrite"
                : startupSomedaySectionOrderResult != nil ? "somedaySectionOrderWrite"
                : startupSomedaySectionTaskResult != nil ? "somedaySectionTaskCommit"
                : startupSomedaySectionMoveResult != nil ? "somedaySectionMoveCommit"
                : startupSomedaySectionUndoResult != nil ? "somedaySectionMoveUndoCommit" : "focusGroupWrite"),
                              "result": try NativeJSON.jsonObject(with: Data(recovered.utf8))]
        let encoded = String(decoding: try JSONSerialization.data(withJSONObject: window, options: [.sortedKeys]), as: UTF8.self)
        startupBoardResult = nil
        startupTaskDeleteResult = nil
        startupTaskPromoteResult = nil
        startupCalendarResult = nil
        startupMindSweepResult = nil
        startupProjectCreateResult = nil
        startupProjectSectionCreateResult = nil
        startupProjectSectionRenameResult = nil
        startupProjectSectionDeleteResult = nil
        startupProjectSectionOrderResult = nil
        startupAppLockResult = nil
        startupGtdWorkflowResult = nil
        startupGeneralPreferenceResult = nil
        startupTaxonomyResult = nil
        startupPersonEditResult = nil
        startupPersonDeleteResult = nil
        startupPersonCreateResult = nil
        startupAreaCreateResult = nil
        startupAreaColorResult = nil
        startupAreaRenameResult = nil
        startupAreaOrderResult = nil
        startupAreaDeleteResult = nil
        startupProjectFocusResult = nil
        startupTaskFocusResult = nil
        startupFocusOrderResult = nil
        startupFocusSavedFilterResult = nil
        startupSavedSearchResult = nil
        startupCalendarUnscheduleResult = nil
        startupCalendarDeleteResult = nil
        startupProjectRenameResult = nil
        startupProjectFlowResult = nil
        startupProjectTaskSortResult = nil
        startupProjectNotesWriteResult = nil
        startupProjectTagsWriteResult = nil
        startupProjectAttachmentWriteResult = nil
        startupProjectStatusResult = nil
        startupProjectDateResult = nil
        startupProjectAreaResult = nil
        startupInboxResult = nil
        startupChecklistResult = nil
        startupFocusGroupResult = nil
        startupTaskListSortResult = nil
        startupUnassignedAreaColorResult = nil
        startupSomedaySectionCreateResult = nil
        startupSomedaySectionRenameResult = nil
        startupSomedaySectionDeleteResult = nil
        startupSomedaySectionOrderResult = nil
        startupSomedaySectionTaskResult = nil
        startupSomedaySectionMoveResult = nil
        startupSomedaySectionUndoResult = nil
        return encoded
    }

    func call(_ method: String, argumentsJSON: String) throws -> String {
        try call(method, argumentsJSON: argumentsJSON, editorAttempt: nil)
    }

    func readEditorDraft() throws -> EditorDraftSnapshot? {
        dispatchPrecondition(condition: .onQueue(queue))
        guard started, !closed, pending == nil else { throw HostFailure("Editor draft recovery is not settled") }
        guard let current = try editorDrafts.read() else { return nil }
        if let attempt = current.attempt {
            // No journal means the invocation never began, or a definite refusal settled.
            try editorDrafts.thaw(attempt)
        }
        return current.snapshot
    }

    func checkpointEditorDraft(_ snapshot: EditorDraftSnapshot) throws {
        dispatchPrecondition(condition: .onQueue(queue))
        guard started, !closed, pending == nil else { throw HostFailure("Editor draft is not ready") }
        try editorDrafts.checkpoint(snapshot)
    }

    func discardEditorDraft(expectedSession: String) throws {
        dispatchPrecondition(condition: .onQueue(queue))
        guard started, !closed, pending == nil else { throw HostFailure("Editor Save must settle before discard") }
        try editorDrafts.discard(sessionID: expectedSession)
    }

    func discardCorruptEditorDraft() throws {
        dispatchPrecondition(condition: .onQueue(queue))
        // A failed start may not yet have assigned `pending`. Inspect the durable
        // journal itself before removing the only frozen proof of an editor Save.
        let saved = try loadPendingJournal(checkingEditorSnapshot: false)
        let editorMethods: Set<String> = ["draftCommit", "checklistPreparedCommit", "taskPromoteCommit"]
        if let pending, pending.editorDraft != nil || editorMethods.contains(pending.method) {
            guard let saved, saved.method == pending.method,
                  saved.editorDraft == pending.editorDraft else {
                throw HostFailure("Pending editor Save has no matching durable terminal proof")
            }
        }
        if let saved, saved.editorDraft != nil || editorMethods.contains(saved.method) {
            guard let terminal = saved.terminal, case .success = terminal else {
                throw HostFailure("Pending editor Save requires its frozen snapshot")
            }
        }
        try editorDrafts.discardCorrupt()
    }

    private static func editorRequestTaskID(_ method: String, _ request: [String: Any]) -> String? {
        if method == "taskDelete" || method == "taskPromote" { return request["taskId"] as? String }
        if method == "boardAction" {
            guard Set(request.keys) == Set(["requestId", "action"]),
                  let action = request["action"] as? [String: Any],
                  Set(action.keys) == Set(["type", "taskId"]),
                  action["type"] as? String == "duplicateTask" else { return nil }
            return action["taskId"] as? String
        }
        return request["id"] as? String
    }

    func saveEditorDraft(_ method: String, argumentsJSON: String,
                         expectedSession: String, expectedGeneration: Int) throws -> String {
        dispatchPrecondition(condition: .onQueue(queue))
        guard started, !closed, pending == nil, ["saveDraft", "checklistSave", "boardAction", "taskDelete", "taskPromote"].contains(method) else {
            throw HostFailure("Editor Save is not ready")
        }
        let args = try arguments(method, argumentsJSON)
        guard let encoded = args.first as? String,
              let request = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let id = Self.editorRequestTaskID(method, request),
              method != "saveDraft" || request["scheduleBase"] != nil,
              let current = try editorDrafts.read(), current.snapshot.taskID == id else {
            throw HostFailure("Editor Save request does not match its draft")
        }
        let attempt = try editorDrafts.freeze(sessionID: expectedSession, generation: expectedGeneration,
                                              method: method, argumentsJSON: argumentsJSON)
        let value: String
        do {
            value = try call(method, argumentsJSON: argumentsJSON, editorAttempt: attempt)
        } catch {
            // A command that never entered the journal, or a definite refusal,
            // cannot have written. Keep uncertain attempts frozen for exact replay.
            if pending == nil { try editorDrafts.thaw(attempt) }
            throw error
        }
        // A prepared draft no-op returns before a journal exists. Cleanup errors
        // leave the frozen file for explicit read/retry, without another writer.
        if pending == nil, let current = try editorDrafts.read() {
            guard current.attempt == attempt else { throw HostFailure("Editor draft Save attempt changed") }
            #if DEBUG
            try faults?.editorDraftRemove?()
            #endif
            try editorDrafts.removeMatching(attempt)
        }
        return value
    }

    private func call(_ method: String, argumentsJSON: String, editorAttempt: EditorDraftAttempt?) throws -> String {
        dispatchPrecondition(condition: .onQueue(queue))
        guard started, !closed, !recoveryActivationPending else { throw HostFailure("Core host is not ready; retry startup") }
        if editorAttempt == nil, ["saveDraft", "checklistSave", "taskDelete", "taskPromote"].contains(method), try editorDrafts.read() != nil {
            throw HostFailure("Editor draft must use its exact Save attempt")
        }
        let args: [Any]
        do { args = try arguments(method, argumentsJSON) }
        catch {
            if ["taskCancellationUndo", "taskDelete", "taskDeleteUndo", "taskPromote"].contains(method), pending == nil {
                throw CoreHostRejection(message: error.localizedDescription)
            }
            if ["unassignedAreaColorOptions", "unassignedAreaColorWrite", "unassignedAreaColorRetryOutcome"].contains(method), pending == nil {
                throw CoreHostRejection(message: error.localizedDescription)
            }
            if ["somedaySectionOrderOptions", "somedaySectionOrderWrite", "somedaySectionOrderRetryOutcome"].contains(method), pending == nil {
                throw CoreHostRejection(message: error.localizedDescription)
            }
            if ["somedaySectionMoveOptions", "somedaySectionMoveWrite", "somedaySectionMoveUndo",
                "somedaySectionMoveRetryOutcome", "somedaySectionMoveUndoRetryOutcome"].contains(method), pending == nil {
                throw CoreHostRejection(message: error.localizedDescription)
            }
            if method == "gtdArchiveOptions", pending == nil {
                throw CoreHostRejection(message: error.localizedDescription)
            }
            // Mind Sweep has no journal or write before argument validation.
            // Its UI may release an oversized draft only on a definite refusal.
            // With an older command still owed, keep every error uncertain.
            if ["mindSweepAdd", "inboxCommit", "inboxSkip", "checklistSave", "checklistReset", "projectCreate", "projectCreateRetryOutcome", "projectSectionOptions", "projectSectionCreate", "projectSectionCreateRetryOutcome", "projectSectionRenameOptions", "projectSectionRename", "projectSectionRenameRetryOutcome", "projectSectionDeleteOptions", "projectSectionDelete", "projectSectionDeleteRetryOutcome", "projectSectionOrderOptions", "projectSectionOrder", "projectSectionOrderRetryOutcome", "appLockOptions", "appLock", "appLockRetryOutcome", "gtdWorkflowOptions", "gtdReviewOptions", "gtdInboxOptions", "gtdCaptureAreaOptions", "gtdCaptureParseOptions", "gtdTaskEditorOpenOptions", "gtdTaskEditorPresetOptions", "gtdWorkflowDraft", "gtdWorkflow", "gtdWorkflowRetryOutcome", "generalPreferenceOptions", "manageTaxonomyOptions", "managePersonEditOptions", "generalPreference", "manageTaxonomy", "managePersonEdit", "generalPreferenceRetryOutcome", "manageTaxonomyRetryOutcome", "managePersonEditRetryOutcome", "managePersonDeleteOptions", "managePersonDelete", "managePersonDeleteRetryOutcome", "managePersonCreateResolve", "managePersonCreate", "managePersonCreateRetryOutcome", "areaCreateResolve", "areaCreate", "manageAreaCreate", "areaCreateRetryOutcome", "areaColor", "areaColorRetryOutcome", "areaRename", "areaRenameRetryOutcome", "manageAreaEdit", "manageAreaEditRetryOutcome", "areaOrder", "areaOrderRetryOutcome", "areaDelete", "areaDeleteRetryOutcome", "manageAreaDelete", "manageAreaDeleteRetryOutcome", "focusGroupOptions", "focusGroupWrite", "focusGroupRetryOutcome", "taskListSortOptions", "taskListSortWrite", "taskListSortRetryOutcome", "somedaySectionCreateOptions", "somedaySectionCreateWrite", "somedaySectionCreateRetryOutcome", "somedaySectionRenameOptions", "somedaySectionRenameWrite", "somedaySectionRenameRetryOutcome", "somedaySectionDeleteOptions", "somedaySectionDeleteWrite", "somedaySectionDeleteRetryOutcome", "somedaySectionTaskOptions", "somedaySectionTaskPrepare", "somedaySectionTaskCommit", "somedaySectionTaskRetryOutcome", "projectFocusOptions", "projectFocusWrite", "projectFocusRetryOutcome", "taskFocusOptions", "taskFocusWrite", "taskFocusRetryOutcome", "focusOrderOptions", "focusOrderWrite", "focusOrderRetryOutcome", "focusSavedFilterOptions", "savedSearchOptions", "focusSavedFilterWrite", "savedSearchWrite", "focusSavedFilterRetryOutcome", "savedSearchRetryOutcome", "projectRenameOptions", "projectRenameWrite", "projectRenameRetryOutcome", "projectFlowOptions", "projectFlowWrite", "projectFlowRetryOutcome", "projectTaskSortOptions", "projectTaskSortWrite", "projectTaskSortRetryOutcome", "projectTaskOrderWrite", "projectTaskOrderRetryOutcome", "projectNotesEditOptions", "projectNotesReferenceTarget", "projectNotesDraftDirection", "projectNotesWrite", "projectNotesWriteRetryOutcome", "projectTagsEditOptions", "projectTagsWrite", "projectTagsWriteRetryOutcome", "projectAttachmentEditOptions", "projectAttachmentWrite", "projectAttachmentWriteRetryOutcome", "projectStatusOptions", "projectStatusWrite", "projectStatusRetryOutcome", "projectDateOptions", "projectDateWrite", "projectDateRetryOutcome", "projectAreaOptions", "projectAreaWrite", "projectAreaRetryOutcome"].contains(method), pending == nil { throw CoreHostRejection(message: error.localizedDescription) }
            throw error
        }
        guard pending == nil else { throw HostFailure("SAVE_FAILED: A pending command requires exact retry") }
        guard Self.mutations.contains(method) else {
            if ["somedaySectionMoveRetryOutcome", "somedaySectionMoveUndoRetryOutcome"].contains(method) {
                let envelope = try confirmedSomedayMoveEnvelope(for: method, publicArguments: args)
                do {
                    let value = try invoke(method, arguments: [envelope])
                    try validateSomedaySectionMoveAcknowledgment(arguments: [envelope], method: method, value: value)
                    return value
                } catch let failure as HostFailure {
                    guard failure.message.hasPrefix("STALE_REVISION:") || failure.message.hasPrefix("INVALID_INPUT:") else { throw failure }
                    throw CoreHostRejection(message: failure.message)
                }
            }
            if ["focusGroupRetryOutcome", "taskListSortRetryOutcome", "unassignedAreaColorRetryOutcome", "somedaySectionCreateRetryOutcome", "somedaySectionRenameRetryOutcome", "somedaySectionDeleteRetryOutcome", "somedaySectionOrderRetryOutcome", "somedaySectionTaskRetryOutcome", "projectCreateRetryOutcome", "projectSectionCreateRetryOutcome", "projectSectionRenameRetryOutcome", "projectSectionDeleteRetryOutcome", "projectSectionOrderRetryOutcome", "appLockRetryOutcome", "gtdWorkflowRetryOutcome", "generalPreferenceRetryOutcome", "manageTaxonomyRetryOutcome", "managePersonEditRetryOutcome", "managePersonDeleteRetryOutcome", "managePersonCreateRetryOutcome", "areaCreateRetryOutcome", "areaColorRetryOutcome", "areaRenameRetryOutcome", "manageAreaEditRetryOutcome", "areaOrderRetryOutcome", "areaDeleteRetryOutcome", "manageAreaDeleteRetryOutcome", "projectFocusRetryOutcome", "taskFocusRetryOutcome", "focusOrderRetryOutcome", "focusSavedFilterRetryOutcome", "savedSearchRetryOutcome", "projectRenameRetryOutcome", "projectFlowRetryOutcome", "projectTaskSortRetryOutcome", "projectTaskOrderRetryOutcome", "projectNotesWriteRetryOutcome", "projectTagsWriteRetryOutcome", "projectAttachmentWriteRetryOutcome", "projectStatusRetryOutcome", "projectDateRetryOutcome", "projectAreaRetryOutcome"].contains(method) {
                do {
                    let value = try invoke(method, arguments: args)
                    if method == "appLockRetryOutcome" {
                        guard let encoded = args.first as? String,
                              let request = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any] else {
                            throw HostFailure("Malformed App lock probe")
                        }
                        try validateAppLockResult(result, request: request)
                    }
                    if method == "savedSearchRetryOutcome" { throw HostFailure("Malformed saved search probe: positive outcome is unsupported") }
                    if method == "gtdWorkflowRetryOutcome" {
                        throw HostFailure("Malformed GTD workflow probe: positive outcome is unsupported")
                    }
                    if method == "generalPreferenceRetryOutcome" {
                        throw HostFailure("Malformed General preference probe: positive outcome is unsupported")
                    }
                    if method == "projectAttachmentWriteRetryOutcome" {
                        throw HostFailure("Malformed Project URL link probe: positive outcome is unsupported")
                    }
                    if method == "manageTaxonomyRetryOutcome" {
                        throw HostFailure("Malformed taxonomy probe: positive outcome is unsupported")
                    }
                    if method == "managePersonEditRetryOutcome" {
                        throw HostFailure("Malformed Person edit probe: positive outcome is unsupported")
                    }
                    if method == "managePersonDeleteRetryOutcome" {
                        guard let encoded = args.first as? String,
                              let request = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any] else {
                            throw HostFailure("Malformed Person deletion probe")
                        }
                        try validatePersonDeleteResult(result, request: request)
                    }
                    if method == "managePersonCreateRetryOutcome" {
                        guard let encoded = args.first as? String,
                              let request = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any] else {
                            throw HostFailure("Malformed Person creation probe")
                        }
                        try validatePersonCreateResult(result, request: request, created: false)
                    }
                    if method == "somedaySectionCreateRetryOutcome" {
                        try validateSomedaySectionCreateAcknowledgment(arguments: args, value: value)
                    }
                    if method == "unassignedAreaColorRetryOutcome" {
                        try validateUnassignedAreaColorAcknowledgment(arguments: args, value: value)
                    }
                    if method == "somedaySectionRenameRetryOutcome" {
                        try validateSomedaySectionRenameAcknowledgment(arguments: args, value: value)
                    }
                    if method == "somedaySectionDeleteRetryOutcome" {
                        try validateSomedaySectionDeleteAcknowledgment(arguments: args, value: value)
                    }
                    if method == "somedaySectionOrderRetryOutcome" {
                        try validateSomedaySectionOrderAcknowledgment(arguments: args, value: value)
                    }
                    if method == "somedaySectionTaskRetryOutcome" {
                        try validateSomedaySectionTaskAcknowledgment(arguments: args, value: value)
                    }
                    return value
                }
                catch let failure as HostFailure {
                    guard failure.message.hasPrefix("STALE_REVISION:") || failure.message.hasPrefix("INVALID_INPUT:") else { throw failure }
                    throw CoreHostRejection(message: failure.message)
                }
            }
            let value: String
            if method == "menuRead", let name = args.first as? String,
               let list = ["manageAreas": "areas", "managePeople": "people", "manageContexts": "contexts", "manageTags": "tags"][name] {
                guard let page = args[1] as? String,
                      var input = try NativeJSON.jsonObject(with: Data(page.utf8)) as? [String: Any] else {
                    throw HostFailure("Unsupported native Manage \(name.dropFirst(6)) page")
                }
                input["list"] = list
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: input, options: [.sortedKeys]), as: UTF8.self)
                value = try invoke("menuRead", arguments: ["manageList", encoded])
            } else {
                do { value = try invoke(method, arguments: args) }
                catch let failure as HostFailure {
                    if ["projectAttachmentList", "projectAttachmentOpen"].contains(method) {
                        throw HostFailure("Project attachment command failed")
                    }
                    if ["taskAttachmentList", "taskAttachmentOpen", "taskAttachmentLinks", "taskAttachmentRemove"].contains(method) {
                        throw HostFailure("Attachment draft command failed")
                    }
                    guard method == "gtdTaskEditorPresetOptions", failure.message.hasPrefix("INVALID_INPUT:") else { throw failure }
                    throw CoreHostRejection(message: failure.message)
                }
            }
            if method == "taskShare" {
                guard value.utf8.count <= 2_000_000,
                      let share = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(share.keys) == Set(["title", "message"]),
                      share["title"] is String || share["title"] is NSNull,
                      let message = share["message"] as? String, !message.isEmpty else {
                    throw HostFailure("Malformed Task Share response")
                }
            }
            if method == "appLockOptions" {
                guard value.utf8.count <= 16_384,
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["row", "expected", "value"]),
                      let row = options["row"] as? [String: Any], row["label"] is String, row["description"] is String,
                      Self.isBoolean(options["value"]), Self.equalJSON(row["value"], options["value"]),
                      Self.validAppLockExpected(options["expected"]),
                      let expected = options["expected"] as? [String: Any],
                      Self.equalJSON(options["value"], (expected["present"] as? Bool == true) ? expected["value"] : false) else {
                    throw HostFailure("Malformed App lock options")
                }
            }
            if method == "gtdCaptureAreaOptions" {
                guard value.utf8.count <= 262_144,
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["capture", "expected", "offset", "total", "revision"]),
                      let capture = options["capture"] as? [String: Any],
                      Set(capture.keys) == Set(["title", "description", "defaultArea"]),
                      capture["title"] is String, capture["description"] is String,
                      let area = capture["defaultArea"] as? [String: Any],
                      Set(area.keys) == Set(["label", "description", "value", "accessibilityLabel", "pickerTitle", "options"]),
                      ["label", "description", "value", "accessibilityLabel", "pickerTitle"].allSatisfy({ area[$0] is String }),
                      let rows = area["options"] as? [[String: Any]], rows.count <= 100,
                      rows.allSatisfy({ ($0["value"] as? String).map { $0.utf16.count <= 500 } == true
                          && $0["label"] is String && Self.isBoolean($0["selected"])
                          && Self.validGtdWorkflowEdit($0["edit"])
                          && ($0["edit"] as? [String: Any])?["type"] as? String == "defaultArea"
                          && Self.equalJSON(($0["edit"] as? [String: Any])?["value"], $0["value"]) }),
                      Self.validGtdWorkflowExpected(options["expected"], type: "defaultArea"),
                      Self.isInteger(options["offset"]), Self.isInteger(options["total"]),
                      let offset = options["offset"] as? Int, let total = options["total"] as? Int,
                      offset >= 0, total >= 0, total <= 9_007_199_254_740_991, offset <= total, rows.count <= total - offset,
                      let revision = options["revision"] as? String, !revision.isEmpty, revision.utf16.count <= 100 else {
                    throw HostFailure("Malformed Capture default area options")
                }
            }
            if method == "gtdArchiveOptions" {
                guard value.utf8.count <= 65_536,
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["archive", "expected"]),
                      let archive = options["archive"] as? [String: Any],
                      Set(archive.keys) == Set(["title", "description", "options"]),
                      archive["title"] is String, archive["description"] is String,
                      let witness = options["expected"] as? [String: Any],
                      Self.validGtdWorkflowExpected(witness, type: "autoArchiveDays"),
                      let rows = archive["options"] as? [[String: Any]], rows.count == 7 else {
                    throw HostFailure("Malformed GTD Auto-archive options")
                }
                let rawDays = (witness["value"] as? NSNumber)?.doubleValue ?? 7
                let displayedDays = max(0, floor(rawDays))
                guard
                      Set(rows.compactMap { ($0["value"] as? NSNumber)?.intValue }) == Set([0, 1, 3, 7, 14, 30, 60]),
                      rows.filter({ $0["selected"] as? Bool == true }).count <= 1,
                      rows.allSatisfy({ row in
                          guard Set(row.keys) == Set(["value", "label", "selected", "edit"]),
                                Self.validGtdWorkflowEdit(row["edit"]),
                                let edit = row["edit"] as? [String: Any], edit["type"] as? String == "autoArchiveDays",
                                Self.equalJSON(edit["value"], row["value"]), row["label"] is String,
                                Self.isBoolean(row["selected"]) else { return false }
                          let rowDays = (row["value"] as? NSNumber)?.doubleValue
                          return (row["selected"] as? Bool) == (rowDays == displayedDays)
                      }) else { throw HostFailure("Malformed GTD Auto-archive options") }
            }
            if method == "gtdTaskEditorPresetOptions" {
                guard value.utf8.count <= 65_536,
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["taskEditor", "expected"]),
                      let editor = options["taskEditor"] as? [String: Any],
                      Set(editor.keys) == Set(["title", "description", "presets"]),
                      editor["title"] is String, editor["description"] is String,
                      let presets = editor["presets"] as? [String: Any],
                      Set(presets.keys) == Set(["label", "options", "custom"]), presets["label"] is String,
                      presets["custom"] is String || presets["custom"] is NSNull,
                      let choices = presets["options"] as? [[String: Any]], choices.count == 3,
                      Set(choices.compactMap { $0["value"] as? String }) == Set(["simple", "standard", "full"]),
                      choices.filter({ $0["selected"] as? Bool == true }).count <= 1,
                      choices.allSatisfy({ choice in
                          guard Set(choice.keys) == Set(["value", "label", "selected", "edit"]),
                                choice["label"] is String, Self.isBoolean(choice["selected"]),
                                Self.validGtdWorkflowEdit(choice["edit"]), let edit = choice["edit"] as? [String: Any],
                                edit["type"] as? String == "taskEditorPreset",
                                Self.equalJSON(edit["value"], choice["value"]) else { return false }
                          return true
                      }), Self.validGtdWorkflowExpected(options["expected"], type: "taskEditorPreset") else {
                    throw HostFailure("Malformed Task Editor preset options")
                }
            }
            if method == "gtdTaskEditorOpenOptions" {
                let sections = Set(["scheduling", "organization", "details"])
                guard value.utf8.count <= 65_536,
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["taskEditor", "expected"]),
                      let editor = options["taskEditor"] as? [String: Any],
                      Set(editor.keys) == Set(["title", "description", "groups"]),
                      editor["title"] is String, editor["description"] is String,
                      let expected = options["expected"] as? [String: Any], Set(expected.keys) == sections,
                      let groups = editor["groups"] as? [[String: Any]], groups.count == 3,
                      Set(groups.compactMap { $0["id"] as? String }) == sections,
                      groups.allSatisfy({ group in
                          guard Set(group.keys) == Set(["id", "title", "defaultOpen"]),
                                let section = group["id"] as? String, group["title"] is String,
                                let row = group["defaultOpen"] as? [String: Any],
                                Set(row.keys) == Set(["label", "description", "value", "edit"]),
                                row["label"] is String, row["description"] is String || row["description"] is NSNull,
                                Self.isBoolean(row["value"]), Self.validGtdWorkflowEdit(row["edit"]),
                                let edit = row["edit"] as? [String: Any], edit["type"] as? String == "taskEditorSectionOpen",
                                edit["section"] as? String == section,
                                Self.equalJSON(edit["value"], !(row["value"] as? Bool ?? false)),
                                Self.validGtdWorkflowExpected(expected[section], type: "taskEditorSectionOpen") else { return false }
                          return true
                      }) else { throw HostFailure("Malformed Task Editor section options") }
            }
            if method == "gtdCaptureParseOptions" {
                let fields = ["quickAddAutoClean", "naturalLanguageDates"]
                guard value.utf8.count <= 65_536,
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["capture", "expected"]),
                      let capture = options["capture"] as? [String: Any],
                      Set(capture.keys) == Set(["title", "description"] + fields),
                      capture["title"] is String, capture["description"] is String,
                      let expected = options["expected"] as? [String: Any], Set(expected.keys) == Set(fields),
                      fields.allSatisfy({ field in
                          guard let row = capture[field] as? [String: Any],
                                Set(row.keys) == Set(["label", "description", "value", "edit"]),
                                row["label"] is String, row["description"] is String || row["description"] is NSNull,
                                Self.isBoolean(row["value"]), Self.validGtdWorkflowEdit(row["edit"]),
                                let edit = row["edit"] as? [String: Any], edit["type"] as? String == field,
                                Self.equalJSON(edit["value"], !(row["value"] as? Bool ?? false)),
                                Self.validGtdWorkflowExpected(expected[field], type: field) else { return false }
                          return true
                      }) else { throw HostFailure("Malformed Capture parsing options") }
            }
            if ["gtdWorkflowOptions", "gtdReviewOptions", "gtdInboxOptions"].contains(method) {
                let reviewing = method == "gtdReviewOptions", inboxing = method == "gtdInboxOptions"
                let contentKey = inboxing ? "inbox" : reviewing ? "review" : "hub"
                let fields = inboxing ? ["inboxTwoMinute", "inboxProjectFirst", "inboxContextStep", "inboxSchedule"] : reviewing ? ["dailyReviewFocusStep", "weeklyReviewContextStep"] : ["defaultScheduleTime", "focusTaskLimit", "focusIncludeStartDates", "defaultProjectFlowMode"]
                guard value.utf8.count <= 65_536,
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set([contentKey, "expected"]),
                      let content = options[contentKey] as? [String: Any], content["title"] is String,
                      let expected = options["expected"] as? [String: Any], Set(expected.keys) == Set(fields),
                      expected.allSatisfy({ Self.validGtdWorkflowExpected($0.value, type: $0.key) }) else {
                    throw HostFailure("Malformed GTD settings options")
                }
                if !reviewing && !inboxing {
                    guard let row = content["focusIncludeStartDates"] as? [String: Any],
                          Set(row.keys) == Set(["label", "description", "value", "edit"]),
                          row["label"] is String, row["description"] is String || row["description"] is NSNull,
                          Self.isBoolean(row["value"]), Self.validGtdWorkflowEdit(row["edit"]),
                          let edit = row["edit"] as? [String: Any], edit["type"] as? String == "focusIncludeStartDates",
                          Self.equalJSON(edit["value"], !(row["value"] as? Bool ?? false)),
                          let witness = expected["focusIncludeStartDates"] as? [String: Any],
                          Self.equalJSON(row["value"], witness["present"] as? Bool == true ? witness["value"] : true) else {
                        throw HostFailure("Malformed Focus start-date options")
                    }
                }
            }
            if method == "gtdWorkflowDraft" {
                guard value.utf8.count <= 1_024,
                      let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(result.keys) == Set(["valid", "value"]), Self.isBoolean(result["valid"]),
                      result["valid"] as? Bool == true ? (result["value"] as? String).map({ $0.utf16.count <= 50 }) == true : result["value"] is NSNull else {
                    throw HostFailure("Malformed GTD workflow draft")
                }
            }
            if method == "generalPreferenceOptions" {
                guard value.utf8.count <= 262_144,
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["model", "expected"]),
                      let model = options["model"] as? [String: Any], model["title"] is String,
                      model["appearance"] is [String: Any], model["regional"] is [String: Any], model["language"] is [String: Any],
                      let expected = options["expected"] as? [String: Any],
                      Set(expected.keys) == Set(["showTaskAge", "weekStart", "dateFormat", "timeFormat", "quickAccessView", "calendarSystem", "theme", "language"]),
                      expected.values.allSatisfy({ Self.validGeneralPreferenceExpected($0) }) else {
                    throw HostFailure("Malformed General preference options")
                }
            }
            if method == "manageTaxonomyOptions" {
                guard value.utf8.count <= 2_000_000, let encoded = args.first as? String,
                      let request = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["kind", "name", "expected", "draft", "text", "confirmation"]),
                      let kind = options["kind"] as? String, Self.equalJSON(kind, request["kind"]),
                      Self.equalJSON(options["name"], request["name"]), Self.validTaxonomyExpected(options["expected"], kind: kind),
                      let draft = options["draft"] as? [String: Any],
                      Set(draft.keys) == Set(["name", "color", "note", "referenceLink"]), draft.values.allSatisfy({ $0 is String }),
                      Self.equalJSON(draft["name"], options["name"]), options["text"] is [String: Any],
                      let confirmation = options["confirmation"] as? [String: Any],
                      Set(confirmation.keys) == Set(["title", "message", "cancelLabel", "confirmLabel"]),
                      confirmation.values.allSatisfy({ $0 is String }) else { throw HostFailure("Malformed taxonomy options") }
            }
            if method == "managePersonEditOptions" {
                guard value.utf8.count <= 2_000_000, let encoded = args.first as? String,
                      let request = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["personId", "expected", "draft"]),
                      let id = options["personId"] as? String, Self.equalJSON(id, request["personId"]),
                      Self.isPersonDeleteExpected(options["expected"], personID: id),
                      let expected = options["expected"] as? [String: Any],
                      let draft = options["draft"] as? [String: Any],
                      Set(draft.keys) == Set(["name", "color", "note", "referenceLink"]), draft.values.allSatisfy({ $0 is String }),
                      Self.equalJSON(draft["name"], expected["name"]),
                      Self.equalJSON(draft["note"], expected["note"] ?? ""),
                      Self.equalJSON(draft["referenceLink"], expected["referenceLink"] ?? "") else {
                    throw HostFailure("Malformed Person edit options")
                }
            }
            if method == "managePersonDeleteOptions" {
                guard value.utf8.count <= 2_000_000, let encoded = args.first as? String,
                      let request = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["personId", "name", "expected", "confirm"]),
                      let id = options["personId"] as? String, Self.equalJSON(id, request["personId"]),
                      Self.isPersonDeleteExpected(options["expected"], personID: id),
                      let expected = options["expected"] as? [String: Any], Self.equalJSON(options["name"], expected["name"]),
                      let confirm = options["confirm"] as? [String: Any],
                      Set(confirm.keys) == Set(["title", "message", "cancelLabel", "confirmLabel"]),
                      confirm.values.allSatisfy({ $0 is String }) else {
                    throw HostFailure("Malformed Person deletion options")
                }
            }
            if method == "focusOrderOptions" {
                try validateFocusOrderOptions(value)
                NSLog("Native iOS Focus order options validated releaseCheck=v1.3.4/ios-focus-order-revision outcome=accepted")
            }
            if method == "focusSavedFilterOptions" { try validateFocusSavedFilterOptions(value) }
            if method == "savedSearchOptions" { try validateSavedSearchOptions(value) }
            if method == "somedaySectionTaskOptions" {
                guard let inputJSON = args.first as? String,
                      let input = try NativeJSON.jsonObject(with: Data(inputJSON.utf8)) as? [String: Any],
                      let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(options.keys) == Set(["revision", "sectionId", "groupTitle", "text"]),
                      (options["revision"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true,
                      Self.equalJSON(options["sectionId"], input["sectionId"]),
                      (options["groupTitle"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 100_000 && !$0.contains("\0") }) == true,
                      let strings = options["text"] as? [String: Any],
                      Set(strings.keys) == Set(["title", "inputLabel", "placeholder", "failed", "created", "saveLabel", "retryLabel", "cancelLabel"]),
                      strings.values.allSatisfy({ ($0 as? String).map({ $0.utf16.count <= 100_000 && !$0.contains("\0") }) == true }) else {
                    throw HostFailure("Malformed Someday section task options")
                }
            }
            if method == "somedaySectionTaskPrepare" {
                guard let inputJSON = args.first as? String,
                      let request = try NativeJSON.jsonObject(with: Data(inputJSON.utf8)) as? [String: Any],
                      let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["kind", "prepared"]), response["kind"] as? String == "prepared",
                      let prepared = response["prepared"] as? [String: Any],
                      let requestID = request["requestId"] as? String,
                      Self.equalJSON(prepared["request"], request) else {
                    throw HostFailure("Malformed Someday section task preparation")
                }
                let envelope = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard envelope.utf8.count <= 1_000_000 else { throw HostFailure("INVALID_INPUT: Someday section task preparation is too large") }
                let expected = String(decoding: try JSONSerialization.data(withJSONObject: ["id": requestID], options: [.sortedKeys]), as: UTF8.self)
                try validateSomedaySectionTaskAcknowledgment(arguments: [envelope], value: expected)
                preparedSomedaySectionTaskEnvelope = Data(envelope.utf8)
            }
            if method == "projectDateOptions", let input = args.first as? String {
                try validateProjectDateOptions(value, request: input)
            }
            if method == "projectAreaOptions", let input = args.first as? String {
                try validateProjectAreaOptions(value, projectID: input)
            }
            if method == "projectTaskSortOptions", let input = args.first as? String,
               let request = try NativeJSON.jsonObject(with: Data(input.utf8)) as? [String: Any],
               let projectID = request["projectId"] as? String {
                try validateProjectTaskSortOptions(value, projectID: projectID)
            }
            if method == "projectTagsEditOptions", let input = args.first as? String {
                try validateProjectTagsEditOptions(value, projectID: input)
            }
            if method == "projectAttachmentEditOptions", let input = args.first as? String,
               let request = try NativeJSON.jsonObject(with: Data(input.utf8)) as? [String: Any],
               let projectID = request["projectId"] as? String {
                try validateProjectAttachmentEditOptions(value, projectID: projectID)
            }
            if method == "inboxStart" {
#if DEBUG
                faults?.commandDiagnostic?("processInboxRead")
#endif
                NSLog("Native iOS Process Inbox opened releaseCheck=v1.3.3/native-ios-process-inbox-read")
            }
            if method == "menuRead", args.first as? String == "focusControls" {
#if DEBUG
                faults?.commandDiagnostic?("focusControlsRead")
#endif
                NSLog("Native iOS Focus controls read releaseCheck=v1.3.3/native-ios-focus-controls")
            }
            if method == "menuRead", args.first as? String == "board", !boardReadLogged {
                boardReadLogged = true
#if DEBUG
                faults?.commandDiagnostic?("boardRead")
#endif
                NSLog("Native iOS Board read releaseCheck=v1.3.3/native-ios-board-read")
            }
            return value
        }
        if method == "focusGroupWrite" {
            do { _ = try invoke("focusGroupValidate", arguments: args) }
            catch let failure as HostFailure where failure.message.hasPrefix("INVALID_INPUT:") {
                throw CoreHostRejection(message: failure.message)
            }
        }
        if method == "taskListSortWrite" {
            do { _ = try invoke("taskListSortValidate", arguments: args) }
            catch let failure as HostFailure where failure.message.hasPrefix("INVALID_INPUT:") {
                throw CoreHostRejection(message: failure.message)
            }
        }
        if method == "unassignedAreaColorWrite" {
            do {
                let validated = try invoke("unassignedAreaColorValidate", arguments: args)
                try validateUnassignedAreaColorAcknowledgment(arguments: args, value: validated)
                if (try NativeJSON.jsonObject(with: Data(validated.utf8)) as? [String: Any])?["changed"] as? Bool == false {
                    let value = try invoke(method, arguments: args)
                    try validateUnassignedAreaColorAcknowledgment(arguments: args, value: value)
                    return value
                }
            } catch let failure as HostFailure where failure.message.hasPrefix("INVALID_INPUT:") || failure.message.hasPrefix("STALE_REVISION:") {
                throw CoreHostRejection(message: failure.message)
            }
        }
        if method == "somedaySectionCreateWrite" {
            do { _ = try invoke("somedaySectionCreateValidate", arguments: args) }
            catch let failure as HostFailure where failure.message.hasPrefix("INVALID_INPUT:") {
                throw CoreHostRejection(message: failure.message)
            }
        }
        if method == "somedaySectionRenameWrite" {
            do {
                let expected = try invoke("somedaySectionRenameValidate", arguments: args)
                let result = try NativeJSON.jsonObject(with: Data(expected.utf8)) as? [String: Any]
                try validateSomedaySectionRenameAcknowledgment(arguments: args, value: expected)
                if result?["changed"] as? Bool == false {
                    let probed = try invoke("somedaySectionRenameRetryOutcome", arguments: args)
                    try validateSomedaySectionRenameAcknowledgment(arguments: args, value: probed)
                    return probed
                }
            } catch let failure as HostFailure where failure.message.hasPrefix("INVALID_INPUT:") || failure.message.hasPrefix("STALE_REVISION:") {
                throw CoreHostRejection(message: failure.message)
            }
        }
        if method == "somedaySectionDeleteWrite" {
            do {
                let expected = try invoke("somedaySectionDeleteValidate", arguments: args)
                try validateSomedaySectionDeleteAcknowledgment(arguments: args, value: expected)
            } catch let failure as HostFailure where failure.message.hasPrefix("INVALID_INPUT:") || failure.message.hasPrefix("STALE_REVISION:") {
                throw CoreHostRejection(message: failure.message)
            }
        }
        if method == "somedaySectionOrderWrite" {
            do {
                let expected = try invoke("somedaySectionOrderValidate", arguments: args)
                try validateSomedaySectionOrderAcknowledgment(arguments: args, value: expected)
            } catch let failure as HostFailure where failure.message.hasPrefix("INVALID_INPUT:") || failure.message.hasPrefix("STALE_REVISION:") {
                throw CoreHostRejection(message: failure.message)
            }
        }
        if method == "somedaySectionTaskCommit" {
            guard let issued = preparedSomedaySectionTaskEnvelope,
                  let submittedJSON = args.first as? String,
                  let submitted = try NativeJSON.jsonObject(with: Data(submittedJSON.utf8)) as? [String: Any],
                  let canonical = try? JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]),
                  canonical == issued else {
                throw CoreHostRejection(message: "INVALID_INPUT: Commit needs the exact host-prepared Someday task")
            }
            do { _ = try invoke("somedaySectionTaskValidate", arguments: args) }
            catch let failure as HostFailure where failure.message.hasPrefix("INVALID_INPUT:") {
                throw CoreHostRejection(message: failure.message)
            }
            preparedSomedaySectionTaskEnvelope = nil
        }
        let command: PendingCommand
        if ["somedaySectionMoveWrite", "somedaySectionMoveUndo"].contains(method) {
            do {
                switch try prepareSomedaySectionMove(method: method, arguments: args) {
                case .noop(let value): return value
                case .command(let prepared): command = prepared
                }
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectFocusWrite" {
            do {
                let value = try invoke("projectFocusPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let projectID = submitted["projectId"] as? String,
                      let desired = submitted["focused"] as? Bool else {
                    throw HostFailure("Malformed Project Focus preparation")
                }
                if kind == "noop" || kind == "blocked" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          (kind == "noop"
                            ? Set(result.keys) == Set(["id", "focused"])
                                && result["id"] as? String == projectID
                                && Self.isBoolean(result["focused"])
                                && result["focused"] as? Bool == desired
                            : Set(result.keys) == Set(["blocked"])
                                && result["blocked"] as? String == "") else {
                        throw HostFailure("Malformed no-write Project Focus result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project Focus")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Focus is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Focus journal is too large") }
                command = PendingCommand(version: 2, method: "projectFocusCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectFocusValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "taskFocusWrite" {
            do {
                let value = try invoke("taskFocusPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Task Focus preparation")
                }
                if kind == "noop" || kind == "blocked" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed no-write Task Focus result")
                    }
                    if kind == "noop" {
                        try validateTaskFocusResult(result, request: submitted)
                    } else {
                        guard Set(result.keys) == Set(["blocked", "blockedTitle"]),
                              let blocked = result["blocked"] as? String, blocked.utf16.count <= 100_000,
                              let title = result["blockedTitle"] as? String, title.utf16.count <= 100_000 else {
                            throw HostFailure("Malformed blocked Task Focus result")
                        }
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let result = prepared["result"] as? [String: Any],
                      Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared Task Focus")
                }
                try validateTaskFocusResult(result, request: request)
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Task Focus is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Task Focus journal is too large") }
                command = PendingCommand(version: 2, method: "taskFocusCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("taskFocusValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "focusOrderWrite" {
            do {
                let value = try invoke("focusOrderPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Focus order preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed Focus order no-op")
                    }
                    try validateFocusOrderResult(result, request: submitted)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let result = prepared["result"] as? [String: Any],
                      Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared Focus order")
                }
                try validateFocusOrderResult(result, request: request)
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Focus order is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "focusOrderCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("focusOrderValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "focusSavedFilterWrite" {
            do {
                let value = try invoke("focusSavedFilterPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Focus saved filter preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed Focus saved filter no-op")
                    }
                    try validateFocusSavedFilterResult(result, request: submitted)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let result = prepared["result"] as? [String: Any],
                      Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared Focus saved filter")
                }
                try validateFocusSavedFilterResult(result, request: request)
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Focus saved filter is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "focusSavedFilterCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("focusSavedFilterValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "savedSearchWrite" {
            do {
                let value = try invoke("savedSearchPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Saved search preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed Saved search no-op")
                    }
                    try validateSavedSearchResult(result, request: submitted)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let result = prepared["result"] as? [String: Any],
                      Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared Saved search")
                }
                try validateSavedSearchResult(result, request: request)
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Saved search is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "savedSearchCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("savedSearchValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectRenameWrite" {
            do {
                let value = try invoke("projectRenamePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let projectID = submitted["projectId"] as? String,
                      let expected = submitted["expected"] as? [String: Any],
                      let currentTitle = expected["title"] as? String else {
                    throw HostFailure("Malformed Project rename preparation")
                }
                if kind == "noop" || kind == "blocked" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          (kind == "noop"
                            ? Set(result.keys) == Set(["id", "title"])
                                && result["id"] as? String == projectID
                                && result["title"] as? String == currentTitle
                            : Set(result.keys) == Set(["blocked"])
                                && result["blocked"] as? String == "") else {
                        throw HostFailure("Malformed no-write Project rename result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project rename")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project rename is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project rename journal is too large") }
                command = PendingCommand(version: 2, method: "projectRenameCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectRenameValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectFlowWrite" {
            do {
                let value = try invoke("projectFlowPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let projectID = submitted["projectId"] as? String else {
                    throw HostFailure("Malformed Project flow preparation")
                }
                if kind == "noop" || kind == "blocked" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          (kind == "noop"
                            ? Set(result.keys) == Set(["id", "isSequential", "sequentialScope"])
                                && result["id"] as? String == projectID
                                && Self.isBoolean(result["isSequential"])
                                && Self.isProjectFlowScope(result["sequentialScope"])
                            : Set(result.keys) == Set(["blocked"])
                                && result["blocked"] as? String == "") else {
                        throw HostFailure("Malformed no-write Project flow result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project flow")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project flow is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project flow journal is too large") }
                command = PendingCommand(version: 2, method: "projectFlowCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectFlowValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectTaskSortWrite" {
            do {
                let value = try invoke("projectTaskSortPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let projectID = submitted["projectId"] as? String else {
                    throw HostFailure("Malformed Project task sort preparation")
                }
                if kind == "noop" || kind == "blocked" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          (kind == "noop"
                            ? Self.validProjectTaskSortResult(result, projectID: projectID)
                                && Self.equalJSON(result["taskSortBy"], (submitted["expected"] as? [String: Any])?["taskSortBy"])
                                && Self.equalJSON(result["taskSortBy"], submitted["sortBy"] as? String == "default"
                                    ? NSNull() : submitted["sortBy"])
                            : Set(result.keys) == Set(["blocked"])
                                && result["blocked"] as? String == "") else {
                        throw HostFailure("Malformed no-write Project task sort result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared Project task sort")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project task sort is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project task sort journal is too large") }
                command = PendingCommand(version: 2, method: "projectTaskSortCommit", argumentsJSON: encoded)
                _ = try invoke("projectTaskSortValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectTaskOrderWrite" {
            do {
                let value = try invoke("projectTaskOrderPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Project task order preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed Project task order no-op")
                    }
                    try validateProjectTaskOrderResult(result, request: submitted)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let result = prepared["result"] as? [String: Any],
                      Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared Project task order")
                }
                try validateProjectTaskOrderResult(result, request: request)
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project task order is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project task order journal is too large") }
                command = PendingCommand(version: 2, method: "projectTaskOrderCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectTaskOrderValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectNotesWrite" {
            do {
                let value = try invoke("projectNotesWritePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let projectID = submitted["projectId"] as? String,
                      let expected = submitted["expected"] as? [String: Any] else {
                    throw HostFailure("Malformed Project Notes write preparation")
                }
                if kind == "noop" || kind == "blocked" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          (kind == "noop"
                            ? Set(result.keys) == Set(["id", "supportNotes"])
                                && result["id"] as? String == projectID
                                && ((result["supportNotes"] is NSNull && expected["supportNotes"] is NSNull)
                                    || (result["supportNotes"] is String && expected["supportNotes"] is String
                                        && (result["supportNotes"] as? String) == (expected["supportNotes"] as? String)))
                            : Set(result.keys) == Set(["blocked"])
                                && result["blocked"] as? String == "") else {
                        throw HostFailure("Malformed no-write Project Notes result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project Notes write")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Notes write is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Notes journal is too large") }
                command = PendingCommand(version: 2, method: "projectNotesWriteCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectNotesWriteValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectTagsWrite" {
            do {
                let value = try invoke("projectTagsWritePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let projectID = submitted["projectId"] as? String,
                      let expected = submitted["expected"] as? [String: Any] else {
                    throw HostFailure("Malformed Project Tags preparation")
                }
                if kind == "noop" || kind == "blocked" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          (kind == "noop"
                            ? Set(result.keys) == Set(["id", "tagIds"])
                                && result["id"] as? String == projectID
                                && Self.validProjectTags(result["tagIds"])
                                && Self.equalJSON(result["tagIds"], expected["tagIds"])
                            : Set(result.keys) == Set(["blocked"])
                                && result["blocked"] as? String == "") else {
                        throw HostFailure("Malformed no-write Project Tags result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project Tags write")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Tags write is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Tags journal is too large") }
                command = PendingCommand(version: 2, method: "projectTagsWriteCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectTagsWriteValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectAttachmentWrite" {
            do {
                let value = try invoke("projectAttachmentWritePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let projectID = submitted["projectId"] as? String else {
                    throw HostFailure("Malformed Project URL link preparation")
                }
                if ["noop", "blocked", "refused"].contains(kind) {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          (kind == "noop" ? Set(result.keys) == Set(["id", "attachmentIds"])
                              && result["id"] as? String == projectID
                              && (result["attachmentIds"] as? [String])?.isEmpty == true
                            : kind == "blocked" ? Set(result.keys) == Set(["blocked"])
                              && result["blocked"] as? String == ""
                            : Set(result.keys) == Set(["message"])
                              && (result["message"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 100_000 }) == true) else {
                        throw HostFailure("Malformed no-write Project URL link result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared Project URL link write")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project URL link write is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project URL link journal is too large") }
                command = PendingCommand(version: 2, method: "projectAttachmentWriteCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectAttachmentWriteValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectStatusWrite" {
            do {
                let value = try invoke("projectStatusPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let projectID = submitted["projectId"] as? String,
                      let desired = submitted["status"] as? String,
                      let expected = submitted["expected"] as? [String: Any] else {
                    throw HostFailure("Malformed Project status preparation")
                }
                if kind == "noop" || kind == "blocked" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          (kind == "noop"
                            ? Set(result.keys) == Set(["id", "status", "isFocused"])
                                && result["id"] as? String == projectID
                                && result["status"] as? String == desired
                                && expected["status"] as? String == desired
                                && ((result["isFocused"] is NSNull && expected["isFocused"] is NSNull)
                                    || (Self.isBoolean(result["isFocused"]) && Self.isBoolean(expected["isFocused"])
                                        && (result["isFocused"] as? Bool) == (expected["isFocused"] as? Bool)))
                            : Set(result.keys) == Set(["blocked"])
                                && result["blocked"] as? String == "") else {
                        throw HostFailure("Malformed no-write Project status result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project status")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project status is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project status journal is too large") }
                command = PendingCommand(version: 2, method: "projectStatusCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectStatusValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectDateWrite" {
            do {
                let value = try invoke("projectDatePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let projectID = submitted["projectId"] as? String,
                      let field = submitted["field"] as? String else {
                    throw HostFailure("Malformed Project date preparation")
                }
                if kind == "noop" || kind == "blocked" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          (kind == "noop"
                            ? Set(result.keys) == Set(["id", "field", "value"])
                                && result["id"] as? String == projectID
                                && result["field"] as? String == field
                                && ((result["value"] is NSNull && submitted["value"] is NSNull)
                                    || (result["value"] is String && submitted["value"] is String
                                        && (result["value"] as? String) == (submitted["value"] as? String)))
                            : Set(result.keys) == Set(["blocked"])
                                && result["blocked"] as? String == "") else {
                        throw HostFailure("Malformed no-write Project date result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project date")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project date is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project date journal is too large") }
                command = PendingCommand(version: 2, method: "projectDateCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectDateValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectAreaWrite" {
            do {
                let value = try invoke("projectAreaPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let projectID = submitted["projectId"] as? String,
                      let expected = submitted["expected"] as? [String: Any] else {
                    throw HostFailure("Malformed Project Area preparation")
                }
                if kind == "noop" || kind == "blocked" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          (kind == "noop"
                            ? Set(result.keys) == Set(["id", "areaId", "areaTitle", "order"])
                                && result["id"] as? String == projectID
                                && Self.equalJSON(result["areaId"], submitted["areaId"])
                                && Self.equalJSON(result["areaId"], expected["areaId"])
                                && Self.equalJSON(result["areaTitle"], expected["areaTitle"])
                                && Self.isFiniteNumber(result["order"])
                                && Self.equalJSON(result["order"], expected["order"])
                            : Set(result.keys) == Set(["blocked"])
                                && result["blocked"] as? String == "") else {
                        throw HostFailure("Malformed no-write Project Area result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project Area")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Area is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Area journal is too large") }
                command = PendingCommand(version: 2, method: "projectAreaCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectAreaValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "appLock" {
            do {
                let value = try invoke("appLockPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed App lock write preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed no-write App lock result")
                    }
                    try validateAppLockResult(result, request: submitted)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any], Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared App lock write")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 8_192 else { throw HostFailure("INVALID_INPUT: Prepared App lock write is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 18_192 else { throw HostFailure("INVALID_INPUT: Prepared App lock write journal is too large") }
                command = PendingCommand(version: 2, method: "appLockCommit", argumentsJSON: encoded)
                _ = try invoke("appLockValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "gtdWorkflow" {
            do {
                let value = try invoke("gtdWorkflowPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed GTD workflow write preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed no-write GTD workflow result")
                    }
                    try validateGtdWorkflowResult(result, request: submitted, changed: false)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any], Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared GTD workflow write")
                }
                let archive = (submitted["edit"] as? [String: Any])?["type"] as? String == "autoArchiveDays"
                guard archive ? prepared["archiveEffects"] is [[String: Any]] : prepared["archiveEffects"] == nil else {
                    throw HostFailure("Malformed prepared GTD workflow effects")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= (archive ? 2_000_000 : 8_192) else { throw HostFailure("INVALID_INPUT: Prepared GTD workflow write is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= (archive ? 12_000_000 : 18_192) else { throw HostFailure("INVALID_INPUT: Prepared GTD workflow write journal is too large") }
                command = PendingCommand(version: 2, method: "gtdWorkflowCommit", argumentsJSON: encoded)
                _ = try invoke("gtdWorkflowValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "generalPreference" {
            do {
                let value = try invoke("generalPreferencePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed General preference write preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed no-write General preference result")
                    }
                    try validateGeneralPreferenceResult(result, request: submitted)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any], Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared General preference write")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 8_192 else { throw HostFailure("INVALID_INPUT: Prepared General preference write is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 18_192 else { throw HostFailure("INVALID_INPUT: Prepared General preference write journal is too large") }
                command = PendingCommand(version: 2, method: "generalPreferenceCommit", argumentsJSON: encoded)
                _ = try invoke("generalPreferenceValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "manageTaxonomy" {
            do {
                let value = try invoke("manageTaxonomyPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed taxonomy write preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed no-write taxonomy result")
                    }
                    try validateTaxonomyResult(result, request: submitted)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any], Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared taxonomy write")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared taxonomy write is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared taxonomy write journal is too large") }
                command = PendingCommand(version: 2, method: "manageTaxonomyCommit", argumentsJSON: encoded)
                _ = try invoke("manageTaxonomyValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "managePersonEdit" {
            do {
                let value = try invoke("managePersonEditPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Person edit preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any],
                          let expected = submitted["expected"] as? [String: Any],
                          Self.equalJSON(result["personId"], submitted["personId"]),
                          Self.equalJSON(result["name"], expected["name"]) else { throw HostFailure("Malformed no-write Person edit result") }
                    try validatePersonEditResult(result, request: submitted)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any], Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared Person edit")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Person edit is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Person edit journal is too large") }
                command = PendingCommand(version: 2, method: "managePersonEditCommit", argumentsJSON: encoded)
                _ = try invoke("managePersonEditValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "managePersonDelete" {
            do {
                let value = try invoke("managePersonDeletePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared Person deletion")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Person deletion is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Person deletion journal is too large") }
                command = PendingCommand(version: 2, method: "managePersonDeleteCommit", argumentsJSON: encoded)
                _ = try invoke("managePersonDeleteValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "areaDelete" || method == "manageAreaDelete" {
            do {
                let value = try invoke("areaDeletePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Area deletion")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Area deletion is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Area deletion journal is too large") }
                command = PendingCommand(version: 2, method: method == "manageAreaDelete" ? "manageAreaDeleteCommit" : "areaDeleteCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("areaDeleteValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "areaOrder" {
            do {
                let value = try invoke("areaOrderPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Area order preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          Set(result.keys) == Set(["orderedIds"]),
                          let ids = result["orderedIds"] as? [String], ids.isEmpty,
                          let expected = submitted["expectedAreas"] as? [[String: Any]], expected.isEmpty,
                          let intent = submitted["intent"] as? [String: Any],
                          ["sortName", "sortColor"].contains(intent["kind"] as? String ?? "") else {
                        throw HostFailure("Malformed no-write Area order result")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Area order")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Area order is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Area order journal is too large") }
                command = PendingCommand(version: 2, method: "areaOrderCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("areaOrderValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "areaColor" {
            do {
                let value = try invoke("areaColorPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Area color change")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Area color change is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Area color journal is too large") }
                command = PendingCommand(version: 2, method: "areaColorCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("areaColorValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "areaRename" || method == "manageAreaEdit" {
            do {
                let value = try invoke("areaRenamePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Area rename preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed no-write Area rename result")
                    }
                    try validateAreaRenameResult(result, request: submitted, noOp: true)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Area rename")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Area rename is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Area rename journal is too large") }
                command = PendingCommand(version: 2, method: method == "manageAreaEdit" ? "manageAreaEditCommit" : "areaRenameCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("areaRenameValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "managePersonCreate" {
            do {
                let value = try invoke("managePersonCreatePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String, let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Person creation preparation")
                }
                if kind == "existing" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed existing Person result")
                    }
                    try validatePersonCreateResult(result, request: submitted, created: false)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any], Self.equalJSON(request, submitted) else {
                    throw HostFailure("Malformed prepared Person creation")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Person creation is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Person journal is too large") }
                command = PendingCommand(version: 2, method: "managePersonCreateCommit", argumentsJSON: encoded)
                _ = try invoke("managePersonCreateValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "areaCreate" || method == "manageAreaCreate" {
            do {
                let value = try invoke("areaCreatePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String, let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Area creation preparation")
                }
                if kind == "existing" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed existing Area result")
                    }
                    try validateAreaCreateResult(result, request: submitted, created: false)
#if DEBUG
                    faults?.commandDiagnostic?(method == "manageAreaCreate" ? "manageAreaCreateDuplicate" : "areaCreateDuplicate")
#endif
                    if method == "areaCreate" {
                        NSLog("Native iOS Area duplicate used releaseCheck=v1.3.3/native-ios-area-create outcome=duplicate")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Area creation")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Area creation is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Area journal is too large") }
                command = PendingCommand(version: 2, method: method == "manageAreaCreate" ? "manageAreaCreateCommit" : "areaCreateCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("areaCreateValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectSectionCreate" {
            do {
                let value = try invoke("projectSectionCreatePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["kind", "prepared"]),
                      response["kind"] as? String == "prepared",
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let result = prepared["result"] as? [String: Any],
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project Section creation")
                }
                try validateProjectSectionCreateResult(result, request: request)
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Section creation is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Section journal is too large") }
                command = PendingCommand(version: 2, method: "projectSectionCreateCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectSectionCreateValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectSectionRename" {
            do {
                let value = try invoke("projectSectionRenamePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String,
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Project Section rename preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed no-write Project Section rename result")
                    }
                    try validateProjectSectionRenameResult(result, request: submitted)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let result = prepared["result"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project Section rename")
                }
                try validateProjectSectionRenameResult(result, request: request)
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Section rename is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Section rename journal is too large") }
                command = PendingCommand(version: 2, method: "projectSectionRenameCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectSectionRenameValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectSectionDelete" {
            do {
                let value = try invoke("projectSectionDeletePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["kind", "prepared"]),
                      response["kind"] as? String == "prepared",
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let result = prepared["result"] as? [String: Any],
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project Section deletion")
                }
                try validateProjectSectionDeleteResult(result, request: request)
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Section deletion is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Section deletion journal is too large") }
                command = PendingCommand(version: 2, method: "projectSectionDeleteCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectSectionDeleteValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectSectionOrder" {
            do {
                let value = try invoke("projectSectionOrderPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["kind", "prepared"]),
                      response["kind"] as? String == "prepared",
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      let result = prepared["result"] as? [String: Any],
                      let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Project Section order")
                }
                try validateProjectSectionOrderResult(result, request: request)
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Section order is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Project Section order journal is too large") }
                command = PendingCommand(version: 2, method: "projectSectionOrderCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectSectionOrderValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "projectCreate" {
            do {
                let value = try invoke("projectCreatePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String, let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed project creation preparation")
                }
                if kind == "existing" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed existing project result")
                    }
                    try validateProjectCreateResult(result, request: submitted, created: false)
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared project creation")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared project creation is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared project journal is too large") }
                command = PendingCommand(version: 2, method: "projectCreateCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke("projectCreateValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "taskDelete" {
            do {
                guard let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("INVALID_INPUT: Task Delete needs a bounded request")
                }
                let value = try invoke("taskDeletePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["kind", "prepared"]), response["kind"] as? String == "prepared",
                      let prepared = response["prepared"] as? [String: Any],
                      Self.equalJSON(prepared["request"], submitted) else {
                    throw HostFailure("Malformed Task Delete preparation")
                }
                let envelope = String(decoding: try JSONSerialization.data(withJSONObject: ["request": submitted, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard envelope.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Task Delete journal is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [envelope]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Task Delete journal is too large") }
                command = PendingCommand(version: 2, method: "taskDeleteCommit", argumentsJSON: encoded,
                                         editorDraft: editorAttempt)
                _ = try invoke("taskDeleteValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "taskPromote" {
            do {
                guard let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("INVALID_INPUT: Task promotion needs a bounded request")
                }
                let value = try invoke("prepareTaskPromotion", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["kind", "prepared"]), response["kind"] as? String == "prepared",
                      let prepared = response["prepared"] as? [String: Any],
                      Self.equalJSON(prepared["request"], submitted) else {
                    throw HostFailure("Malformed Task promotion preparation")
                }
                let envelope = String(decoding: try JSONSerialization.data(withJSONObject: ["request": submitted, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard envelope.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Task promotion journal is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [envelope]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Task promotion journal is too large") }
                command = PendingCommand(version: 2, method: "taskPromoteCommit", argumentsJSON: encoded,
                                         editorDraft: editorAttempt)
                _ = try invoke("validatePreparedTaskPromotion", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "taskDeleteUndo" {
            do {
                guard let encodedRequest = args.first as? String,
                      let request = try NativeJSON.jsonObject(with: Data(encodedRequest.utf8)) as? [String: Any],
                      let confirmed = confirmedTaskDeleteEnvelope,
                      let deletion = try NativeJSON.jsonObject(with: Data(confirmed.utf8)) as? [String: Any],
                      let original = deletion["request"] as? [String: Any],
                      Self.equalJSON(request["deleteRequestId"], original["requestId"]) else {
                    throw HostFailure("INVALID_INPUT: Undo needs the confirmed Task Delete")
                }
                let input = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "delete": deletion], options: [.sortedKeys]), as: UTF8.self)
                let value = try invoke("taskDeleteUndoPrepare", arguments: [input])
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["kind", "prepared"]), response["kind"] as? String == "prepared",
                      let prepared = response["prepared"] as? [String: Any], Self.equalJSON(prepared["request"], request) else {
                    throw HostFailure("Malformed Task Delete Undo preparation")
                }
                let envelope = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard envelope.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Task Delete Undo journal is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [envelope]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Task Delete Undo journal is too large") }
                command = PendingCommand(version: 2, method: "taskDeleteUndoCommit", argumentsJSON: encoded)
                _ = try invoke("taskDeleteUndoValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "taskCancellationUndo" {
            do {
                guard let encodedRequest = args.first as? String,
                      let request = try NativeJSON.jsonObject(with: Data(encodedRequest.utf8)) as? [String: Any],
                      let confirmed = confirmedTaskCancellationEnvelope,
                      let cancel = try NativeJSON.jsonObject(with: Data(confirmed.utf8)) as? [String: Any],
                      let original = cancel["request"] as? [String: Any],
                      Self.equalJSON(request["cancelRequestId"], original["requestId"]) else {
                    throw HostFailure("INVALID_INPUT: Undo needs the confirmed cancellation")
                }
                let input = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "cancel": cancel], options: [.sortedKeys]), as: UTF8.self)
                let value = try invoke("taskCancellationUndoPrepare", arguments: [input])
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["kind", "prepared"]), response["kind"] as? String == "prepared",
                      let prepared = response["prepared"] as? [String: Any], Self.equalJSON(prepared["request"], request) else {
                    throw HostFailure("Malformed cancellation Undo preparation")
                }
                let envelope = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [envelope]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "taskCancellationUndoCommit", argumentsJSON: encoded)
                _ = try invoke("taskCancellationUndoValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if ["checklistSave", "checklistReset"].contains(method) {
            do {
                let value = try invoke(method == "checklistSave" ? "checklistSavePrepare" : "checklistResetPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String, let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed checklist preparation")
                }
                if method == "checklistReset", kind == "unchanged" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any] else {
                        throw HostFailure("Malformed unchanged checklist reset")
                    }
                    try validateChecklistResult(result, request: submitted, kind: "reset")
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      Self.isInteger(prepared["version"], equalTo: 1),
                      prepared["kind"] as? String == (method == "checklistSave" ? "save" : "reset"),
                      let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared checklist write")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                guard commit.utf8.count <= 2_000_000 else { throw HostFailure("INVALID_INPUT: Prepared checklist write is too large") }
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                guard encoded.utf8.count <= 12_000_000 else { throw HostFailure("INVALID_INPUT: Prepared checklist journal is too large") }
                command = PendingCommand(version: 2, method: "checklistPreparedCommit", argumentsJSON: encoded,
                                         editorDraft: editorAttempt)
                _ = try invoke("checklistPreparedValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if ["inboxCommit", "inboxSkip"].contains(method) {
            do {
                let value = try invoke(method == "inboxCommit" ? "inboxCommitPrepare" : "inboxSkipPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String else { throw HostFailure("Malformed Process Inbox preparation") }
                if kind == "flow" {
                    guard Set(response.keys) == Set(["kind", "result"]),
                          let result = response["result"] as? [String: Any],
                          Set(result.keys) == Set(["view", "notice", "toast"]) else {
                        throw HostFailure("Malformed Process Inbox flow result")
                    }
                    return value
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any], let original = args.first as? String,
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: NativeJSON.jsonObject(with: Data(original.utf8)), options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Process Inbox choice")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "inboxPreparedCommit", argumentsJSON: encoded)
                _ = try invoke("inboxPreparedValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "mindSweepAdd" {
            do {
                let value = try invoke("mindSweepPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["kind", "prepared"]), response["kind"] as? String == "prepared",
                      let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any], let original = args.first as? String,
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: NativeJSON.jsonObject(with: Data(original.utf8)), options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Mind Sweep add")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "mindSweepCommit", argumentsJSON: encoded)
                _ = try invoke("mindSweepValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "calendarDelete" {
            do {
                let value = try invoke("calendarDeletePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      Set(response.keys) == Set(["kind", "prepared"]), response["kind"] as? String == "prepared",
                      let prepared = response["prepared"] as? [String: Any], let request = prepared["request"] as? [String: Any],
                      let original = args.first as? String,
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: NativeJSON.jsonObject(with: Data(original.utf8)), options: [.sortedKeys]) else {
                    throw HostFailure("Malformed Calendar Delete preparation")
                }
                let envelope = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [envelope]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "calendarDeleteCommit", argumentsJSON: encoded)
                _ = try invoke("calendarDeleteValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "calendarUnschedule" {
            do {
                let value = try invoke("calendarUnschedulePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String, let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any] else {
                    throw HostFailure("Malformed Calendar Unschedule preparation")
                }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any],
                          Set(result.keys) == Set(["changed", "toast", "next", "scrollToMinutes", "composer", "taskId"]),
                          Self.isBoolean(result["changed"]), result["changed"] as? Bool == false,
                          result["taskId"] as? String == submitted["taskId"] as? String,
                          ["toast", "next", "scrollToMinutes", "composer"].allSatisfy({ result[$0] is NSNull }) else {
                        throw HostFailure("Malformed Calendar Unschedule no-op")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any], let request = prepared["request"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: submitted, options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Calendar Unschedule")
                }
                let envelope = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [envelope]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "calendarUnscheduleCommit", argumentsJSON: encoded)
                _ = try invoke("calendarUnscheduleValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "calendarComposerSave" {
            do {
                guard let original = args.first as? String,
                      let submitted = try NativeJSON.jsonObject(with: Data(original.utf8)) as? [String: Any],
                      let composer = submitted["composer"] as? [String: Any],
                      let mode = composer["mode"] as? String, ["existing", "new"].contains(mode) else {
                    throw HostFailure("Malformed Calendar composer request")
                }
                let creating = mode == "new"
                let value = try invoke(creating ? "calendarComposerCreatePrepare" : "calendarComposerPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String else { throw HostFailure("Malformed Calendar preparation") }
                if kind == "refused" || kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any],
                          Set(result.keys) == Set(["changed", "toast", "next", "scrollToMinutes", "composer", "taskId"]),
                          result["changed"] as? Bool == false else { throw HostFailure("Malformed Calendar no-write result") }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any], let request = prepared["request"] as? [String: Any],
                      let submittedID = submitted["requestId"] as? String,
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: ["requestId": submittedID, "composer": composer], options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Calendar schedule")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                command = PendingCommand(version: 2, method: creating ? "calendarComposerCreateCommit" : "calendarComposerCommit", argumentsJSON: encoded)
                _ = try journalArguments(command)
                _ = try invoke(creating ? "calendarComposerCreateValidate" : "calendarComposerValidate", arguments: journalArguments(command))
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "boardAction" {
            do {
                let value = try invoke("boardPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String else { throw HostFailure("Malformed Board preparation") }
                if kind == "noop" {
                    guard let result = response["result"] as? [String: Any], Set(result.keys) == Set(["changed", "open"]),
                          Self.isBoolean(result["changed"]), result["changed"] as? Bool == false, result["open"] is NSNull else {
                        throw HostFailure("Malformed Board no-op")
                    }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any], let original = args[0] as? String,
                      try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]) == JSONSerialization.data(withJSONObject: NativeJSON.jsonObject(with: Data(original.utf8)), options: [.sortedKeys]) else {
                    throw HostFailure("Malformed prepared Board action")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "boardCommit", argumentsJSON: encoded,
                                         editorDraft: editorAttempt)
                _ = try journalArguments(command)
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "captureSubmit" {
            do {
                let value = try invoke("capturePrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String else { throw HostFailure("Malformed capture preparation") }
                if kind == "refused" || kind == "confirmLines" { return value }
                guard kind == "prepared", let prepared = response["prepared"] as? [String: Any],
                      let request = prepared["request"] as? [String: Any] else { throw HostFailure("Malformed prepared capture") }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "captureCommit", argumentsJSON: encoded)
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else if method == "saveDraft",
                  let inputJSON = args.first as? String,
                  let input = try NativeJSON.jsonObject(with: Data(inputJSON.utf8)) as? [String: Any],
                  input["scheduleBase"] != nil {
            do {
                let value = try invoke("draftPrepare", arguments: args)
                guard let response = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                      let kind = response["kind"] as? String else { throw HostFailure("Malformed editor preparation") }
                if kind == "noop" {
                    guard Set(response.keys) == Set(["kind", "result"]), let result = response["result"] as? [String: Any],
                          Set(result.keys) == Set(["id", "draft"]), Self.equalJSON(result["id"], input["id"]),
                          result["draft"] is [String: Any] else { throw HostFailure("Malformed editor no-op") }
                    return String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
                }
                guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
                      let prepared = response["prepared"] as? [String: Any], Self.isInteger(prepared["version"], equalTo: 2),
                      let request = prepared["request"] as? [String: Any], Self.equalJSON(input, request) else {
                    throw HostFailure("Malformed prepared editor save")
                }
                let commit = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [commit]), as: UTF8.self)
                command = PendingCommand(version: 2, method: "draftCommit", argumentsJSON: encoded,
                                         editorDraft: editorAttempt)
                try validateDraftAcknowledgment(command)
            } catch { throw CoreHostRejection(message: error.localizedDescription) }
        } else {
            command = PendingCommand(version: 2, method: method, argumentsJSON: argumentsJSON)
        }
        pending = command
        try persist(command)
        let terminal: TerminalResult
        do {
            terminal = .success(try invoke(command.method, arguments: journalArguments(command)))
        } catch {
            // These codes prove the first attempt stopped before its write. A
            // replay rejection cannot prove an earlier uncertain attempt did not.
            if let failure = error as? HostFailure,
               isDefiniteRejection(failure.message, method: command.method) { terminal = .rejected(failure.message) }
            else { throw error }
        }
        let finished = try finish(command, with: terminal)
        if case .success = finished {
            rememberConfirmedSomedayMove(command)
            rememberConfirmedTaskCancellation(command)
            rememberConfirmedTaskDelete(command)
        }
        return try publicValue(finished, method: command.method)
    }

    func retryPending() throws -> String? {
        dispatchPrecondition(condition: .onQueue(queue))
        let command = pending
        let method = command?.method
        let terminal = try resolvePending()
        try resumeActivationIfNeeded()
        guard let terminal else { return nil }
        if case .success = terminal, let command {
            rememberConfirmedSomedayMove(command)
            rememberConfirmedTaskCancellation(command)
            rememberConfirmedTaskDelete(command)
        }
        return try publicValue(terminal, method: method)
    }

    private func validateDraftAcknowledgment(_ command: PendingCommand, value: String? = nil) throws {
        let encoded = try invoke("draftValidate", arguments: journalArguments(command))
        guard let validation = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any] else {
            throw HostFailure("Malformed editor validation")
        }
        let expected: [String: Any]?
        let id: String
        if Self.isInteger(validation["version"], equalTo: 1) {
            guard Set(validation.keys) == Set(["version", "id"]), let identifier = validation["id"] as? String else {
                throw HostFailure("Malformed legacy editor validation")
            }
            expected = nil; id = identifier
        } else {
            guard Self.isInteger(validation["version"], equalTo: 2), Set(validation.keys) == Set(["version", "result"]),
                  let result = validation["result"] as? [String: Any], Set(result.keys) == Set(["id", "draft"]),
                  let identifier = result["id"] as? String, result["draft"] is [String: Any] else {
                throw HostFailure("Malformed editor validation")
            }
            expected = result; id = identifier
        }
        if let value {
            guard let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
                  Set(result.keys) == Set(["id", "draft"]), result["id"] as? String == id,
                  result["draft"] is [String: Any], expected == nil || Self.equalJSON(expected, result) else {
                throw HostFailure("Malformed editor acknowledgment")
            }
        }
    }

    private func publicValue(_ terminal: TerminalResult, method: String?) throws -> String {
        let value = try terminal.value()
        guard method == "inboxPreparedCommit" else { return value }
        let result = try NativeJSON.jsonObject(with: Data(value.utf8))
        return String(decoding: try JSONSerialization.data(withJSONObject: ["kind": "saved", "result": result], options: [.sortedKeys]), as: UTF8.self)
    }

    private func resumeActivationIfNeeded() throws {
        guard recoveryActivationPending else { return }
        _ = try invoke("resumeActivation", arguments: [])
        recoveryActivationPending = false
        NSLog("Native iOS journal recovery releaseCheck=v1.3.3/native-ios-journal-recovery outcome=recovered")
    }

    private func resolvePending() throws -> TerminalResult? {
        guard started, !closed else { throw HostFailure("Core host is not ready; retry startup") }
        guard let command = pending else { return nil }
        if let terminal = command.terminal {
            if command.method == "somedaySectionCreateWrite", case .success(let value) = terminal {
                let probed = try invoke("somedaySectionCreateRetryOutcome", arguments: journalArguments(command))
                try validateSomedaySectionCreateAcknowledgment(command, value: probed)
                try validateSomedaySectionCreateAcknowledgment(command, value: value)
            }
            if command.method == "somedaySectionRenameWrite", case .success(let value) = terminal {
                let probed = try invoke("somedaySectionRenameRetryOutcome", arguments: journalArguments(command))
                try validateSomedaySectionRenameAcknowledgment(command, value: probed)
                try validateSomedaySectionRenameAcknowledgment(command, value: value)
            }
            if command.method == "unassignedAreaColorWrite", case .success(let value) = terminal {
                let probed = try invoke("unassignedAreaColorRetryOutcome", arguments: journalArguments(command))
                try validateUnassignedAreaColorAcknowledgment(command, value: probed)
                try validateUnassignedAreaColorAcknowledgment(command, value: value)
            }
            if command.method == "somedaySectionDeleteWrite", case .success(let value) = terminal {
                let probed = try invoke("somedaySectionDeleteRetryOutcome", arguments: journalArguments(command))
                try validateSomedaySectionDeleteAcknowledgment(command, value: probed)
                try validateSomedaySectionDeleteAcknowledgment(command, value: value)
            }
            if command.method == "somedaySectionOrderWrite", case .success(let value) = terminal {
                let probed = try invoke("somedaySectionOrderRetryOutcome", arguments: journalArguments(command))
                try validateSomedaySectionOrderAcknowledgment(command, value: probed)
                try validateSomedaySectionOrderAcknowledgment(command, value: value)
            }
            if command.method == "somedaySectionTaskCommit", case .success(let value) = terminal {
                let probed = try invoke("somedaySectionTaskRetryOutcome", arguments: journalArguments(command))
                try validateSomedaySectionTaskAcknowledgment(command, value: probed)
                try validateSomedaySectionTaskAcknowledgment(command, value: value)
            }
            if ["somedaySectionMoveCommit", "somedaySectionMoveUndoCommit"].contains(command.method), case .success(let value) = terminal {
                let probed = try invoke(command.method == "somedaySectionMoveCommit"
                    ? "somedaySectionMoveRetryOutcome" : "somedaySectionMoveUndoRetryOutcome",
                    arguments: journalArguments(command))
                try validateSomedaySectionMoveAcknowledgment(command, value: probed)
                try validateSomedaySectionMoveAcknowledgment(command, value: value)
            }
            return try finish(command, with: terminal)
        }
        // Also repairs a failed journal promotion before any execution can occur.
        try persist(command)
        // A rejection here remains ambiguous: an earlier execution may have
        // succeeded. Only a successful exact replay establishes its terminal value.
        let value: String
        do { value = try invoke(command.method, arguments: journalArguments(command)) }
        catch let failure as HostFailure {
            if command.method == "appLockCommit", recoveryActivationPending, failure.message.hasPrefix("STALE_REVISION:") {
                unresolvedAppLockRecovery = true
                throw CoreHostAppLockRecovery()
            }
            throw failure
        }
        return try finish(command, with: .success(value))
    }

    private func finish(_ command: PendingCommand, with terminal: TerminalResult) throws -> TerminalResult {
        if command.method == "draftCommit" {
            if case .success(let value) = terminal { try validateDraftAcknowledgment(command, value: value) }
            else { try validateDraftAcknowledgment(command) }
        }
        if command.method == "boardCommit" {
            _ = try invoke("boardValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateBoardAcknowledgment(command, value: value) }
        }
        if command.method == "taskDeleteCommit" {
            _ = try invoke("taskDeleteValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validatePreparedAcknowledgment(command, value: value) }
        }
        if command.method == "taskPromoteCommit" {
            _ = try invoke("validatePreparedTaskPromotion", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validatePreparedAcknowledgment(command, value: value) }
        }
        if command.method == "taskDeleteUndoCommit" {
            _ = try invoke("taskDeleteUndoValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validatePreparedAcknowledgment(command, value: value) }
        }
        if command.method == "calendarDeleteCommit" {
            _ = try invoke("calendarDeleteValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateCalendarDeleteAcknowledgment(command, value: value) }
        }
        if command.method == "calendarUnscheduleCommit" {
            _ = try invoke("calendarUnscheduleValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateCalendarAcknowledgment(command, value: value) }
        }
        if ["calendarComposerCommit", "calendarComposerCreateCommit"].contains(command.method) {
            _ = try invoke(command.method == "calendarComposerCommit" ? "calendarComposerValidate" : "calendarComposerCreateValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateCalendarAcknowledgment(command, value: value) }
        }
        if command.method == "mindSweepCommit" {
            _ = try invoke("mindSweepValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateMindSweepAcknowledgment(command, value: value) }
        }
        if command.method == "inboxPreparedCommit" {
            _ = try invoke("inboxPreparedValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validatePreparedAcknowledgment(command, value: value) }
        }
        if command.method == "taskCancellationUndoCommit" {
            _ = try invoke("taskCancellationUndoValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validatePreparedAcknowledgment(command, value: value) }
        }
        if command.method == "checklistPreparedCommit" {
            _ = try invoke("checklistPreparedValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validatePreparedAcknowledgment(command, value: value) }
        }
        if command.method == "projectCreateCommit" {
            _ = try invoke("projectCreateValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectCreateAcknowledgment(command, value: value) }
        }
        if command.method == "projectSectionCreateCommit" {
            _ = try invoke("projectSectionCreateValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectSectionCreateAcknowledgment(command, value: value) }
        }
        if command.method == "projectSectionRenameCommit" {
            _ = try invoke("projectSectionRenameValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectSectionRenameAcknowledgment(command, value: value) }
        }
        if command.method == "projectSectionDeleteCommit" {
            _ = try invoke("projectSectionDeleteValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectSectionDeleteAcknowledgment(command, value: value) }
        }
        if command.method == "projectSectionOrderCommit" {
            _ = try invoke("projectSectionOrderValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectSectionOrderAcknowledgment(command, value: value) }
        }
        if command.method == "appLockCommit" {
            _ = try invoke("appLockValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateAppLockAcknowledgment(command, value: value) }
        }
        if command.method == "gtdWorkflowCommit" {
            _ = try invoke("gtdWorkflowValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateGtdWorkflowAcknowledgment(command, value: value) }
        }
        if command.method == "generalPreferenceCommit" {
            _ = try invoke("generalPreferenceValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateGeneralPreferenceAcknowledgment(command, value: value) }
        }
        if command.method == "manageTaxonomyCommit" {
            _ = try invoke("manageTaxonomyValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateTaxonomyAcknowledgment(command, value: value) }
        }
        if command.method == "managePersonEditCommit" {
            _ = try invoke("managePersonEditValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validatePersonEditAcknowledgment(command, value: value) }
        }
        if command.method == "managePersonDeleteCommit" {
            _ = try invoke("managePersonDeleteValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validatePersonDeleteAcknowledgment(command, value: value) }
        }
        if command.method == "managePersonCreateCommit" {
            _ = try invoke("managePersonCreateValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validatePersonCreateAcknowledgment(command, value: value) }
        }
        if ["areaCreateCommit", "manageAreaCreateCommit"].contains(command.method) {
            _ = try invoke("areaCreateValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateAreaCreateAcknowledgment(command, value: value) }
        }
        if command.method == "areaColorCommit" {
            _ = try invoke("areaColorValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateAreaColorAcknowledgment(command, value: value) }
        }
        if ["areaRenameCommit", "manageAreaEditCommit"].contains(command.method) {
            _ = try invoke("areaRenameValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateAreaRenameAcknowledgment(command, value: value) }
        }
        if command.method == "areaOrderCommit" {
            _ = try invoke("areaOrderValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateAreaOrderAcknowledgment(command, value: value) }
        }
        if ["areaDeleteCommit", "manageAreaDeleteCommit"].contains(command.method) {
            _ = try invoke("areaDeleteValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateAreaDeleteAcknowledgment(command, value: value) }
        }
        if command.method == "projectFocusCommit" {
            _ = try invoke("projectFocusValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectFocusAcknowledgment(command, value: value) }
        }
        if command.method == "taskFocusCommit" {
            _ = try invoke("taskFocusValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateTaskFocusAcknowledgment(command, value: value) }
        }
        if command.method == "focusOrderCommit" {
            _ = try invoke("focusOrderValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateFocusOrderAcknowledgment(command, value: value) }
        }
        if command.method == "focusSavedFilterCommit" {
            _ = try invoke("focusSavedFilterValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateFocusSavedFilterAcknowledgment(command, value: value) }
        }
        if command.method == "savedSearchCommit" {
            _ = try invoke("savedSearchValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateSavedSearchAcknowledgment(command, value: value) }
        }
        if command.method == "projectRenameCommit" {
            _ = try invoke("projectRenameValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectRenameAcknowledgment(command, value: value) }
        }
        if command.method == "projectFlowCommit" {
            _ = try invoke("projectFlowValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectFlowAcknowledgment(command, value: value) }
        }
        if command.method == "projectTaskSortCommit" {
            _ = try invoke("projectTaskSortValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectTaskSortAcknowledgment(command, value: value) }
        }
        if command.method == "projectTaskOrderCommit" {
            _ = try invoke("projectTaskOrderValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectTaskOrderAcknowledgment(command, value: value) }
        }
        if command.method == "projectNotesWriteCommit" {
            _ = try invoke("projectNotesWriteValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectNotesWriteAcknowledgment(command, value: value) }
        }
        if command.method == "projectTagsWriteCommit" {
            _ = try invoke("projectTagsWriteValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectTagsWriteAcknowledgment(command, value: value) }
        }
        if command.method == "projectAttachmentWriteCommit" {
            _ = try invoke("projectAttachmentWriteValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectAttachmentWriteAcknowledgment(command, value: value) }
        }
        if command.method == "projectStatusCommit" {
            _ = try invoke("projectStatusValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectStatusAcknowledgment(command, value: value) }
        }
        if command.method == "projectDateCommit" {
            _ = try invoke("projectDateValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectDateAcknowledgment(command, value: value) }
        }
        if command.method == "projectAreaCommit" {
            _ = try invoke("projectAreaValidate", arguments: journalArguments(command))
            if case .success(let value) = terminal { try validateProjectAreaAcknowledgment(command, value: value) }
        }
        if command.method == "focusGroupWrite" {
            try validateFocusGroupJournal(command)
            if case .success(let value) = terminal { try validateFocusGroupAcknowledgment(command, value: value) }
        }
        if command.method == "taskListSortWrite" {
            try validateTaskListSortJournal(command)
            if case .success(let value) = terminal { try validateTaskListSortAcknowledgment(command, value: value) }
        }
        if command.method == "unassignedAreaColorWrite" {
            try validateUnassignedAreaColorJournal(command)
            if case .success(let value) = terminal { try validateUnassignedAreaColorAcknowledgment(command, value: value) }
        }
        if command.method == "somedaySectionCreateWrite" {
            try validateSomedaySectionCreateJournal(command)
            if case .success(let value) = terminal { try validateSomedaySectionCreateAcknowledgment(command, value: value) }
        }
        if command.method == "somedaySectionRenameWrite" {
            try validateSomedaySectionRenameJournal(command)
            if case .success(let value) = terminal { try validateSomedaySectionRenameAcknowledgment(command, value: value) }
        }
        if command.method == "somedaySectionDeleteWrite" {
            try validateSomedaySectionDeleteJournal(command)
            if case .success(let value) = terminal { try validateSomedaySectionDeleteAcknowledgment(command, value: value) }
        }
        if command.method == "somedaySectionOrderWrite" {
            try validateSomedaySectionOrderJournal(command)
            if case .success(let value) = terminal { try validateSomedaySectionOrderAcknowledgment(command, value: value) }
        }
        if command.method == "somedaySectionTaskCommit" {
            try validateSomedaySectionTaskJournal(command)
            if case .success(let value) = terminal { try validateSomedaySectionTaskAcknowledgment(command, value: value) }
        }
        if ["somedaySectionMoveCommit", "somedaySectionMoveUndoCommit"].contains(command.method) {
            try validateSomedaySectionMoveJournal(command)
            if case .success(let value) = terminal { try validateSomedaySectionMoveAcknowledgment(command, value: value) }
        }
        var finished = command
        finished.terminal = terminal
        // Keep the known answer in memory even if this phase cannot reach disk.
        // Once persisted, restart can clean up without entering core again.
        pending = finished
        try persist(finished)
        if let attempt = command.editorDraft, case .success = terminal {
            #if DEBUG
            try faults?.editorDraftRemove?()
            #endif
            try editorDrafts.removeMatching(attempt)
        }
        try clearPending()
        if let attempt = command.editorDraft, case .rejected = terminal {
            try editorDrafts.thaw(attempt)
        }
        if command.method == "draftCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("taskEditorDurableApplied")
#endif
            NSLog("Native iOS Task Editor save confirmed releaseCheck=v1.3.4/ios-editor-durable-save outcome=confirmed")
        }
        if ["draftCommit", "checklistPreparedCommit"].contains(command.method), case .success = terminal,
           let args = try? NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String],
           let encoded = args.first,
           let envelope = try? NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
           let request = envelope["request"] as? [String: Any], request["attachments"] != nil {
            NSLog("Native iOS Task URL links saved releaseCheck=v1.3.4/ios-editor-url-links outcome=confirmed")
        }
        if ["draftCommit", "checklistPreparedCommit"].contains(command.method), case .success = terminal,
           let args = try? NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String],
           let encoded = args.first,
           let envelope = try? NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
           let request = envelope["request"] as? [String: Any],
           let patch = request["patch"] as? [String: Any], patch["timeSpentMinutes"] != nil {
#if DEBUG
            faults?.commandDiagnostic?("taskEditorTimeSpentApplied")
#endif
            NSLog("Native iOS Task Editor time spent saved releaseCheck=v1.3.4/ios-editor-time-spent outcome=confirmed")
        }
        if command.method == "taskDeleteCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("taskDelete")
#endif
            NSLog("Native iOS Task deletion saved releaseCheck=v1.3.4/ios-task-delete operation=delete outcome=confirmed")
        }
        if command.method == "taskPromoteCommit", case .success = terminal {
            NSLog("Native iOS task promoted to project releaseCheck=v1.3.4/ios-task-promote outcome=confirmed")
        }
        if command.method == "taskDeleteUndoCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("taskDeleteUndo")
#endif
            NSLog("Native iOS Task deletion saved releaseCheck=v1.3.4/ios-task-delete operation=undo outcome=confirmed")
        }
        if command.method == "taskCancellationUndoCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("taskCancellationUndo")
#endif
            NSLog("Native iOS Task cancellation saved releaseCheck=v1.3.4/ios-task-cancel operation=undo outcome=confirmed")
        }
        if command.method == "checklistPreparedCommit", case .success = terminal,
           let args = try? NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String],
           let encoded = args.first,
           let envelope = try? NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
           (envelope["request"] as? [String: Any])?["intent"] as? String == "cancel" {
#if DEBUG
            faults?.commandDiagnostic?("taskCancellation")
#endif
            NSLog("Native iOS Task cancellation saved releaseCheck=v1.3.4/ios-task-cancel operation=cancel outcome=confirmed")
        }
        if command.method == "checklistPreparedCommit", case .success = terminal,
           let args = try? NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String],
           let encoded = args.first,
           let envelope = try? NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
           (envelope["request"] as? [String: Any])?["intent"] as? String == "skip" {
            NSLog("Native iOS recurring occurrence skipped releaseCheck=v1.3.4/ios-skip-occurrence outcome=confirmed")
        }
        if command.method == "boardCommit", command.editorDraft?.method == "boardAction", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("taskDuplicate")
#endif
            NSLog("Native iOS Task duplicated releaseCheck=v1.3.4/ios-task-duplicate outcome=confirmed")
        }
        if command.method == "boardCommit", case .success = terminal, !boardActionLogged {
            boardActionLogged = true
#if DEBUG
            faults?.commandDiagnostic?("boardAction")
#endif
            NSLog("Native iOS Board action saved releaseCheck=v1.3.3/native-ios-board-action")
        }
        if command.method == "calendarDeleteCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("calendarDelete")
#endif
            NSLog("Native iOS Calendar task deleted releaseCheck=v1.3.4/ios-calendar-delete outcome=confirmed")
        }
        if command.method == "calendarUnscheduleCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("calendarUnschedule")
#endif
            NSLog("Native iOS Calendar unscheduled releaseCheck=v1.3.4/ios-calendar-unschedule outcome=confirmed")
        }
        if ["calendarComposerCommit", "calendarComposerCreateCommit"].contains(command.method), case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("calendarComposerSave")
#endif
            if command.method == "calendarComposerCreateCommit" {
                NSLog("Native iOS Calendar task created releaseCheck=v1.3.3/native-ios-calendar-create")
            } else {
                NSLog("Native iOS Calendar schedule saved releaseCheck=v1.3.3/native-ios-calendar-schedule")
            }
        }
        if command.method == "mindSweepCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("mindSweepAdd")
#endif
            NSLog("Native iOS Mind Sweep task saved releaseCheck=v1.3.3/native-ios-mind-sweep")
        }
        if command.method == "inboxPreparedCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("processInboxWrite")
#endif
            NSLog("Native iOS Process Inbox choice saved releaseCheck=v1.3.3/native-ios-process-inbox-write")
        }
        if command.method == "checklistPreparedCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("checklistWrite")
#endif
            NSLog("Native iOS checklist write saved releaseCheck=v1.3.3/native-ios-checklist-write")
            if let args = try? NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String],
               let encoded = args.first,
               let envelope = try? NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
               let request = envelope["request"] as? [String: Any],
               let patch = request["patch"] as? [String: Any],
               !Set(["status", "focusedToday", "completedAt"]).isDisjoint(with: patch.keys) {
#if DEBUG
                faults?.commandDiagnostic?("taskEditorStatusApplied")
#endif
                NSLog("Native iOS Task Editor status saved releaseCheck=v1.3.4/ios-editor-status outcome=confirmed")
            }
        }
        if command.method == "projectCreateCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectCreate")
#endif
            NSLog("Native iOS project created releaseCheck=v1.3.3/native-ios-project-create")
        }
        if command.method == "projectSectionCreateCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectSectionCreateApplied")
#endif
            NSLog("Native iOS Project Section created releaseCheck=v1.3.3/native-ios-project-section-create outcome=applied")
        }
        if command.method == "projectSectionRenameCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectSectionRenameApplied")
#endif
            NSLog("Native iOS Project Section renamed releaseCheck=v1.3.3/native-ios-project-section-rename outcome=applied")
        }
        if command.method == "projectSectionDeleteCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectSectionDeleteApplied")
#endif
            NSLog("Native iOS Project Section deleted releaseCheck=v1.3.3/native-ios-project-section-delete outcome=applied")
        }
        if command.method == "projectSectionOrderCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectSectionOrderApplied")
#endif
            NSLog("Native iOS Project Section order saved releaseCheck=v1.3.3/native-ios-project-section-order outcome=applied")
        }
        if ["areaCreateCommit", "manageAreaCreateCommit", "areaRenameCommit", "manageAreaEditCommit",
            "areaDeleteCommit", "manageAreaDeleteCommit"].contains(command.method), case .success = terminal {
            NSLog("Native iOS Area durable recovery confirmed releaseCheck=v1.3.4/ios-area-durable-recovery outcome=confirmed")
        }
        if command.method == "areaCreateCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("areaCreateApplied")
#endif
            NSLog("Native iOS Area saved releaseCheck=v1.3.3/native-ios-area-create outcome=applied")
        }
        if command.method == "appLockCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("appLockApplied")
#endif
            NSLog("Native iOS App lock saved releaseCheck=v1.3.4/ios-app-lock outcome=confirmed")
        }
        if command.method == "gtdWorkflowCommit", case .success(let value) = terminal {
            let result = (try? NativeJSON.jsonObject(with: Data(value.utf8))) as? [String: Any]
            let archiving = result?["type"] as? String == "autoArchiveDays"
            let startDates = result?["type"] as? String == "focusIncludeStartDates"
            let reviewing = ["dailyReviewFocusStep", "weeklyReviewContextStep"].contains(result?["type"] as? String ?? "")
            let inboxing = ["inboxTwoMinute", "inboxProjectFirst", "inboxContextStep", "inboxSchedule"].contains(result?["type"] as? String ?? "")
            let parsing = ["quickAddAutoClean", "naturalLanguageDates"].contains(result?["type"] as? String ?? "")
            let capturing = result?["type"] as? String == "defaultArea"
            let editing = result?["type"] as? String == "taskEditorSectionOpen"
            let preset = result?["type"] as? String == "taskEditorPreset"
#if DEBUG
            faults?.commandDiagnostic?(archiving ? "gtdAutoArchiveApplied" : startDates ? "gtdFocusStartDatesApplied" : preset ? "gtdTaskEditorPresetApplied" : editing ? "gtdTaskEditorOpenApplied" : parsing ? "gtdCaptureParseApplied" : capturing ? "gtdCaptureAreaApplied" : inboxing ? "gtdInboxApplied" : reviewing ? "gtdReviewApplied" : "gtdWorkflowApplied")
#endif
            if archiving { NSLog("Native iOS Auto-archive preference saved releaseCheck=v1.3.4/ios-auto-archive outcome=confirmed") }
            else if startDates { NSLog("Native iOS Focus start-date preference saved releaseCheck=v1.3.4/ios-focus-start-dates outcome=confirmed") }
            else if preset { NSLog("Native iOS Task Editor preset saved releaseCheck=v1.3.4/ios-gtd-editor-presets outcome=confirmed") }
            else if editing { NSLog("Native iOS Task Editor sections saved releaseCheck=v1.3.4/ios-gtd-editor-sections outcome=confirmed") }
            else if parsing { NSLog("Native iOS Capture parsing saved releaseCheck=v1.3.4/ios-gtd-capture-parsing outcome=confirmed") }
            else if capturing { NSLog("Native iOS Capture default area saved releaseCheck=v1.3.4/ios-gtd-capture-area outcome=confirmed") }
            else if inboxing { NSLog("Native iOS GTD Inbox saved releaseCheck=v1.3.4/ios-gtd-inbox outcome=confirmed") }
            else if reviewing { NSLog("Native iOS GTD Review saved releaseCheck=v1.3.4/ios-gtd-review outcome=confirmed") }
            else { NSLog("Native iOS GTD workflow saved releaseCheck=v1.3.4/ios-gtd-workflow outcome=confirmed") }
        }
        if command.method == "generalPreferenceCommit", case .success(let value) = terminal {
#if DEBUG
            faults?.commandDiagnostic?("generalPreferenceApplied")
#endif
            let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any]
            if result?["type"] as? String == "quickAccessView" {
                NSLog("Native iOS Quick Access saved releaseCheck=v1.3.4/ios-quick-access outcome=confirmed")
            } else if result?["type"] as? String == "calendarSystem" {
                NSLog("Native iOS Calendar system saved releaseCheck=v1.3.4/ios-calendar-system outcome=confirmed")
            } else if result?["type"] as? String == "language" {
                NSLog("Native iOS Language saved releaseCheck=v1.3.4/ios-language outcome=confirmed")
            } else if result?["type"] as? String == "theme" {
                NSLog("Native iOS Theme saved releaseCheck=v1.3.4/ios-theme outcome=confirmed")
            } else {
                NSLog("Native iOS General preference saved releaseCheck=v1.3.4/ios-general-preference outcome=confirmed")
            }
        }
        if command.method == "manageTaxonomyCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("manageTaxonomyApplied")
#endif
            NSLog("Native iOS Manage Context or Tag saved releaseCheck=v1.3.4/ios-manage-taxonomy outcome=confirmed")
        }
        if command.method == "managePersonEditCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("managePersonEditApplied")
#endif
            NSLog("Native iOS Manage Person edited releaseCheck=v1.3.4/ios-manage-person-edit outcome=confirmed")
        }
        if command.method == "managePersonDeleteCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("managePersonDeleteApplied")
#endif
            NSLog("Native iOS Manage Person deleted releaseCheck=v1.3.4/ios-manage-person-delete outcome=confirmed")
        }
        if command.method == "managePersonCreateCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("managePersonCreateApplied")
#endif
            NSLog("Native iOS Manage Person created releaseCheck=v1.3.4/ios-manage-person-create outcome=confirmed")
        }
        if command.method == "manageAreaCreateCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("manageAreaCreateApplied")
#endif
            NSLog("Native iOS Manage Area created releaseCheck=v1.3.4/ios-manage-area-create outcome=confirmed")
        }
        if command.method == "areaColorCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("areaColorApplied")
#endif
            NSLog("Native iOS Area color saved releaseCheck=v1.3.3/native-ios-area-color outcome=applied")
        }
        if command.method == "areaRenameCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("areaRenameApplied")
#endif
            NSLog("Native iOS Area renamed releaseCheck=v1.3.3/native-ios-area-rename outcome=applied")
        }
        if command.method == "manageAreaEditCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("manageAreaEditApplied")
#endif
            NSLog("Native iOS Manage Area edited releaseCheck=v1.3.4/ios-manage-area-edit outcome=confirmed")
        }
        if command.method == "areaOrderCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("areaOrderApplied")
#endif
            NSLog("Native iOS Area order saved releaseCheck=v1.3.3/native-ios-area-order outcome=applied")
        }
        if command.method == "areaDeleteCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("areaDeleteApplied")
#endif
            NSLog("Native iOS Area deleted releaseCheck=v1.3.3/native-ios-area-delete outcome=applied")
        }
        if command.method == "manageAreaDeleteCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("manageAreaDeleteApplied")
#endif
            NSLog("Native iOS Manage Area deleted releaseCheck=v1.3.4/ios-manage-area-delete outcome=confirmed")
        }
        if command.method == "projectFocusCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectFocusApplied")
#endif
            NSLog("Native iOS Project Focus saved releaseCheck=v1.3.3/native-ios-project-focus outcome=applied")
        }
        if command.method == "taskFocusCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("taskFocusApplied")
#endif
            NSLog("Native iOS Task Focus saved releaseCheck=v1.3.4/ios-task-focus outcome=applied")
        }
        if command.method == "focusOrderCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("focusOrderSaved")
#endif
            NSLog("Native iOS Focus order saved releaseCheck=v1.3.4/ios-focus-order outcome=confirmed")
        }
        if command.method == "focusSavedFilterCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("focusSavedFilterSaved")
#endif
            NSLog("Native iOS Focus saved filter saved releaseCheck=v1.3.4/ios-focus-saved-filter outcome=confirmed")
        }
        if command.method == "savedSearchCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("savedSearchSaved")
#endif
            NSLog("Native iOS Saved search saved releaseCheck=v1.3.4/ios-saved-search-write outcome=confirmed")
        }
        if command.method == "projectRenameCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectRenameApplied")
#endif
            NSLog("Native iOS Project renamed releaseCheck=v1.3.3/native-ios-project-rename outcome=applied")
        }
        if command.method == "projectFlowCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectFlowApplied")
#endif
            NSLog("Native iOS Project flow saved releaseCheck=v1.3.3/native-ios-project-flow outcome=applied")
        }
        if command.method == "projectTaskSortCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectTaskSortApplied")
#endif
            NSLog("Native iOS Project task sort saved releaseCheck=v1.3.3/native-ios-project-task-sort outcome=applied")
        }
        if command.method == "projectTaskOrderCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectTaskOrderApplied")
#endif
            NSLog("Native iOS Project task order saved releaseCheck=v1.3.4/ios-project-task-order outcome=applied")
        }
        if command.method == "projectNotesWriteCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectNotesWriteApplied")
#endif
            NSLog("Native iOS Project Notes saved releaseCheck=v1.3.3/native-ios-project-notes-write outcome=applied")
        }
        if command.method == "projectTagsWriteCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectTagsWriteApplied")
#endif
            NSLog("Native iOS Project Tags saved releaseCheck=v1.3.3/native-ios-project-tags-write outcome=applied")
        }
        if command.method == "projectAttachmentWriteCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectAttachmentWriteApplied")
#endif
            NSLog("Native iOS Project URL attachments saved releaseCheck=v1.3.4/ios-project-url-links outcome=saved")
        }
        if command.method == "projectStatusCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectStatusApplied")
#endif
            NSLog("Native iOS Project status saved releaseCheck=v1.3.3/native-ios-project-status outcome=applied")
        }
        if command.method == "projectDateCommit", case .success = terminal {
            let review = projectDateField(command) == "reviewAt"
#if DEBUG
            faults?.commandDiagnostic?(review ? "projectReviewDateApplied" : "projectDateApplied")
#endif
            if review {
                NSLog("Native iOS Project Review Date saved releaseCheck=v1.3.3/native-ios-project-review-date outcome=applied")
            } else {
                NSLog("Native iOS Project date saved releaseCheck=v1.3.3/native-ios-project-date outcome=applied")
            }
        }
        if command.method == "projectAreaCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("projectAreaApplied")
#endif
            NSLog("Native iOS Project Area saved releaseCheck=v1.3.3/native-ios-project-area-assignment outcome=applied")
        }
        if command.method == "focusGroupWrite", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("focusGroupSaved")
#endif
            NSLog("Native iOS Focus grouping saved releaseCheck=v1.3.4/ios-focus-grouping outcome=confirmed")
        }
        if command.method == "taskListSortWrite", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("taskListSortSaved")
#endif
            NSLog("Native iOS task list sort saved releaseCheck=v1.3.4/ios-reference-sort outcome=confirmed")
        }
        if command.method == "unassignedAreaColorWrite", case .success(let value) = terminal,
           (try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any])?["changed"] as? Bool == true {
#if DEBUG
            faults?.commandDiagnostic?("unassignedAreaColorSaved")
#endif
            NSLog("Native iOS unassigned area color saved releaseCheck=v1.3.4/ios-unassigned-area-color outcome=confirmed")
        }
        if command.method == "somedaySectionCreateWrite", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("somedaySectionCreateSaved")
#endif
            NSLog("Native iOS Someday section saved releaseCheck=v1.3.4/ios-someday-section-create outcome=confirmed")
        }
        if command.method == "somedaySectionRenameWrite", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("somedaySectionRenameSaved")
#endif
            NSLog("Native iOS Someday section renamed releaseCheck=v1.3.4/ios-someday-section-rename outcome=confirmed")
        }
        if command.method == "somedaySectionDeleteWrite", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("somedaySectionDeleteSaved")
#endif
            NSLog("Native iOS Someday section deleted releaseCheck=v1.3.4/ios-someday-section-delete outcome=confirmed")
        }
        if command.method == "somedaySectionOrderWrite", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("somedaySectionOrderSaved")
#endif
            NSLog("Native iOS Someday section order saved releaseCheck=v1.3.4/ios-someday-section-order outcome=confirmed")
        }
        if command.method == "somedaySectionTaskCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("somedaySectionTaskSaved")
#endif
            NSLog("Native iOS Someday section task saved releaseCheck=v1.3.4/ios-someday-section-task outcome=confirmed")
        }
        if command.method == "somedaySectionMoveCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("somedaySectionMoveSaved")
#endif
            NSLog("Native iOS Someday section move saved releaseCheck=v1.3.4/ios-someday-section-move operation=move outcome=confirmed")
        }
        if command.method == "somedaySectionMoveUndoCommit", case .success = terminal {
#if DEBUG
            faults?.commandDiagnostic?("somedaySectionMoveUndoSaved")
#endif
            NSLog("Native iOS Someday section move saved releaseCheck=v1.3.4/ios-someday-section-move operation=undo outcome=confirmed")
        }
        return terminal
    }

    private func isDefiniteRejection(_ message: String, method: String) -> Bool {
        ["INVALID_INPUT:", "TASK_NOT_FOUND:", "NOT_READY:"].contains(where: { message.hasPrefix($0) })
            || (["taskDeleteCommit", "taskDeleteUndoCommit", "taskPromoteCommit"].contains(method) && message.hasPrefix("STALE_REVISION:"))
            || (["saveDraft", "draftCommit", "calendarPreference", "focusGroupWrite", "taskListSortWrite", "unassignedAreaColorWrite", "somedaySectionCreateWrite", "somedaySectionRenameWrite", "somedaySectionDeleteWrite", "somedaySectionTaskCommit", "boardCommit", "calendarUnscheduleCommit", "calendarDeleteCommit", "calendarComposerCommit", "calendarComposerCreateCommit", "mindSweepCommit", "inboxPreparedCommit", "checklistPreparedCommit", "taskCancellationUndoCommit", "projectCreateCommit", "projectSectionCreateCommit", "projectSectionRenameCommit", "projectSectionDeleteCommit", "projectSectionOrderCommit", "areaCreateCommit", "manageAreaCreateCommit", "managePersonCreateCommit", "appLockCommit", "gtdWorkflowCommit", "generalPreferenceCommit", "manageTaxonomyCommit", "managePersonEditCommit", "managePersonDeleteCommit", "areaColorCommit", "areaRenameCommit", "manageAreaEditCommit", "areaOrderCommit", "areaDeleteCommit", "manageAreaDeleteCommit", "projectFocusCommit", "taskFocusCommit", "focusOrderCommit", "focusSavedFilterCommit", "savedSearchCommit", "projectRenameCommit", "projectFlowCommit", "projectTaskSortCommit", "projectTaskOrderCommit", "projectNotesWriteCommit", "projectTagsWriteCommit", "projectAttachmentWriteCommit", "projectStatusCommit", "projectDateCommit", "projectAreaCommit"].contains(method) && message.hasPrefix("STALE_REVISION:"))
            || (["somedaySectionMoveCommit", "somedaySectionMoveUndoCommit"].contains(method)
                && message.hasPrefix("STALE_REVISION:"))
            || (method == "somedaySectionOrderWrite" && message.hasPrefix("STALE_REVISION:"))
    }

    private func validateBoardAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any], let action = request["action"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any], let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["changed", "open"]), Self.isBoolean(result["changed"]), result["changed"] as? Bool == true,
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Board acknowledgment")
        }
        if action["type"] as? String == "duplicateTask" {
            guard let open = result["open"] as? [String: Any], Set(open.keys) == Set(["taskId", "projectId", "tab"]),
                  open["taskId"] as? String == request["requestId"] as? String,
                  open["tab"] as? String == "task", open["projectId"] is String || open["projectId"] is NSNull else {
                throw HostFailure("Malformed duplicate acknowledgment")
            }
        } else if !(result["open"] is NSNull) { throw HostFailure("Malformed Trash acknowledgment") }
    }

    private func validateCalendarDeleteAcknowledgment(_ command: PendingCommand, value: String) throws {
        let expected = try invoke("calendarDeleteValidate", arguments: journalArguments(command))
        guard let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["changed", "open"]), Self.isBoolean(result["changed"]),
              result["changed"] as? Bool == true, result["open"] is NSNull,
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: NativeJSON.jsonObject(with: Data(expected.utf8)), options: [.sortedKeys]) else {
            throw HostFailure("Malformed Calendar Delete acknowledgment")
        }
    }

    private func validateCalendarAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any], let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["changed", "toast", "next", "scrollToMinutes", "composer", "taskId"]),
              Self.isBoolean(result["changed"]), result["changed"] as? Bool == true,
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Calendar acknowledgment")
        }
    }

    private func validateMindSweepAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["taskId", "title"]),
              result["taskId"] as? String == request["requestId"] as? String,
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Mind Sweep acknowledgment")
        }
    }

    private func validateProjectSectionCreateResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["id", "projectId"]),
              result["id"] as? String == request["requestId"] as? String,
              result["projectId"] as? String == request["projectId"] as? String else {
            throw HostFailure("Malformed Project Section creation result")
        }
    }

    private func validateProjectSectionCreateAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project Section creation acknowledgment")
        }
        try validateProjectSectionCreateResult(result, request: request)
    }

    private func validateProjectSectionRenameResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["id", "projectId"]),
              result["id"] as? String == request["sectionId"] as? String,
              result["projectId"] as? String == request["projectId"] as? String else {
            throw HostFailure("Malformed Project Section rename result")
        }
    }

    private func validateProjectSectionRenameAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project Section rename acknowledgment")
        }
        try validateProjectSectionRenameResult(result, request: request)
    }

    private func validateProjectSectionDeleteResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["id", "projectId"]),
              result["id"] as? String == request["sectionId"] as? String,
              result["projectId"] as? String == request["projectId"] as? String else {
            throw HostFailure("Malformed Project Section deletion result")
        }
    }

    private func validateProjectSectionDeleteAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project Section deletion acknowledgment")
        }
        try validateProjectSectionDeleteResult(result, request: request)
    }

    private func validateProjectSectionOrderResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["projectId", "orderedIds"]),
              result["projectId"] as? String == request["projectId"] as? String,
              let ordered = result["orderedIds"] as? [String],
              let expected = request["expectedSections"] as? [[String: Any]],
              let sectionID = request["sectionId"] as? String,
              let direction = request["direction"] as? String,
              expected.count >= 2,
              expected.allSatisfy({ $0["projectId"] as? String == request["projectId"] as? String }) else {
            throw HostFailure("Malformed Project Section order result")
        }
        let original = expected.compactMap { $0["id"] as? String }
        guard original.count == expected.count, Set(original).count == original.count,
              let index = original.firstIndex(of: sectionID) else {
            throw HostFailure("Malformed Project Section order result")
        }
        let neighbor = direction == "up" ? index - 1 : direction == "down" ? index + 1 : -1
        guard original.indices.contains(neighbor) else { throw HostFailure("Malformed Project Section order result") }
        var moved = original
        moved.swapAt(index, neighbor)
        guard ordered == moved else { throw HostFailure("Malformed Project Section order result") }
    }

    private func validateProjectSectionOrderAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project Section order acknowledgment")
        }
        try validateProjectSectionOrderResult(result, request: request)
    }

    private func validateProjectCreateResult(_ result: [String: Any], request: [String: Any], created: Bool) throws {
        guard Set(result.keys) == Set(["id", "created"]),
              let id = result["id"] as? String, !id.isEmpty,
              Self.isBoolean(result["created"]), result["created"] as? Bool == created,
              !created || id == request["requestId"] as? String else {
            throw HostFailure("Malformed project creation result")
        }
    }

    private func validateProjectCreateAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed project creation acknowledgment")
        }
        try validateProjectCreateResult(result, request: request, created: true)
    }

    private static func validGtdWorkflowEdit(_ value: Any?) -> Bool {
        guard let edit = value as? [String: Any], let type = edit["type"] as? String,
              Set(edit.keys) == Set(type == "taskEditorSectionOpen" ? ["type", "section", "value"] : ["type", "value"]) else { return false }
        switch type {
        case "taskEditorPreset": return ["simple", "standard", "full"].contains(edit["value"] as? String ?? "")
        case "taskEditorSectionOpen": return ["scheduling", "organization", "details"].contains(edit["section"] as? String ?? "") && isBoolean(edit["value"])
        case "defaultArea": return (edit["value"] as? String).map { $0.utf16.count <= 500 } == true
        case "defaultScheduleTime": return (edit["value"] as? String).map { $0.utf16.count <= 50 } == true
        case "focusTaskLimit": return !isBoolean(edit["value"]) && (edit["value"] as? NSNumber).map {
            $0.doubleValue.isFinite && $0.doubleValue.rounded() == $0.doubleValue && abs($0.doubleValue) <= 1_000_000
        } == true
        case "focusIncludeStartDates": return isBoolean(edit["value"])
        case "autoArchiveDays": return [0, 1, 3, 7, 14, 30, 60].contains { isInteger(edit["value"], equalTo: $0) }
        case "defaultProjectFlowMode": return ["parallel", "sequential"].contains(edit["value"] as? String ?? "")
        case "dailyReviewFocusStep", "weeklyReviewContextStep", "inboxTwoMinute", "inboxProjectFirst", "inboxContextStep", "inboxSchedule", "quickAddAutoClean", "naturalLanguageDates": return isBoolean(edit["value"])
        default: return false
        }
    }

    private static func validGtdWorkflowExpected(_ value: Any?, type: String) -> Bool {
        if type == "taskEditorPreset" {
            let layout = ["order", "hidden", "sections", "sectionOpen"]
            let flags = ["priorities", "timeEstimates"]
            guard let expected = value as? [String: Any],
                  Set(expected.keys) == Set(layout + flags + ["taskEditorPresent", "featuresPresent", "stampPresent", "stamp"]),
                  isBoolean(expected["taskEditorPresent"]), isBoolean(expected["featuresPresent"]),
                  isBoolean(expected["stampPresent"]),
                  expected["stampPresent"] as? Bool == true
                    ? (expected["stamp"] as? String).map({ $0.utf16.count <= 500 }) == true : expected["stamp"] is NSNull else { return false }
            let fields = Set(["status", "project", "area", "contexts", "dueDate", "section", "startTime", "reviewAt", "recurrence", "tags", "description", "attachments", "checklist", "priority", "energyLevel", "timeEstimate", "assignedTo", "location"])
            let sections = Set(["basic", "scheduling", "organization", "details"])
            return (layout + flags).allSatisfy { field in
                guard let witness = expected[field] as? [String: Any], Set(witness.keys) == Set(["present", "value"]),
                      isBoolean(witness["present"]) else { return false }
                if witness["present"] as? Bool == false { return witness["value"] is NSNull }
                guard expected[flags.contains(field) ? "featuresPresent" : "taskEditorPresent"] as? Bool == true else { return false }
                if flags.contains(field) { return isBoolean(witness["value"]) }
                if field == "order" || field == "hidden" {
                    guard let items = witness["value"] as? [String] else { return false }
                    return items.count <= 18 && items.allSatisfy { fields.contains($0) }
                }
                guard let map = witness["value"] as? [String: Any] else { return false }
                if field == "sections" {
                    return map.count <= 19 && map.allSatisfy { (fields.contains($0.key) || $0.key == "textDirection") && sections.contains($0.value as? String ?? "") }
                }
                return map.count <= 4 && map.allSatisfy { sections.contains($0.key) && isBoolean($0.value) }
            }
        }
        if type == "taskEditorSectionOpen" {
            guard let expected = value as? [String: Any],
                  Set(expected.keys) == Set(["taskEditorPresent", "sectionOpenPresent", "present", "value", "stampPresent", "stamp"]),
                  isBoolean(expected["taskEditorPresent"]), isBoolean(expected["sectionOpenPresent"]) else { return false }
            var field = expected
            field.removeValue(forKey: "taskEditorPresent")
            field.removeValue(forKey: "sectionOpenPresent")
            guard validGeneralPreferenceExpected(field),
                  expected["sectionOpenPresent"] as? Bool != true || expected["taskEditorPresent"] as? Bool == true else { return false }
            return expected["present"] as? Bool == false
                || (expected["sectionOpenPresent"] as? Bool == true && isBoolean(expected["value"]))
        }
        if type == "defaultArea" {
            guard let expected = value as? [String: Any],
                  Set(expected.keys) == Set(["modePresent", "mode", "idPresent", "id", "stampPresent", "stamp"]),
                  isBoolean(expected["modePresent"]), isBoolean(expected["idPresent"]), isBoolean(expected["stampPresent"]) else { return false }
            for field in ["mode", "id"] {
                let present = expected[field + "Present"] as? Bool == true
                guard present ? (expected[field] is NSNull || (expected[field] as? String).map { $0.utf16.count <= 500 } == true)
                    : expected[field] is NSNull else { return false }
            }
            return expected["stampPresent"] as? Bool == true
                ? (expected["stamp"] as? String).map { $0.utf16.count <= 500 } == true : expected["stamp"] is NSNull
        }
        if type == "autoArchiveDays" {
            guard let expected = value as? [String: Any],
                  Set(expected.keys) == Set(["present", "value", "stampPresent", "stamp"]),
                  isBoolean(expected["present"]), isBoolean(expected["stampPresent"]),
                  let present = expected["present"] as? Bool, let stampPresent = expected["stampPresent"] as? Bool,
                  present ? (!isBoolean(expected["value"]) && (expected["value"] as? NSNumber)?.doubleValue.isFinite == true)
                    : expected["value"] is NSNull,
                  stampPresent ? (expected["stamp"] as? String).map({ $0.utf16.count <= 500 }) == true
                    : expected["stamp"] is NSNull else { return false }
            return true
        }
        if ["dailyReviewFocusStep", "weeklyReviewContextStep", "inboxTwoMinute", "inboxProjectFirst", "inboxContextStep", "inboxSchedule"].contains(type) {
            guard let expected = value as? [String: Any],
                  Set(expected.keys) == Set(["parentPresent", "present", "value", "stampPresent", "stamp"]),
                  isBoolean(expected["parentPresent"]) else { return false }
            var field = expected
            field.removeValue(forKey: "parentPresent")
            guard validGeneralPreferenceExpected(field) else { return false }
            return expected["present"] as? Bool == false
                || (expected["parentPresent"] as? Bool == true && isBoolean(expected["value"]))
        }
        guard validGeneralPreferenceExpected(value), let expected = value as? [String: Any] else { return false }
        if expected["present"] as? Bool == false { return true }
        if ["quickAddAutoClean", "naturalLanguageDates", "focusIncludeStartDates"].contains(type) { return isBoolean(expected["value"]) }
        if type == "focusTaskLimit" { return !isBoolean(expected["value"]) && expected["value"] is NSNumber }
        return expected["value"] is String
    }

    private func validateGtdWorkflowResult(_ result: [String: Any], request: [String: Any], changed: Bool) throws {
        let editing = (request["edit"] as? [String: Any])?["type"] as? String == "taskEditorSectionOpen"
        guard Set(result.keys) == Set(editing ? ["type", "section", "value", "changed"] : ["type", "value", "changed"]),
              let edit = request["edit"] as? [String: Any],
              !editing || Self.equalJSON(result["section"], edit["section"]),
              Self.equalJSON(result["type"], edit["type"]), Self.equalJSON(result["value"], edit["value"]),
              Self.isBoolean(result["changed"]), result["changed"] as? Bool == changed else {
            throw HostFailure("Malformed GTD workflow result")
        }
    }

    private static func validGeneralPreferenceEdit(_ value: Any?) -> Bool {
        guard let edit = value as? [String: Any], Set(edit.keys) == Set(["type", "value"]),
              let type = edit["type"] as? String else { return false }
        switch type {
        case "showTaskAge": return isBoolean(edit["value"])
        case "theme", "language": return (edit["value"] as? String).map { !$0.isEmpty && $0.utf16.count <= 500 } == true
        case "quickAccessView": return ["review", "projects", "calendar", "contexts"].contains(edit["value"] as? String ?? "")
        case "calendarSystem": return ["gregorian", "jalali"].contains(edit["value"] as? String ?? "")
        case "weekStart": return ["system", "monday", "sunday", "saturday"].contains(edit["value"] as? String ?? "")
        case "dateFormat": return ["system", "dmy", "mdy", "ymd"].contains(edit["value"] as? String ?? "")
        case "timeFormat": return ["system", "12h", "24h"].contains(edit["value"] as? String ?? "")
        default: return false
        }
    }

    private static func validGeneralPreferenceExpected(_ value: Any?) -> Bool {
        guard let expected = value as? [String: Any],
              Set(expected.keys) == Set(["present", "value", "stampPresent", "stamp"]),
              isBoolean(expected["present"]), isBoolean(expected["stampPresent"]),
              let present = expected["present"] as? Bool, let stampPresent = expected["stampPresent"] as? Bool else { return false }
        let number = expected["value"] as? NSNumber
        let validNumber = !isBoolean(expected["value"]) && number.map {
            $0.doubleValue.isFinite && abs($0.doubleValue) <= 1_000_000 && $0.doubleValue.rounded() == $0.doubleValue
        } == true
        let validValue = isBoolean(expected["value"]) || validNumber || (expected["value"] as? String).map { $0.utf16.count <= 500 } == true
        return (present ? validValue : expected["value"] is NSNull)
            && (stampPresent ? (expected["stamp"] as? String).map { $0.utf16.count <= 500 } == true : expected["stamp"] is NSNull)
    }

    private func validateGeneralPreferenceResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["type", "value", "changed"]),
              let edit = request["edit"] as? [String: Any], let expected = request["expected"] as? [String: Any],
              Self.equalJSON(result["type"], edit["type"]), Self.equalJSON(result["value"], edit["value"]),
              Self.isBoolean(result["changed"]),
              result["changed"] as? Bool == !(expected["present"] as? Bool == true && Self.equalJSON(expected["value"], edit["value"])) else {
            throw HostFailure("Malformed General preference result")
        }
    }

    private static func validTaxonomyExpected(_ value: Any?, kind: String) -> Bool {
        guard let scope = value as? [String: Any], Set(scope.keys) == Set(["tasks", "projects"]),
              let tasks = scope["tasks"] as? [[String: Any]], let projects = scope["projects"] as? [[String: Any]],
              kind != "context" || projects.isEmpty, !tasks.isEmpty || !projects.isEmpty else { return false }
        return [tasks, projects].allSatisfy { rows in
            let ids = rows.compactMap { $0["id"] as? String }
            return ids.count == rows.count && Set(ids).count == ids.count
                && ids.allSatisfy { !$0.isEmpty && $0.utf16.count <= 500 }
        }
    }

    private func validateTaxonomyResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["kind", "action", "name", "to"]),
              ["kind", "action", "name"].allSatisfy({ Self.equalJSON(result[$0], request[$0]) }),
              request["action"] as? String == "delete" ? result["to"] is NSNull
                : (result["to"] as? String).map({ $0.utf16.count <= 2_000_000 }) == true else {
            throw HostFailure("Malformed taxonomy result")
        }
    }

    private func validatePersonEditResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["id", "personId", "name"]),
              Self.equalJSON(result["id"], request["personId"]),
              let id = result["personId"] as? String, !id.isEmpty, id.utf16.count <= 500,
              let name = result["name"] as? String, name.utf16.count <= 2_000_000 else {
            throw HostFailure("Malformed Person edit result")
        }
    }

    private static func validAppLockExpected(_ value: Any?) -> Bool {
        guard let value = value as? [String: Any], Set(value.keys) == Set(["groupPresent", "present", "value"]),
              isBoolean(value["groupPresent"]), isBoolean(value["present"]),
              let group = value["groupPresent"] as? Bool, let present = value["present"] as? Bool,
              group || !present else { return false }
        return present ? isBoolean(value["value"]) : value["value"] is NSNull
    }

    private func validateAppLockResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["changed", "value"]), Self.isBoolean(result["changed"]),
              Self.isBoolean(result["value"]), Self.equalJSON(result["value"], request["value"]),
              let expected = request["expected"] as? [String: Any], Self.validAppLockExpected(expected),
              result["changed"] as? Bool == !(expected["present"] as? Bool == true && Self.equalJSON(expected["value"], request["value"])) else {
            throw HostFailure("Malformed App lock result")
        }
    }

    private func validateAppLockAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard value.utf8.count <= 1_024, let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              result["changed"] as? Bool == true else { throw HostFailure("Malformed App lock acknowledgment") }
        try validateAppLockResult(result, request: request)
    }

    private func validateGtdWorkflowAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed GTD workflow acknowledgment")
        }
        try validateGtdWorkflowResult(result, request: request, changed: true)
    }

    private func validateGeneralPreferenceAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed General preference acknowledgment")
        }
        try validateGeneralPreferenceResult(result, request: request)
    }

    private func validateTaxonomyAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed taxonomy acknowledgment")
        }
        try validateTaxonomyResult(result, request: request)
    }

    private func validatePersonEditAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed Person edit acknowledgment")
        }
        try validatePersonEditResult(result, request: request)
    }

    private func validatePersonDeleteResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["personId"]), let id = result["personId"] as? String,
              Self.equalJSON(id, request["personId"]) else {
            throw HostFailure("Malformed Person deletion result")
        }
    }

    private func validatePersonDeleteAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed Person deletion acknowledgment")
        }
        try validatePersonDeleteResult(result, request: request)
    }

    private func validatePersonCreateResult(_ result: [String: Any], request: [String: Any], created: Bool) throws {
        guard Set(result.keys) == Set(["id", "created"]),
              let id = result["id"] as? String, Self.equalJSON(id, request["expectedPersonId"]),
              Self.isBoolean(result["created"]), result["created"] as? Bool == created else {
            throw HostFailure("Malformed Person creation result")
        }
    }

    private func validatePersonCreateAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed Person creation acknowledgment")
        }
        try validatePersonCreateResult(result, request: request, created: true)
    }

    private func validateAreaCreateResult(_ result: [String: Any], request: [String: Any], created: Bool) throws {
        guard Set(result.keys) == Set(["id", "created"]),
              let id = result["id"] as? String, id == request["expectedAreaId"] as? String,
              Self.isBoolean(result["created"]), result["created"] as? Bool == created else {
            throw HostFailure("Malformed Area creation result")
        }
    }

    private func validateAreaCreateAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Area creation acknowledgment")
        }
        try validateAreaCreateResult(result, request: request, created: true)
    }

    private func validateAreaColorAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "color"]),
              result["id"] as? String == request["areaId"] as? String,
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Area color acknowledgment")
        }
    }

    private func validateAreaRenameResult(_ result: [String: Any], request: [String: Any], noOp: Bool) throws {
        guard Set(result.keys) == Set(["id", "areaId", "name"]),
              let sourceID = request["areaId"] as? String, !sourceID.isEmpty,
              let expectedName = (request["expected"] as? [String: Any])?["name"] as? String,
              result["id"] as? String == sourceID,
              let survivingID = result["areaId"] as? String, !survivingID.isEmpty,
              let name = result["name"] as? String, !name.isEmpty,
              !noOp || (survivingID == sourceID && name == expectedName) else {
            throw HostFailure("Malformed Area rename result")
        }
    }

    private func validateAreaRenameAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Area rename acknowledgment")
        }
        try validateAreaRenameResult(result, request: request, noOp: false)
    }

    private func validateAreaOrderAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["orderedIds"]),
              let ids = result["orderedIds"] as? [String], !ids.isEmpty,
              Set(ids).count == ids.count,
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Area order acknowledgment")
        }
    }

    private func validateAreaDeleteAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["areaId"]),
              result["areaId"] as? String == request["areaId"] as? String,
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Area deletion acknowledgment")
        }
    }

    private func validateProjectFocusAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "focused"]),
              result["id"] as? String == request["projectId"] as? String,
              Self.isBoolean(result["focused"]),
              result["focused"] as? Bool == request["focused"] as? Bool,
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project Focus acknowledgment")
        }
    }

    private func validateTaskFocusResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["id", "focused"]),
              let taskID = request["taskId"] as? String,
              let resultID = result["id"] as? String, resultID.utf8.elementsEqual(taskID.utf8),
              Self.isBoolean(result["focused"]),
              result["focused"] as? Bool == request["focused"] as? Bool else {
            throw HostFailure("Malformed Task Focus result")
        }
    }

    private func validateTaskFocusAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed Task Focus acknowledgment")
        }
        try validateTaskFocusResult(result, request: request)
    }

    private func validateFocusOrderResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["ids"]),
              let ids = result["ids"] as? [String], let submitted = request["ids"] as? [String],
              ids.count == submitted.count,
              zip(ids, submitted).allSatisfy({ $0.0.utf8.elementsEqual($0.1.utf8) }) else {
            throw HostFailure("Malformed Focus order result")
        }
    }

    private func validateFocusOrderOptions(_ value: String) throws {
        guard value.utf8.count <= 2_000_000,
              let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(options.keys) == Set(["revision", "controls", "expectedOrder", "canReorder", "rows"]),
              options["revision"] is String, options["controls"] is [String: Any],
              let order = options["expectedOrder"] as? String, order.utf8.count <= 2_000_000,
              Self.isBoolean(options["canReorder"]),
              let rows = options["rows"] as? [[String: Any]], rows.count <= 100,
              rows.allSatisfy({ row in
                  Set(row.keys) == Set(["id", "taskRevision", "title", "secondaryLabel", "positionLabel", "moveUp", "moveDown"])
                    && (row["id"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true
                    && (row["taskRevision"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 200 }) == true
                    && row["title"] is String && row["secondaryLabel"] is String && row["positionLabel"] is String
                    && (row["moveUp"] is NSNull || row["moveUp"] is [String])
                    && (row["moveDown"] is NSNull || row["moveDown"] is [String])
              }) else { throw HostFailure("Malformed Focus order options") }
    }

    private func validateFocusOrderAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed Focus order acknowledgment")
        }
        try validateFocusOrderResult(result, request: request)
    }

    private static func validFocusSavedFilterOperation(_ value: Any?) -> Bool {
        guard let operation = value as? [String: Any], let type = operation["type"] as? String else { return false }
        switch type {
        case "save": return Set(operation.keys) == Set(["type"])
        case "delete":
            return Set(operation.keys) == Set(["type", "id"])
                && (operation["id"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true
        case "removeCriterion":
            return Set(operation.keys) == Set(["type", "criterionId"])
                && (operation["criterionId"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true
        default: return false
        }
    }

    private func validateFocusSavedFilterResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["controls", "id"]),
              result["controls"] is [String: Any],
              let id = result["id"] as? String, !id.isEmpty, id.utf16.count <= 500,
              let operation = request["operation"] as? [String: Any],
              let type = operation["type"] as? String else {
            throw HostFailure("Malformed Focus saved filter result")
        }
        let target = type == "save" ? request["requestId"] as? String
            : type == "delete" ? operation["id"] as? String
            : (request["controls"] as? [String: Any])?["savedFilterId"] as? String
        guard let target, id.utf8.elementsEqual(target.utf8) else {
            throw HostFailure("Malformed Focus saved filter result ID")
        }
    }

    private func validateFocusSavedFilterOptions(_ value: String) throws {
        guard value.utf8.count <= 2_000_000,
              let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(options.keys) == Set(["revision", "controls", "expected"]),
              (options["revision"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true,
              options["controls"] is [String: Any],
              let expected = options["expected"] as? String, !expected.isEmpty,
              expected.utf8.count <= 2_000_000,
              try NativeJSON.jsonObject(with: Data(expected.utf8)) is [String: Any] else {
            throw HostFailure("Malformed Focus saved filter options")
        }
    }

    private func validateFocusSavedFilterAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed Focus saved filter acknowledgment")
        }
        try validateFocusSavedFilterResult(result, request: request)
    }
    private static func validSavedSearchOperation(_ value: Any?) -> Bool {
        guard let operation = value as? [String: Any] else { return false }
        if operation["type"] as? String == "save" {
            return Set(operation.keys) == Set(["type", "query"])
                && (operation["query"] as? String).map({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf16.count <= 2000 }) == true
        }
        return operation["type"] as? String == "delete" && Set(operation.keys) == Set(["type", "id"])
            && (operation["id"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 200 }) == true
    }

    private func validateSavedSearchResult(_ result: [String: Any], request: [String: Any]) throws {
        guard Set(result.keys) == Set(["id", "existing", "changed"]),
              let id = result["id"] as? String, !id.isEmpty, id.utf16.count <= 200,
              Self.isBoolean(result["existing"]), Self.isBoolean(result["changed"]),
              let existing = result["existing"] as? Bool, let changed = result["changed"] as? Bool,
              let operation = request["operation"] as? [String: Any] else { throw HostFailure("Malformed saved search result") }
        if operation["type"] as? String == "delete" {
            guard !existing, id.utf8.elementsEqual((operation["id"] as? String ?? "").utf8) else { throw HostFailure("Malformed saved search deletion result") }
        } else if existing {
            guard !changed, let encoded = request["expected"] as? String,
                  let scope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  let rows = scope["savedSearches"] as? [[String: Any]],
                  let query = operation["query"] as? String,
                  let match = rows.first(where: { ($0["query"] as? String ?? "").utf8.elementsEqual(query.trimmingCharacters(in: .whitespacesAndNewlines).utf8) }),
                  id.utf8.elementsEqual((match["id"] as? String ?? "").utf8) else { throw HostFailure("Malformed existing saved search result") }
        } else {
            guard changed, id.utf8.elementsEqual((request["requestId"] as? String ?? "").utf8) else { throw HostFailure("Malformed saved search creation result") }
        }
    }

    private func validateSavedSearchOptions(_ value: String) throws {
        guard value.utf8.count <= 2_000_000,
              let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(options.keys) == Set(["expected"]), let expected = options["expected"] as? String,
              !expected.isEmpty, expected.utf8.count <= 2_000_000,
              try NativeJSON.jsonObject(with: Data(expected.utf8)) is [String: Any] else { throw HostFailure("Malformed saved search options") }
    }

    private func validateSavedSearchAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed Saved search acknowledgment")
        }
        try validateSavedSearchResult(result, request: request)
    }

    private func validateProjectRenameAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "title"]),
              result["id"] as? String == request["projectId"] as? String,
              result["title"] is String,
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project rename acknowledgment")
        }
    }

    private func validateProjectFlowAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "isSequential", "sequentialScope"]),
              result["id"] as? String == request["projectId"] as? String,
              Self.isBoolean(result["isSequential"]),
              Self.isProjectFlowScope(result["sequentialScope"]),
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project flow acknowledgment")
        }
    }

    private static func isProjectTaskSort(_ value: Any?, chosen: Bool = false) -> Bool {
        if !chosen && value is NSNull { return true }
        guard let sort = value as? String else { return false }
        return (chosen ? ["default", "due", "start", "review", "timeEstimate", "title", "created", "created-desc"]
                       : ["due", "start", "review", "timeEstimate", "title", "created", "created-desc", "completed"]).contains(sort)
    }

    private static func validProjectTaskSortResult(_ result: [String: Any], projectID: String) -> Bool {
        Set(result.keys) == Set(["id", "taskSortBy"])
            && result["id"] as? String == projectID && isProjectTaskSort(result["taskSortBy"])
    }

    private func validateProjectTaskSortOptions(_ value: String, projectID: String) throws {
        guard value.utf8.count <= 2_000_000,
              let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(options.keys) == Set(["revision", "project", "canEdit", "effectiveSortBy", "choices", "label"]),
              let revision = options["revision"] as? String, !revision.isEmpty, revision.utf16.count <= 500,
              Self.isBoolean(options["canEdit"]),
              let project = options["project"] as? [String: Any],
              Set(project.keys) == Set(["id", "title", "status", "taskSortBy", "rev", "revBy", "updatedAt"]),
              project["id"] as? String == projectID,
              let title = project["title"] as? String, title.utf16.count <= 100_000,
              let status = project["status"] as? String,
              ["active", "someday", "waiting", "archived"].contains(status),
              Self.isProjectTaskSort(project["taskSortBy"]),
              project["rev"] is NSNull || (Self.isInteger(project["rev"])
                  && (project["rev"] as? NSNumber).map({ $0.doubleValue >= 0 && $0.doubleValue <= 9_007_199_254_740_991 }) == true),
              project["revBy"] is NSNull || (project["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
              let updated = project["updatedAt"] as? String, !updated.isEmpty, updated.utf16.count <= 100,
              options["canEdit"] as? Bool == (status != "archived"),
              Self.isProjectTaskSort(options["effectiveSortBy"], chosen: true),
              let effective = options["effectiveSortBy"] as? String,
              let label = options["label"] as? String, label.utf16.count <= 100_000,
              let choices = options["choices"] as? [[String: Any]], !choices.isEmpty, choices.count <= 8,
              choices.allSatisfy({ choice in
                  Set(choice.keys) == Set(["id", "label", "selected"])
                    && Self.isProjectTaskSort(choice["id"], chosen: true)
                    && (choice["label"] as? String).map({ $0.utf16.count <= 100_000 }) == true
                    && Self.isBoolean(choice["selected"])
              }),
              Set(choices.compactMap({ $0["id"] as? String })).count == choices.count,
              choices.filter({ $0["selected"] as? Bool == true }).count == 1,
              choices.first(where: { $0["selected"] as? Bool == true })?["id"] as? String == effective else {
            throw HostFailure("Malformed Project task sort options")
        }
    }

    private func validateProjectTaskSortAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              let projectID = request["projectId"] as? String,
              Self.validProjectTaskSortResult(result, projectID: projectID),
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed Project task sort acknowledgment")
        }
    }

    private func validateProjectTaskOrderResult(_ result: [String: Any], request: [String: Any]) throws {
        let sameID = { (lhs: String, rhs: String) in lhs.utf8.elementsEqual(rhs.utf8) }
        guard Set(result.keys) == Set(["projectId", "taskId", "sectionId"]),
              let projectID = request["projectId"] as? String,
              let resultProjectID = result["projectId"] as? String, sameID(resultProjectID, projectID),
              let taskID = request["taskId"] as? String,
              let resultTaskID = result["taskId"] as? String, sameID(resultTaskID, taskID),
              let encoded = request["expectedOrder"] as? String,
              let token = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let items = token["items"] as? [[String: Any]],
              items.allSatisfy({ item in
                  guard let type = item["type"] as? String, let id = item["id"] as? String, !id.isEmpty else { return false }
                  return type == "task" ? Set(item.keys) == Set(["type", "id"])
                      : type == "section" && Set(item.keys) == Set(["type", "id", "sectionId"])
                          && (item["sectionId"] is NSNull || item["sectionId"] is String)
              }),
              items.filter({ $0["type"] as? String == "task"
                  && ($0["id"] as? String).map({ sameID($0, taskID) }) == true }).count == 1,
              let source = items.firstIndex(where: { $0["type"] as? String == "task"
                  && ($0["id"] as? String).map({ sameID($0, taskID) }) == true }) else {
            throw HostFailure("Malformed Project task order result")
        }
        var moved = items
        moved.remove(at: source)
        let insertion: Int
        if request["after"] is NSNull {
            insertion = 0
        } else if let after = request["after"] as? [String: Any], Set(after.keys) == Set(["type", "id"]),
                  let type = after["type"] as? String, ["task", "section"].contains(type),
                  let id = after["id"] as? String,
                  let anchor = moved.firstIndex(where: { $0["type"] as? String == type
                      && ($0["id"] as? String).map({ sameID($0, id) }) == true }) {
            insertion = anchor + 1
        } else {
            throw HostFailure("Malformed Project task order result")
        }
        let destination = moved[..<insertion].last(where: { $0["type"] as? String == "section" })?["sectionId"] ?? NSNull()
        let destinationMatches: Bool
        if destination is NSNull {
            destinationMatches = result["sectionId"] is NSNull
        } else if let expected = destination as? String, let actual = result["sectionId"] as? String {
            destinationMatches = sameID(actual, expected)
        } else {
            destinationMatches = false
        }
        guard destinationMatches else {
            throw HostFailure("Malformed Project task order result")
        }
    }

    private func validateProjectTaskOrderAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed Project task order acknowledgment")
        }
        try validateProjectTaskOrderResult(result, request: request)
    }

    private func validateProjectNotesWriteAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "supportNotes"]),
              result["id"] as? String == request["projectId"] as? String,
              let text = request["text"] as? String,
              result["supportNotes"] as? String == text,
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project Notes write acknowledgment")
        }
    }

    private func validateProjectTagsWriteAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "tagIds"]),
              result["id"] as? String == request["projectId"] as? String,
              Self.validProjectTags(result["tagIds"]),
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project Tags acknowledgment")
        }
    }

    private func validateProjectAttachmentWriteAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "attachmentIds"]),
              result["id"] as? String == request["projectId"] as? String,
              Self.validProjectAttachmentIDs(result["attachmentIds"]),
              Self.equalJSON(result, expected) else {
            throw HostFailure("Malformed Project URL link acknowledgment")
        }
    }

    private static func validProjectAttachmentIDs(_ value: Any?) -> Bool {
        guard let ids = value as? [String], ids.count <= 500 else { return false }
        return Set(ids).count == ids.count && ids.allSatisfy { !$0.isEmpty && $0.utf16.count <= 500 }
    }

    private static func validProjectAttachmentToken(_ token: [String: Any], includesID: Bool) -> Bool {
        let fields: Set<String> = ["title", "status", "attachments", "rev", "revBy", "updatedAt"]
        guard Set(token.keys) == (includesID ? fields.union(["id"]) : fields),
              !includesID || (token["id"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true,
              (token["title"] as? String).map({ $0.utf16.count <= 100_000 }) == true,
              (token["status"] as? String).map({ ["active", "waiting", "someday", "archived"].contains($0) }) == true,
              token["rev"] is NSNull || (isInteger(token["rev"])
                  && (token["rev"] as? NSNumber).map({ $0.doubleValue >= 0 && $0.doubleValue <= 9_007_199_254_740_991 }) == true),
              token["revBy"] is NSNull || (token["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
              (token["updatedAt"] as? String).map({ Self.isCanonicalReviewInstant($0) }) == true else { return false }
        if token["attachments"] is NSNull { return true }
        guard let attachments = token["attachments"] as? [[String: Any]], attachments.count <= 500,
              let data = try? JSONSerialization.data(withJSONObject: attachments), data.count <= 2_000_000 else { return false }
        return validProjectAttachmentIDs(attachments.compactMap { $0["id"] as? String })
            && attachments.allSatisfy { $0["id"] is String }
    }

    private func validateProjectAttachmentEditOptions(_ value: String, projectID: String) throws {
        guard value.utf8.count <= 2_000_000,
              let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(options.keys) == Set(["revision", "project", "canEdit"]),
              let revision = options["revision"] as? String, !revision.isEmpty,
              Self.isBoolean(options["canEdit"]),
              let project = options["project"] as? [String: Any],
              Self.validProjectAttachmentToken(project, includesID: true),
              project["id"] as? String == projectID,
              let canEdit = options["canEdit"] as? Bool,
              let status = project["status"] as? String,
              canEdit == (status != "archived") else {
            throw HostFailure("Malformed Project URL link options")
        }
    }

    private static func validProjectTags(_ value: Any?) -> Bool {
        guard let tags = value as? [String], tags.count <= 100_000 else { return false }
        return tags.allSatisfy { $0.utf16.count <= 100_000 }
    }

    private static func validProjectTagsToken(_ token: [String: Any], includesID: Bool) -> Bool {
        let fields: Set<String> = ["title", "status", "tagIds", "rev", "revBy", "updatedAt"]
        guard Set(token.keys) == (includesID ? fields.union(["id"]) : fields),
              !includesID || (token["id"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true,
              (token["title"] as? String).map({ $0.utf16.count <= 100_000 }) == true,
              (token["status"] as? String).map({ ["active", "waiting", "someday", "archived"].contains($0) }) == true,
              validProjectTags(token["tagIds"]),
              token["rev"] is NSNull || (isInteger(token["rev"])
                  && (token["rev"] as? NSNumber).map({ $0.doubleValue >= 0 && $0.doubleValue <= 9_007_199_254_740_991 }) == true),
              token["revBy"] is NSNull || (token["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
              (token["updatedAt"] as? String).map({ Self.isCanonicalReviewInstant($0) }) == true else { return false }
        return true
    }

    private func validateProjectTagsEditOptions(_ value: String, projectID: String) throws {
        guard value.utf8.count <= 2_000_000,
              let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(options.keys) == Set(["revision", "project", "canEdit", "suggestions"]),
              let revision = options["revision"] as? String, !revision.isEmpty,
              Self.isBoolean(options["canEdit"]),
              let project = options["project"] as? [String: Any],
              Self.validProjectTagsToken(project, includesID: true),
              project["id"] as? String == projectID,
              Self.validProjectTags(options["suggestions"]) else {
            throw HostFailure("Malformed Project Tags options")
        }
    }

    private func validateProjectStatusAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "status", "isFocused"]),
              result["id"] as? String == request["projectId"] as? String,
              result["status"] as? String == request["status"] as? String,
              result["isFocused"] is NSNull || Self.isBoolean(result["isFocused"]),
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project status acknowledgment")
        }
    }

    private func validateProjectDateAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "field", "value"]),
              result["id"] as? String == request["projectId"] as? String,
              result["field"] as? String == request["field"] as? String,
              ((result["value"] is NSNull && request["value"] is NSNull)
                || (result["value"] is String && request["value"] is String
                    && (result["value"] as? String) == (request["value"] as? String))),
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project date acknowledgment")
        }
    }

    private func validateProjectAreaAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "areaId", "areaTitle", "order"]),
              result["id"] as? String == request["projectId"] as? String,
              Self.equalJSON(result["areaId"], request["areaId"]),
              result["areaTitle"] is NSNull || result["areaTitle"] is String,
              Self.isFiniteNumber(result["order"]),
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Project Area acknowledgment")
        }
    }

    private func validateFocusGroupJournal(_ command: PendingCommand) throws {
        _ = try invoke("focusGroupValidate", arguments: journalArguments(command))
    }

    private func validateFocusGroupAcknowledgment(_ command: PendingCommand, value: String) throws {
        let expected = try invoke("focusGroupValidate", arguments: journalArguments(command))
        guard let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["groupBy", "controls"]),
              let canonical = try NativeJSON.jsonObject(with: Data(expected.utf8)) as? [String: Any],
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: canonical, options: [.sortedKeys]) else {
            throw HostFailure("Malformed Focus grouping acknowledgment")
        }
    }

    private func validateTaskListSortJournal(_ command: PendingCommand) throws {
        _ = try invoke("taskListSortValidate", arguments: journalArguments(command))
    }

    private func validateTaskListSortAcknowledgment(_ command: PendingCommand, value: String) throws {
        let validated = try invoke("taskListSortValidate", arguments: journalArguments(command))
        guard let expected = try NativeJSON.jsonObject(with: Data(validated.utf8)) as? [String: Any],
              Set(expected.keys) == Set(["sortBy"]),
              let sortBy = expected["sortBy"] as? String,
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["sortBy"]), result["sortBy"] as? String == sortBy else {
            throw HostFailure("Malformed task list sort acknowledgment")
        }
    }

    private func validateUnassignedAreaColorJournal(_ command: PendingCommand) throws {
        _ = try invoke("unassignedAreaColorValidate", arguments: journalArguments(command))
    }

    private func validateUnassignedAreaColorAcknowledgment(_ command: PendingCommand, value: String) throws {
        try validateUnassignedAreaColorAcknowledgment(arguments: journalArguments(command), value: value)
    }

    private func validateUnassignedAreaColorAcknowledgment(arguments: [Any], value: String) throws {
        let validated = try invoke("unassignedAreaColorValidate", arguments: arguments)
        guard let expected = try NativeJSON.jsonObject(with: Data(validated.utf8)) as? [String: Any],
              Set(expected.keys) == Set(["color", "changed"]),
              let color = expected["color"] as? String, Self.isBoolean(expected["changed"]),
              let changed = expected["changed"] as? Bool,
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["color", "changed"]),
              result["color"] as? String == color,
              Self.isBoolean(result["changed"]), result["changed"] as? Bool == changed else {
            throw HostFailure("Malformed unassigned area color acknowledgment")
        }
    }

    private func validateSomedaySectionCreateJournal(_ command: PendingCommand) throws {
        _ = try invoke("somedaySectionCreateValidate", arguments: journalArguments(command))
    }

    private func validateSomedaySectionCreateAcknowledgment(_ command: PendingCommand, value: String) throws {
        try validateSomedaySectionCreateAcknowledgment(arguments: journalArguments(command), value: value)
    }

    private func validateSomedaySectionCreateAcknowledgment(arguments: [Any], value: String) throws {
        let validated = try invoke("somedaySectionCreateValidate", arguments: arguments)
        guard let expected = try NativeJSON.jsonObject(with: Data(validated.utf8)) as? [String: Any],
              Set(expected.keys) == Set(["id", "existing"]),
              let expectedID = expected["id"] as? String, !expectedID.isEmpty,
              Self.isBoolean(expected["existing"]), let expectedExisting = expected["existing"] as? Bool,
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "existing"]),
              let resultID = result["id"] as? String,
              resultID.utf8.elementsEqual(expectedID.utf8),
              Self.isBoolean(result["existing"]), result["existing"] as? Bool == expectedExisting else {
            throw HostFailure("Malformed Someday section creation acknowledgment")
        }
    }

    private func validateSomedaySectionRenameJournal(_ command: PendingCommand) throws {
        _ = try invoke("somedaySectionRenameValidate", arguments: journalArguments(command))
    }

    private func validateSomedaySectionRenameAcknowledgment(_ command: PendingCommand, value: String) throws {
        try validateSomedaySectionRenameAcknowledgment(arguments: journalArguments(command), value: value)
    }

    private func validateSomedaySectionRenameAcknowledgment(arguments: [Any], value: String) throws {
        let validated = try invoke("somedaySectionRenameValidate", arguments: arguments)
        guard let expected = try NativeJSON.jsonObject(with: Data(validated.utf8)) as? [String: Any],
              Set(expected.keys) == Set(["id", "changed"]),
              let expectedID = expected["id"] as? String, !expectedID.isEmpty,
              Self.isBoolean(expected["changed"]), let expectedChanged = expected["changed"] as? Bool,
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "changed"]),
              let resultID = result["id"] as? String, resultID.utf8.elementsEqual(expectedID.utf8),
              Self.isBoolean(result["changed"]), result["changed"] as? Bool == expectedChanged else {
            throw HostFailure("Malformed Someday section rename acknowledgment")
        }
    }

    private func validateSomedaySectionDeleteJournal(_ command: PendingCommand) throws {
        _ = try invoke("somedaySectionDeleteValidate", arguments: journalArguments(command))
    }

    private func validateSomedaySectionDeleteAcknowledgment(_ command: PendingCommand, value: String) throws {
        try validateSomedaySectionDeleteAcknowledgment(arguments: journalArguments(command), value: value)
    }

    private func validateSomedaySectionDeleteAcknowledgment(arguments: [Any], value: String) throws {
        let validated = try invoke("somedaySectionDeleteValidate", arguments: arguments)
        guard let expected = try NativeJSON.jsonObject(with: Data(validated.utf8)) as? [String: Any],
              Set(expected.keys) == Set(["id", "changed"]),
              let expectedID = expected["id"] as? String, !expectedID.isEmpty,
              Self.isBoolean(expected["changed"]), expected["changed"] as? Bool == true,
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "changed"]),
              let resultID = result["id"] as? String, resultID.utf8.elementsEqual(expectedID.utf8),
              Self.isBoolean(result["changed"]), result["changed"] as? Bool == true else {
            throw HostFailure("Malformed Someday section delete acknowledgment")
        }
    }

    private func validateSomedaySectionOrderJournal(_ command: PendingCommand) throws {
        _ = try invoke("somedaySectionOrderValidate", arguments: journalArguments(command))
    }

    private func validateSomedaySectionOrderAcknowledgment(_ command: PendingCommand, value: String) throws {
        try validateSomedaySectionOrderAcknowledgment(arguments: journalArguments(command), value: value)
    }

    private func validateSomedaySectionOrderAcknowledgment(arguments: [Any], value: String) throws {
        let validated = try invoke("somedaySectionOrderValidate", arguments: arguments)
        guard let expected = try NativeJSON.jsonObject(with: Data(validated.utf8)) as? [String: Any],
              Set(expected.keys) == Set(["id", "changed"]),
              let expectedID = expected["id"] as? String, !expectedID.isEmpty,
              Self.isBoolean(expected["changed"]), expected["changed"] as? Bool == true,
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "changed"]),
              let resultID = result["id"] as? String, resultID.utf8.elementsEqual(expectedID.utf8),
              Self.isBoolean(result["changed"]), result["changed"] as? Bool == true else {
            throw HostFailure("Malformed Someday section order acknowledgment")
        }
    }

    private func validateSomedaySectionTaskJournal(_ command: PendingCommand) throws {
        _ = try invoke("somedaySectionTaskValidate", arguments: journalArguments(command))
    }

    private func validateSomedaySectionTaskAcknowledgment(_ command: PendingCommand, value: String) throws {
        try validateSomedaySectionTaskAcknowledgment(arguments: journalArguments(command), value: value)
    }

    private func validateSomedaySectionTaskAcknowledgment(arguments: [Any], value: String) throws {
        let validated = try invoke("somedaySectionTaskValidate", arguments: arguments)
        guard let expected = try NativeJSON.jsonObject(with: Data(validated.utf8)) as? [String: Any],
              Set(expected.keys) == Set(["id"]), let expectedID = expected["id"] as? String,
              !expectedID.isEmpty,
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id"]), let resultID = result["id"] as? String,
              resultID.utf8.elementsEqual(expectedID.utf8) else {
            throw HostFailure("Malformed Someday section task acknowledgment")
        }
    }

    private enum SomedayMovePreparation {
        case noop(String)
        case command(PendingCommand)
    }

    private func confirmedSomedayMoveEnvelope(for method: String, publicArguments: [Any]) throws -> String {
        let stored = method == "somedaySectionMoveUndoRetryOutcome"
            ? confirmedSomedaySectionUndoEnvelope : confirmedSomedaySectionMoveEnvelope
        guard let stored, let inputJSON = publicArguments.first as? String,
              let input = try NativeJSON.jsonObject(with: Data(inputJSON.utf8)) as? [String: Any],
              let envelope = try NativeJSON.jsonObject(with: Data(stored.utf8)) as? [String: Any],
              Self.equalJSON(input, envelope["request"]) else {
            throw CoreHostRejection(message: "INVALID_INPUT: Someday move retry needs the confirmed request")
        }
        return stored
    }

    private func validateSomedaySectionMoveResult(_ value: String, expected: [String: Any]) throws {
        guard Set(expected.keys) == Set(["id", "changed", "sectionId"]),
              let expectedID = expected["id"] as? String, !expectedID.isEmpty,
              Self.isBoolean(expected["changed"]),
              expected["sectionId"] is NSNull || expected["sectionId"] is String,
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(result.keys) == Set(["id", "changed", "sectionId"]),
              let resultID = result["id"] as? String, resultID.utf8.elementsEqual(expectedID.utf8),
              Self.isBoolean(result["changed"]), result["changed"] as? Bool == expected["changed"] as? Bool,
              Self.equalJSON(result["sectionId"], expected["sectionId"]) else {
            throw HostFailure("Malformed Someday section move acknowledgment")
        }
    }

    private func validateSomedaySectionMoveAcknowledgment(arguments: [Any], method: String, value: String) throws {
        let validator = method == "somedaySectionMoveUndoCommit" || method == "somedaySectionMoveUndoRetryOutcome"
            ? "somedaySectionMoveUndoValidate" : "somedaySectionMoveValidate"
        let validated = try invoke(validator, arguments: arguments)
        guard let expected = try NativeJSON.jsonObject(with: Data(validated.utf8)) as? [String: Any] else {
            throw HostFailure("Malformed Someday section move validation")
        }
        try validateSomedaySectionMoveResult(value, expected: expected)
    }

    private func validateSomedaySectionMoveAcknowledgment(_ command: PendingCommand, value: String) throws {
        try validateSomedaySectionMoveAcknowledgment(arguments: journalArguments(command), method: command.method, value: value)
    }

    private func validateSomedaySectionMoveJournal(_ command: PendingCommand) throws {
        _ = try invoke(command.method == "somedaySectionMoveUndoCommit" ? "somedaySectionMoveUndoValidate" : "somedaySectionMoveValidate",
                       arguments: journalArguments(command))
    }

    private func prepareSomedaySectionMove(method: String, arguments: [Any]) throws -> SomedayMovePreparation {
        guard let raw = arguments.first as? String,
              let request = try NativeJSON.jsonObject(with: Data(raw.utf8)) as? [String: Any] else {
            throw HostFailure("INVALID_INPUT: Someday move needs one request")
        }
        let undo = method == "somedaySectionMoveUndo"
        let prepareArguments: [Any]
        var confirmedMove: [String: Any]?
        if undo {
            guard let moveJSON = confirmedSomedaySectionMoveEnvelope,
                  let move = try NativeJSON.jsonObject(with: Data(moveJSON.utf8)) as? [String: Any],
                  let moveRequest = move["request"] as? [String: Any],
                  Self.equalJSON(request["moveRequestId"], moveRequest["requestId"]) else {
                throw HostFailure("INVALID_INPUT: Undo needs the last confirmed Someday move")
            }
            confirmedMove = move
            prepareArguments = [String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "move": move], options: [.sortedKeys]), as: UTF8.self)]
        } else { prepareArguments = arguments }
        let responseText = try invoke(undo ? "somedaySectionMoveUndoPrepare" : "somedaySectionMovePrepare",
                                      arguments: prepareArguments)
        guard let response = try NativeJSON.jsonObject(with: Data(responseText.utf8)) as? [String: Any],
              let kind = response["kind"] as? String else {
            throw HostFailure("Malformed Someday move preparation")
        }
        if kind == "noop" {
            guard Set(response.keys) == Set(["kind", "result"]),
                  let result = response["result"] as? [String: Any],
                  let expectedID = (undo ? confirmedMove?["request"] as? [String: Any] : request),
                  let taskID = expectedID["taskId"] as? String,
                  result["id"] as? String == taskID,
                  Self.isBoolean(result["changed"]), result["changed"] as? Bool == false else {
                throw HostFailure("Malformed Someday move no-op")
            }
            let original = ((confirmedMove?["prepared"] as? [String: Any])?["before"] as? [String: Any])?["viewSectionIds"] as? [String: Any]
            let expectedSection: Any = undo
                ? original?["someday"] ?? NSNull()
                : request["sectionId"] ?? NSNull()
            guard Self.equalJSON(result["sectionId"], expectedSection) else { throw HostFailure("Malformed Someday move no-op") }
            let value = String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
            try validateSomedaySectionMoveResult(value, expected: result)
            if undo { confirmedSomedaySectionMoveEnvelope = nil }
            return .noop(value)
        }
        guard kind == "prepared", Set(response.keys) == Set(["kind", "prepared"]),
              let prepared = response["prepared"] as? [String: Any],
              Self.equalJSON(prepared["request"], request) else {
            throw HostFailure("Malformed prepared Someday move")
        }
        let envelope = String(decoding: try JSONSerialization.data(withJSONObject: ["request": request, "prepared": prepared], options: [.sortedKeys]), as: UTF8.self)
        guard envelope.utf8.count <= 1_000_000 else { throw HostFailure("INVALID_INPUT: Prepared Someday move is too large") }
        let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [envelope]), as: UTF8.self)
        let command = PendingCommand(version: 2, method: undo ? "somedaySectionMoveUndoCommit" : "somedaySectionMoveCommit", argumentsJSON: encoded)
        try validateSomedaySectionMoveJournal(command)
        return .command(command)
    }

    private func rememberConfirmedSomedayMove(_ command: PendingCommand) {
        guard ["somedaySectionMoveCommit", "somedaySectionMoveUndoCommit"].contains(command.method),
              let arguments = try? journalArguments(command), let envelope = arguments.first as? String else { return }
        if command.method == "somedaySectionMoveCommit" {
            confirmedSomedaySectionMoveEnvelope = envelope
            confirmedSomedaySectionUndoEnvelope = nil
        } else {
            confirmedSomedaySectionMoveEnvelope = nil
            confirmedSomedaySectionUndoEnvelope = envelope
        }
    }

    private static func validProjectAreaToken(_ token: [String: Any], includesID: Bool) -> Bool {
        let fields: Set<String> = ["title", "status", "areaId", "areaTitle", "order", "rev", "revBy", "updatedAt"]
        guard Set(token.keys) == (includesID ? fields.union(["id"]) : fields),
              !includesID || (token["id"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true,
              (token["title"] as? String).map({ $0.utf16.count <= 100_000 }) == true,
              (token["status"] as? String).map({ ["active", "waiting", "someday", "archived"].contains($0) }) == true,
              token["areaId"] is NSNull || (token["areaId"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true else { return false }
        guard token["areaTitle"] is NSNull || (token["areaTitle"] as? String).map({ $0.utf16.count <= 100_000 }) == true,
              isFiniteNumber(token["order"]),
              token["rev"] is NSNull || (isInteger(token["rev"])
                  && (token["rev"] as? NSNumber).map({ $0.doubleValue >= 0 && $0.doubleValue <= 9_007_199_254_740_991 }) == true),
              token["revBy"] is NSNull || (token["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
              (token["updatedAt"] as? String).map({ Self.isCanonicalReviewInstant($0) }) == true else { return false }
        return true
    }

    private func validateProjectAreaOptions(_ value: String, projectID: String) throws {
        guard let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(options.keys) == Set(["revision", "project", "canEdit", "noAreaLabel", "areas"]),
              let revision = options["revision"] as? String, !revision.isEmpty,
              Self.isBoolean(options["canEdit"]),
              let label = options["noAreaLabel"] as? String, !label.isEmpty,
              let project = options["project"] as? [String: Any],
              Self.validProjectAreaToken(project, includesID: true),
              project["id"] as? String == projectID,
              let areas = options["areas"] as? [[String: Any]],
              areas.allSatisfy({ area in
                  Set(area.keys) == Set(["id", "label", "color"])
                    && (area["id"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true
                    && (area["label"] as? String).map({ $0.utf16.count <= 100_000 }) == true
                    && (area["color"] is NSNull || (area["color"] as? String).map({ $0.utf16.count <= 500 }) == true)
              }) else { throw HostFailure("Malformed Project Area options") }
    }

    private func projectDateField(_ command: PendingCommand) -> String? {
        guard let args = try? journalArguments(command), let encoded = args.first as? String,
              let envelope = try? NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any] else { return nil }
        return request["field"] as? String
    }

    private func validateProjectDateOptions(_ value: String, request encoded: String) throws {
        guard let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let field = input["field"] as? String,
              let options = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              Set(options.keys) == Set(["revision", "project", "canEdit", "picker"]),
              options["revision"] is String, Self.isBoolean(options["canEdit"]),
              let project = options["project"] as? [String: Any],
              project["id"] as? String == input["projectId"] as? String,
              Set(project.keys) == Set(["id", "title", "status", "startDate", "dueDate", "rev", "revBy", "updatedAt"])
                .union(field == "reviewAt" ? ["reviewAt"] : []),
              let picker = options["picker"] as? [String: Any],
              Set(picker.keys) == Set(["date", "time"]).union(field == "reviewAt" ? ["instant", "preserveUnchanged"] : []),
              let day = picker["date"] as? String,
              day.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
              picker["time"] as? String == "12:00" else {
            throw HostFailure("Malformed Project date options")
        }
        if field == "reviewAt" {
            guard project["reviewAt"] is NSNull || (project["reviewAt"] as? String).map({ $0.utf16.count <= 100 }) == true,
                  let instant = picker["instant"] as? String, Self.isCanonicalReviewInstant(instant),
                  Self.isBoolean(picker["preserveUnchanged"]) else {
                throw HostFailure("Malformed Project Review Date options")
            }
        }
    }

    private func rememberConfirmedTaskCancellation(_ command: PendingCommand) {
        if command.method == "taskCancellationUndoCommit" { confirmedTaskCancellationEnvelope = nil; return }
        guard command.method == "checklistPreparedCommit",
              let args = try? NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String],
              let encoded = args.first,
              let envelope = try? NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any], request["intent"] as? String == "cancel" else { return }
        confirmedTaskCancellationEnvelope = encoded
    }

    private func rememberConfirmedTaskDelete(_ command: PendingCommand) {
        if command.method == "taskDeleteUndoCommit" { confirmedTaskDeleteEnvelope = nil; return }
        guard command.method == "taskDeleteCommit",
              let args = try? NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String],
              let encoded = args.first,
              let envelope = try? NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let request = envelope["request"] as? [String: Any],
              request["requestId"] is String else { return }
        confirmedTaskDeleteEnvelope = encoded
    }

    private func validateChecklistResult(_ result: [String: Any], request: [String: Any], kind: String) throws {
        guard let id = request["id"] as? String, result["id"] as? String == id else {
            throw HostFailure("Malformed checklist acknowledgment")
        }
        if kind == "save" {
            if request["intent"] as? String == "cancel" {
                guard Set(result.keys) == Set(["id", "cancellation"]),
                      let cancel = result["cancellation"] as? [String: Any],
                      Set(cancel.keys) == Set(["cancelledAt", "undoEnabled", "message", "undoLabel"]),
                      (cancel["cancelledAt"] as? String).map({ Self.isCanonicalReviewInstant($0) }) == true,
                      Self.isBoolean(cancel["undoEnabled"]),
                      ["message", "undoLabel"].allSatisfy({ (cancel[$0] as? String).map({ !$0.isEmpty && $0.utf8.count <= 100_000 }) == true }) else {
                    throw HostFailure("Malformed cancellation acknowledgment")
                }
            } else {
                guard Set(result.keys) == Set(["id"]) else { throw HostFailure("Malformed checklist save acknowledgment") }
            }
        } else {
            guard kind == "reset", Set(result.keys) == Set(["id", "checklistBase", "status", "completedAt", "isFocusedToday"]),
                  result["checklistBase"] is [[String: Any]], result["status"] is String,
                  result["completedAt"] is NSNull || result["completedAt"] is String,
                  Self.isBoolean(result["isFocusedToday"]) else {
                throw HostFailure("Malformed checklist reset acknowledgment")
            }
        }
    }

    private func validatePreparedAcknowledgment(_ command: PendingCommand, value: String) throws {
        let args = try journalArguments(command)
        guard let encoded = args.first as? String,
              let envelope = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
              let prepared = envelope["prepared"] as? [String: Any],
              let expected = prepared["result"] as? [String: Any],
              let result = try NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any],
              try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) else {
            throw HostFailure("Malformed prepared acknowledgment")
        }
        if command.method == "checklistPreparedCommit" {
            guard let request = envelope["request"] as? [String: Any], let kind = prepared["kind"] as? String else {
                throw HostFailure("Malformed checklist acknowledgment")
            }
            try validateChecklistResult(result, request: request, kind: kind)
        }
        if command.method == "taskDeleteCommit" {
            guard let request = envelope["request"] as? [String: Any],
                  Set(result.keys) == Set(["id", "deletion"]),
                  result["id"] as? String == request["taskId"] as? String,
                  let deletion = result["deletion"] as? [String: Any],
                  Set(deletion.keys) == Set(["message", "undoLabel", "undoEnabled"]),
                  deletion["undoEnabled"] as? Bool == true,
                  (deletion["message"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 512 }) == true,
                  (deletion["undoLabel"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 80 }) == true else {
                throw HostFailure("Malformed Task Delete acknowledgment")
            }
        }
        if command.method == "taskPromoteCommit" {
            guard Set(result.keys) == Set(["id", "reused"]),
                  let id = result["id"] as? String, !id.isEmpty, id.utf16.count <= 500,
                  Self.isBoolean(result["reused"]) else {
                throw HostFailure("Malformed Task promotion acknowledgment")
            }
        }
        if command.method == "taskDeleteUndoCommit" {
            guard let preparedDelete = prepared["delete"] as? [String: Any],
                  let deletionRequest = preparedDelete["request"] as? [String: Any],
                  Set(result.keys) == Set(["id"]), result["id"] as? String == deletionRequest["taskId"] as? String else {
                throw HostFailure("Malformed Task Delete Undo acknowledgment")
            }
        }
    }

    private func journalArguments(_ command: PendingCommand, checkingEditorSnapshot: Bool = true) throws -> [Any] {
        if let attempt = command.editorDraft {
            guard UUID(uuidString: attempt.id)?.uuidString.lowercased() == attempt.id,
                  UUID(uuidString: attempt.sessionID)?.uuidString.lowercased() == attempt.sessionID,
                  !attempt.taskID.isEmpty, attempt.taskID.utf8.count <= 500,
                  attempt.generation > 0,
                  (attempt.method == "saveDraft" && command.method == "draftCommit")
                    || (attempt.method == "checklistSave" && command.method == "checklistPreparedCommit")
                    || (attempt.method == "boardAction" && command.method == "boardCommit")
                    || (attempt.method == "taskDelete" && command.method == "taskDeleteCommit")
                    || (attempt.method == "taskPromote" && command.method == "taskPromoteCommit"),
                  attempt.argumentsJSON.utf8.count <= 2_000_000,
                  let originalArgs = try NativeJSON.jsonObject(with: Data(attempt.argumentsJSON.utf8)) as? [String],
                  originalArgs.count == 1,
                  let original = try NativeJSON.jsonObject(with: Data(originalArgs[0].utf8)) as? [String: Any],
                  Self.editorRequestTaskID(attempt.method, original) == attempt.taskID,
                  let preparedArgs = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String],
                  preparedArgs.count == 1,
                  let envelope = try NativeJSON.jsonObject(with: Data(preparedArgs[0].utf8)) as? [String: Any],
                  let preparedRequest = envelope["request"] as? [String: Any],
                  Self.equalJSON(original, preparedRequest) else {
                throw HostFailure("Malformed editor draft journal identity")
            }
            if !checkingEditorSnapshot {
                // Corrupt-file discard validates durable journal authority first;
                // the snapshot itself cannot be decoded until explicitly discarded.
            } else if let frozen = try editorDrafts.read() {
                guard frozen.attempt == attempt else {
                    throw HostFailure("Editor draft journal identity does not match snapshot")
                }
            } else if let terminal = command.terminal, case .success = terminal {
                // A terminal result may have removed this exact snapshot before
                // journal cleanup failed; replaying no writer is now required.
            } else {
                throw HostFailure("Editor draft journal is missing its frozen snapshot")
            }
        }
        if command.method == "appLockCommit" {
            guard command.argumentsJSON.utf8.count <= 49_152,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 8_192,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Set(prepared.keys) == Set(["version", "request"]),
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any], Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared App lock journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("appLock", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "gtdWorkflowCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any], Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared GTD workflow journal")
            }
            let archive = (request["edit"] as? [String: Any])?["type"] as? String == "autoArchiveDays"
            guard command.argumentsJSON.utf8.count <= (archive ? 12_000_000 : 49_152),
                  args[0].utf8.count <= (archive ? 2_000_000 : 8_192),
                  archive ? prepared["archiveEffects"] is [[String: Any]] : prepared["archiveEffects"] == nil else {
                throw HostFailure("Malformed prepared GTD workflow journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("gtdWorkflow", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "generalPreferenceCommit" {
            guard command.argumentsJSON.utf8.count <= 49_152,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 8_192,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any], Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared General preference journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("generalPreference", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "manageTaxonomyCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any], Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared taxonomy journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("manageTaxonomy", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "managePersonEditCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any], Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared Person edit journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("managePersonEdit", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "managePersonDeleteCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any], Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared Person deletion journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("managePersonDelete", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "managePersonCreateCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any], Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared Person journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("managePersonCreate", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectSectionCreateCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project Section journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectSectionCreate", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "focusOrderCommit" {
            guard command.argumentsJSON.utf8.count <= 2_100_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared Focus order journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("focusOrderWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "focusSavedFilterCommit" {
            guard command.argumentsJSON.utf8.count <= 2_100_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared Focus saved filter journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("focusSavedFilterWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "savedSearchCommit" {
            guard command.argumentsJSON.utf8.count <= 2_100_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared Saved search journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("savedSearchWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectSectionRenameCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project Section rename journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectSectionRename", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectSectionDeleteCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project Section deletion journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectSectionDelete", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectSectionOrderCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project Section order journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectSectionOrder", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectDateCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project date journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectDateWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectAreaCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project Area journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectAreaWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectStatusCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project status journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectStatusWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectNotesWriteCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project Notes journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectNotesWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectTagsWriteCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project Tags journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectTagsWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectAttachmentWriteCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared Project URL link journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectAttachmentWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectFlowCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project flow journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectFlowWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectTaskSortCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared Project task sort journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectTaskSortWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectTaskOrderCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared Project task order journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectTaskOrderWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectRenameCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project rename journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectRenameWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectFocusCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Project Focus journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectFocusWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "taskFocusCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  Self.equalJSON(request, original) else {
                throw HostFailure("Malformed prepared Task Focus journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("taskFocusWrite", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if ["areaRenameCommit", "manageAreaEditCommit"].contains(command.method) {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Area rename journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments(command.method == "manageAreaEditCommit" ? "manageAreaEdit" : "areaRename", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if ["areaDeleteCommit", "manageAreaDeleteCommit"].contains(command.method) {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Area deletion journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments(command.method == "manageAreaDeleteCommit" ? "manageAreaDelete" : "areaDelete", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "areaOrderCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Area order journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("areaOrder", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "areaColorCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Area color journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("areaColor", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if ["areaCreateCommit", "manageAreaCreateCommit"].contains(command.method) {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Area journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("areaCreate", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "projectCreateCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]),
                  let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared project journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments("projectCreate", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if ["taskDeleteCommit", "taskDeleteUndoCommit"].contains(command.method) {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let envelope = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(envelope.keys) == Set(["request", "prepared"]),
                  let request = envelope["request"] as? [String: Any],
                  let prepared = envelope["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  Self.equalJSON(prepared["request"], request),
                  Set(prepared.keys) == (command.method == "taskDeleteCommit"
                    ? Set(["version", "request", "board", "result"])
                    : Set(["version", "request", "delete", "before", "after", "scope", "deviceIdBefore", "deviceIdToInitialize", "result"])) else {
                throw HostFailure("Malformed Task Delete journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self)
            _ = try arguments(command.method == "taskDeleteCommit" ? "taskDelete" : "taskDeleteUndo", encoded)
            return args
        }
        if command.method == "taskPromoteCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let envelope = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(envelope.keys) == Set(["request", "prepared"]),
                  let request = envelope["request"] as? [String: Any],
                  let prepared = envelope["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  Self.equalJSON(prepared["request"], request) else {
                throw HostFailure("Malformed Task promotion journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self)
            _ = try arguments("taskPromote", encoded)
            return args
        }
        if command.method == "taskCancellationUndoCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let envelope = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(envelope.keys) == Set(["request", "prepared"]),
                  let request = envelope["request"] as? [String: Any],
                  let prepared = envelope["prepared"] as? [String: Any],
                  Self.equalJSON(prepared["request"], request) else { throw HostFailure("Malformed cancellation Undo journal") }
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self)]), as: UTF8.self)
            _ = try arguments("taskCancellationUndo", encoded)
            return args
        }
        if command.method == "checklistPreparedCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]), let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any], Self.isInteger(prepared["version"], equalTo: 1),
                  let kind = prepared["kind"] as? String, ["save", "reset"].contains(kind),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared checklist journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            _ = try arguments(kind == "save" ? "checklistSave" : "checklistReset",
                              String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "inboxPreparedCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]), let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any], Self.isInteger(prepared["version"], equalTo: 1),
                  prepared["result"] is [String: Any], let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Process Inbox journal")
            }
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [String(decoding: JSONSerialization.data(withJSONObject: request), as: UTF8.self)]), as: UTF8.self)
            _ = try arguments(request["decision"] == nil ? "inboxSkip" : "inboxCommit", encoded)
            return args
        }
        // These commands store a final state. Text drafts also carry the exact
        // base values; core accepts an applied edit or refuses an intervening one.
        if ["complete", "setAreaFilter", "saveDraft", "calendarPreference", "focusGroupWrite", "taskListSortWrite", "unassignedAreaColorWrite", "somedaySectionCreateWrite", "somedaySectionRenameWrite", "somedaySectionDeleteWrite", "somedaySectionOrderWrite", "somedaySectionTaskCommit"].contains(command.method) {
            // A raw schedule intent was never a supported legacy journal. It
            // must not be reparsed/reprepared under a different clock or zone.
            return try arguments(command.method, command.argumentsJSON, allowPreparedDates: false)
        }
        if ["somedaySectionMoveCommit", "somedaySectionMoveUndoCommit"].contains(command.method) {
            guard command.argumentsJSON.utf8.count <= 2_100_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 1_000_000,
                  let envelope = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(envelope.keys) == Set(["request", "prepared"]),
                  let request = envelope["request"] as? [String: Any],
                  let prepared = envelope["prepared"] as? [String: Any],
                  Self.isInteger(prepared["version"], equalTo: 1),
                  prepared["kind"] as? String == (command.method == "somedaySectionMoveCommit" ? "move" : "undo"),
                  Self.equalJSON(prepared["request"], request) else {
                throw HostFailure("INVALID_INPUT: Malformed prepared Someday move journal")
            }
            let publicMethod = command.method == "somedaySectionMoveCommit" ? "somedaySectionMoveWrite" : "somedaySectionMoveUndo"
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]), as: UTF8.self)
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self)
            _ = try arguments(publicMethod, encoded)
            return args
        }
        if command.method == "boardCommit" {
            guard let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]), let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any], Self.isInteger(prepared["version"], equalTo: 1),
                  Set(prepared.keys) == Set(["version", "request", "before", "after", "deviceIdToInitialize", "result"]),
                  let before = prepared["before"] as? [String: Any], let after = prepared["after"] as? [String: Any],
                  [before, after].allSatisfy({ row in
                      ["id", "title", "status", "createdAt", "updatedAt"].allSatisfy { row[$0] is String }
                          && !(row["id"] as? String ?? "").isEmpty
                  }), Self.isInteger(after["rev"]), after["revBy"] is String,
                  prepared["deviceIdToInitialize"] is NSNull || prepared["deviceIdToInitialize"] is String,
                  prepared["result"] is [String: Any],
                  let preparedRequest = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]) == JSONSerialization.data(withJSONObject: preparedRequest, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Board journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self)
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self)
            _ = try arguments("boardAction", encoded)
            return args
        }
        if command.method == "calendarDeleteCommit" {
            guard let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]), let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any], Set(prepared.keys) == Set(["version", "request", "board"]),
                  Self.isInteger(prepared["version"], equalTo: 1), prepared["board"] is [String: Any],
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Calendar Delete journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self)
            _ = try arguments("calendarDelete", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if command.method == "calendarUnscheduleCommit" {
            guard let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]), let request = input["request"] as? [String: Any],
                  let prepared = input["prepared"] as? [String: Any], Self.isInteger(prepared["version"], equalTo: 1),
                  prepared["kind"] as? String == "unschedule", let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Calendar Unschedule journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self)
            _ = try arguments("calendarUnschedule", String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self))
            return args
        }
        if ["calendarComposerCommit", "calendarComposerCreateCommit"].contains(command.method) {
            guard let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]), let request = input["request"] as? [String: Any],
                  Set(request.keys) == Set(["requestId", "composer"]), let requestID = request["requestId"] as? String,
                  UUID(uuidString: requestID) != nil, request["composer"] is [String: Any],
                  let prepared = input["prepared"] as? [String: Any], Self.isInteger(prepared["version"], equalTo: 1),
                  prepared["kind"] as? String == (command.method == "calendarComposerCommit" ? "existing" : "new"),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Calendar journal")
            }
            return args
        }
        if command.method == "mindSweepCommit" {
            guard let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  args[0].utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]), let request = input["request"] as? [String: Any],
                  Set(request.keys) == Set(["requestId", "title"]),
                  let id = request["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  request["title"] is String,
                  let prepared = input["prepared"] as? [String: Any], Self.isInteger(prepared["version"], equalTo: 1),
                  let original = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                    == JSONSerialization.data(withJSONObject: original, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared Mind Sweep journal")
            }
            return args
        }
        if command.method == "draftCommit" {
            guard command.argumentsJSON.utf8.count <= 12_000_000,
                  let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
                  let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
                  Set(input.keys) == Set(["request", "prepared"]), let request = input["request"] as? [String: Any],
                  Set(request.keys) == Set(["id", "base", "patch", "scheduleBase"]
                    + (request["recurrenceBase"] == nil ? [] : ["recurrenceBase"])
                    + (request["attachments"] == nil ? [] : ["attachments"])),
                  let prepared = input["prepared"] as? [String: Any],
                  (Self.isInteger(prepared["version"], equalTo: 1) || Self.isInteger(prepared["version"], equalTo: 2)),
                  let preparedRequest = prepared["request"] as? [String: Any],
                  try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]) == JSONSerialization.data(withJSONObject: preparedRequest, options: [.sortedKeys]) else {
                throw HostFailure("Malformed prepared schedule journal")
            }
            let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self)
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: [requestJSON]), as: UTF8.self)
            _ = try arguments("saveDraft", encoded)
            return args
        }
        // This method is deliberately absent from the public whitelist. Native
        // checks the transport envelope; core validates every prepared row field.
        guard command.method == "captureCommit",
              let args = try NativeJSON.jsonObject(with: Data(command.argumentsJSON.utf8)) as? [String], args.count == 1,
              let input = try NativeJSON.jsonObject(with: Data(args[0].utf8)) as? [String: Any],
              Set(input.keys) == Set(["request", "prepared"]), input["request"] is [String: Any],
              let prepared = input["prepared"] as? [String: Any], Self.isInteger(prepared["version"], equalTo: 1) else {
            throw HostFailure("Malformed prepared capture journal")
        }
        return args
    }

    private static func isPersonDeleteExpected(_ value: Any?, personID: String) -> Bool {
        guard let person = value as? [String: Any],
              Set(["id", "name", "createdAt", "updatedAt"]).isSubset(of: Set(person.keys)),
              Set(person.keys).isSubset(of: ["id", "name", "note", "referenceLink", "rev", "revBy", "createdAt", "updatedAt"]),
              Self.equalJSON(person["id"], personID),
              let name = person["name"] as? String, name.utf16.count <= 2_000_000,
              ["createdAt", "updatedAt"].allSatisfy({ field in
                  (person[field] as? String).map({ $0.utf16.count <= 500 && !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) == true
              }),
              ["note", "referenceLink"].allSatisfy({ field in
                  person[field] == nil || (person[field] as? String).map({ $0.utf16.count <= 2_000_000 }) == true
              }),
              (person["rev"] == nil || Self.isInteger(person["rev"]) && (person["rev"] as? NSNumber).map({ (0...9_007_199_254_740_991).contains($0.doubleValue) }) == true),
              (person["revBy"] == nil || (person["revBy"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true) else { return false }
        return true
    }

    private static func isInteger(_ value: Any?, equalTo expected: Int? = nil) -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue else { return false }
        return expected.map { number.doubleValue == Double($0) } ?? true
    }

    private static func isOffset(_ value: Any?) -> Bool {
        if value is NSNull { return true }
        guard let offset = value as? [String: Any], Set(offset.keys) == Set(["amount", "unit"]),
              isInteger(offset["amount"]), offset["unit"] is String else { return false }
        return true
    }

    private static func isBoolean(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return CFGetTypeID(number) == CFBooleanGetTypeID()
    }

    private static func isTimeSpent(_ value: Any?) -> Bool {
        if value is NSNull { return true }
        guard isFiniteNumber(value), let number = value as? NSNumber else { return false }
        return number.doubleValue >= 0
    }

    private static func isProjectFlowScope(_ value: Any?) -> Bool {
        if value is NSNull { return true }
        guard let scope = value as? String else { return false }
        return scope == "project" || scope == "section"
    }

    private static func isCanonicalReviewInstant(_ value: String) -> Bool {
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#,
                          options: .regularExpression) != nil else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)!
        return formatter.date(from: value).map { formatter.string(from: $0) == value } ?? false
    }

    private static func isFiniteNumber(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return false }
        return number.doubleValue.isFinite
    }

    private static func equalJSON(_ lhs: Any?, _ rhs: Any?) -> Bool {
        guard let lhs, let rhs,
              let first = try? JSONSerialization.data(withJSONObject: [lhs], options: [.sortedKeys]),
              let second = try? JSONSerialization.data(withJSONObject: [rhs], options: [.sortedKeys]) else { return false }
        return first == second
    }

    private func arguments(_ method: String, _ json: String, allowPreparedDates: Bool = true) throws -> [Any] {
        if ["taskCancellationUndo", "taskDelete", "taskDeleteUndo"].contains(method), json.utf8.count > 4_096 {
            throw HostFailure("INVALID_INPUT: Task mutation request too large")
        }
        if method == "taskPromote", json.utf8.count > 2_000_000 {
            throw HostFailure("INVALID_INPUT: Task promotion request too large")
        }
        if method == "taskEditorResumeCheck" && json.utf8.count > 2_000_000 {
            throw HostFailure("INVALID_INPUT: Editor resume check is too large")
        }
        if ["gtdWorkflowOptions", "gtdReviewOptions", "gtdInboxOptions", "gtdCaptureAreaOptions", "gtdCaptureParseOptions", "gtdTaskEditorOpenOptions", "gtdTaskEditorPresetOptions", "gtdWorkflowDraft", "gtdWorkflow", "gtdWorkflowRetryOutcome", "appLockOptions", "appLock", "appLockRetryOutcome", "generalPreferenceOptions", "generalPreference", "generalPreferenceRetryOutcome"].contains(method), json.utf8.count > 49_152 {
            throw HostFailure("INVALID_INPUT: General preference transport is too large")
        }
        if method == "gtdArchiveOptions", json.utf8.count > 49_152 {
            throw HostFailure("INVALID_INPUT: GTD Auto-archive transport is too large")
        }
        if ["manageTaxonomyOptions", "manageTaxonomy", "manageTaxonomyRetryOutcome"].contains(method), json.utf8.count > 12_000_000 {
            throw HostFailure("INVALID_INPUT: Taxonomy transport is too large")
        }
        if ["managePersonEditOptions", "managePersonEdit", "managePersonEditRetryOutcome"].contains(method), json.utf8.count > 12_000_000 {
            throw HostFailure("INVALID_INPUT: Person edit transport is too large")
        }
        if ["managePersonDeleteOptions", "managePersonDelete", "managePersonDeleteRetryOutcome"].contains(method), json.utf8.count > 12_000_000 {
            throw HostFailure("INVALID_INPUT: Person deletion transport is too large")
        }
        if ["managePersonCreateResolve", "managePersonCreate", "managePersonCreateRetryOutcome"].contains(method), json.utf8.count > 12_000_000 {
            throw HostFailure("INVALID_INPUT: Person creation transport is too large")
        }
        if ["focusOrderOptions", "focusOrderWrite", "focusOrderRetryOutcome"].contains(method) && json.utf8.count > 2_000_000 {
            throw HostFailure("INVALID_INPUT: Focus order transport is too large")
        }
        if ["focusSavedFilterOptions", "savedSearchOptions", "focusSavedFilterWrite", "savedSearchWrite", "focusSavedFilterRetryOutcome", "savedSearchRetryOutcome"].contains(method) && json.utf8.count > 2_000_000 {
            throw HostFailure("INVALID_INPUT: Focus saved filter transport is too large")
        }
        if ["focusGroupOptions", "focusGroupWrite", "focusGroupRetryOutcome"].contains(method) && json.utf8.count > 2_000_000 {
            throw HostFailure("INVALID_INPUT: Focus grouping transport is too large")
        }
        if ["taskListSortOptions", "taskListSortWrite", "taskListSortRetryOutcome"].contains(method) && json.utf8.count > 4_096 {
            throw HostFailure("INVALID_INPUT: Task list sort transport is too large")
        }
        if ["unassignedAreaColorOptions", "unassignedAreaColorWrite", "unassignedAreaColorRetryOutcome"].contains(method) && json.utf8.count > 4_096 {
            throw HostFailure("INVALID_INPUT: Unassigned area color transport is too large")
        }
        if ["somedaySectionCreateOptions", "somedaySectionCreateWrite", "somedaySectionCreateRetryOutcome",
            "somedaySectionRenameOptions", "somedaySectionRenameWrite", "somedaySectionRenameRetryOutcome",
            "somedaySectionDeleteOptions", "somedaySectionDeleteWrite", "somedaySectionDeleteRetryOutcome"].contains(method)
            && json.utf8.count > 2_100_000 {
            throw HostFailure("INVALID_INPUT: Someday section transport is too large")
        }
        if ["somedaySectionTaskOptions", "somedaySectionTaskPrepare", "somedaySectionTaskCommit", "somedaySectionTaskRetryOutcome"].contains(method)
            && json.utf8.count > 2_100_000 {
            throw HostFailure("INVALID_INPUT: Someday section task transport is too large")
        }
        if ["somedaySectionOrderOptions", "somedaySectionOrderWrite", "somedaySectionOrderRetryOutcome"].contains(method)
            && json.utf8.count > 2_100_000 {
            throw HostFailure("INVALID_INPUT: Someday section order transport is too large")
        }
        if ["somedaySectionMoveOptions", "somedaySectionMoveWrite", "somedaySectionMoveUndo",
            "somedaySectionMoveRetryOutcome", "somedaySectionMoveUndoRetryOutcome"].contains(method)
            && json.utf8.count > 2_100_000 {
            throw HostFailure("INVALID_INPUT: Someday section move transport is too large")
        }
        if method == "projectNotes" && json.utf8.count > 2_000_000 {
            throw HostFailure("INVALID_INPUT: Project Notes read is too large")
        }
        if method == "taskEditorDraftDirection" && json.utf8.count > 12_000_000 {
            throw HostFailure("INVALID_INPUT: Task Editor direction transport is too large")
        }
        if ["projectCreate", "projectSectionOptions", "projectSectionCreate", "projectSectionCreateRetryOutcome", "projectSectionRenameOptions", "projectSectionRename", "projectSectionRenameRetryOutcome", "projectSectionDeleteOptions", "projectSectionDelete", "projectSectionDeleteRetryOutcome", "projectSectionOrderOptions", "projectSectionOrder", "projectSectionOrderRetryOutcome", "areaCreate", "manageAreaCreate", "areaCreateResolve", "areaCreateRetryOutcome", "areaColor", "areaColorRetryOutcome", "areaRename", "areaRenameRetryOutcome", "manageAreaEdit", "manageAreaEditRetryOutcome", "areaOrder", "areaOrderRetryOutcome", "areaDelete", "areaDeleteRetryOutcome", "manageAreaDelete", "manageAreaDeleteRetryOutcome", "projectFocusOptions", "projectFocusWrite", "projectFocusRetryOutcome", "taskFocusOptions", "taskFocusWrite", "taskFocusRetryOutcome", "projectRenameOptions", "projectRenameWrite", "projectRenameRetryOutcome", "projectFlowOptions", "projectFlowWrite", "projectFlowRetryOutcome", "projectTaskSortOptions", "projectTaskSortWrite", "projectTaskSortRetryOutcome", "projectTaskOrderWrite", "projectTaskOrderRetryOutcome", "projectNotesEditOptions", "projectNotesReferenceTarget", "projectNotesDraftDirection", "projectNotesWrite", "projectNotesWriteRetryOutcome", "projectTagsEditOptions", "projectTagsWrite", "projectTagsWriteRetryOutcome", "projectAttachmentEditOptions", "projectAttachmentWrite", "projectAttachmentWriteRetryOutcome", "projectStatusOptions", "projectStatusWrite", "projectStatusRetryOutcome", "projectDateOptions", "projectDateWrite", "projectDateRetryOutcome", "projectAreaOptions", "projectAreaWrite", "projectAreaRetryOutcome"].contains(method) && json.utf8.count > 12_000_000 {
            throw HostFailure(method == "projectCreate" ? "INVALID_INPUT: Project creation transport is too large"
                : ["areaColor", "areaColorRetryOutcome"].contains(method) ? "INVALID_INPUT: Area color transport is too large"
                : ["areaRename", "areaRenameRetryOutcome", "manageAreaEdit", "manageAreaEditRetryOutcome"].contains(method) ? "INVALID_INPUT: Area rename transport is too large"
                : ["areaOrder", "areaOrderRetryOutcome"].contains(method) ? "INVALID_INPUT: Area order transport is too large"
                : ["areaDelete", "areaDeleteRetryOutcome", "manageAreaDelete", "manageAreaDeleteRetryOutcome"].contains(method) ? "INVALID_INPUT: Area deletion transport is too large"
                : ["projectFocusOptions", "projectFocusWrite", "projectFocusRetryOutcome"].contains(method) ? "INVALID_INPUT: Project Focus transport is too large"
                : ["taskFocusOptions", "taskFocusWrite", "taskFocusRetryOutcome"].contains(method) ? "INVALID_INPUT: Task Focus transport is too large"
                : ["projectRenameOptions", "projectRenameWrite", "projectRenameRetryOutcome"].contains(method) ? "INVALID_INPUT: Project rename transport is too large"
                : ["projectFlowOptions", "projectFlowWrite", "projectFlowRetryOutcome"].contains(method) ? "INVALID_INPUT: Project flow transport is too large"
                : ["projectTaskSortOptions", "projectTaskSortWrite", "projectTaskSortRetryOutcome"].contains(method) ? "INVALID_INPUT: Project task sort transport is too large"
                : ["projectTaskOrderWrite", "projectTaskOrderRetryOutcome"].contains(method) ? "INVALID_INPUT: Project task order transport is too large"
                : ["projectNotesEditOptions", "projectNotesReferenceTarget", "projectNotesDraftDirection", "projectNotesWrite", "projectNotesWriteRetryOutcome"].contains(method) ? "INVALID_INPUT: Project Notes transport is too large"
                : ["projectTagsEditOptions", "projectTagsWrite", "projectTagsWriteRetryOutcome"].contains(method) ? "INVALID_INPUT: Project Tags transport is too large"
                : ["projectAttachmentEditOptions", "projectAttachmentWrite", "projectAttachmentWriteRetryOutcome"].contains(method) ? "INVALID_INPUT: Project URL link transport is too large"
                : ["projectStatusOptions", "projectStatusWrite", "projectStatusRetryOutcome"].contains(method) ? "INVALID_INPUT: Project status transport is too large"
                : ["projectAreaOptions", "projectAreaWrite", "projectAreaRetryOutcome"].contains(method) ? "INVALID_INPUT: Project Area transport is too large"
                : ["projectDateOptions", "projectDateWrite", "projectDateRetryOutcome"].contains(method) ? "INVALID_INPUT: Project date transport is too large"
                : ["projectSectionOptions", "projectSectionCreate", "projectSectionCreateRetryOutcome"].contains(method) ? "INVALID_INPUT: Project Section transport is too large"
                : ["projectSectionRenameOptions", "projectSectionRename", "projectSectionRenameRetryOutcome"].contains(method) ? "INVALID_INPUT: Project Section rename transport is too large"
                : ["projectSectionDeleteOptions", "projectSectionDelete", "projectSectionDeleteRetryOutcome"].contains(method) ? "INVALID_INPUT: Project Section deletion transport is too large"
                : ["projectSectionOrderOptions", "projectSectionOrder", "projectSectionOrderRetryOutcome"].contains(method) ? "INVALID_INPUT: Project Section order transport is too large"
                : "INVALID_INPUT: Area creation transport is too large")
        }
        if ["checklistEdit", "checklistSave", "checklistReset"].contains(method) && json.utf8.count > 12_000_000 {
            throw HostFailure("INVALID_INPUT: Checklist transport is too large")
        }
        if ["inboxStart", "inboxEnd"].contains(method) && json.utf8.count > 2_048 {
            throw HostFailure("INVALID_INPUT: Process Inbox input is too large")
        }
        if ["inboxCommit", "inboxSkip", "inboxAfterCommit"].contains(method) && json.utf8.count > 16_384 {
            throw HostFailure("INVALID_INPUT: Process Inbox input is too large")
        }
        if method == "inboxStep" && json.utf8.count > 12_000_000 {
            throw HostFailure("INVALID_INPUT: Process Inbox step is too large")
        }
        guard let count = Self.methods[method],
              let args = try NativeJSON.jsonObject(with: Data(json.utf8)) as? [Any], args.count == count else {
            throw HostFailure("Invalid or unavailable core method arguments")
        }
        // Native validates its transport; the shared contract validates meaning.
        for (index, argument) in args.enumerated() {
            if (method == "window" && index < 2) || method == "focus"
                || (["focusWindow", "projectDetail", "projectNotes"].contains(method) && (index == 1 || index == 2))
                || (method == "editorSuggestions" && index == 3) {
                guard Self.isInteger(argument) else {
                    throw HostFailure("Core numeric arguments must be integers")
                }
            } else if !(argument is String) { throw HostFailure("Core arguments must be strings") }
        }
        if method == "taskEditorResumeCheck" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys).isSubset(of: ["id", "touchedBase", "scheduleBase", "recurrenceBase", "checklistBase", "attachmentsBase", "attachments"]),
                  let id = input["id"] as? String, !id.isEmpty, id.utf16.count <= 500,
                  input["touchedBase"] is [String: Any],
                  input["scheduleBase"] == nil || input["scheduleBase"] is [String: Any],
                  input["recurrenceBase"] == nil || input["recurrenceBase"] is [String: Any],
                  input["checklistBase"] == nil || input["checklistBase"] is [[String: Any]],
                  (input["attachmentsBase"] == nil) == (input["attachments"] == nil),
                  input["attachments"] == nil || Self.validTaskAttachmentHalf([
                    "base": input["attachmentsBase"]!, "value": input["attachments"]!]) else {
                throw HostFailure("INVALID_INPUT: Editor resume check needs a bounded task and raw base")
            }
        }
        if method == "taskViewReferenceTarget" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["view", "revision", "blockIndex", "inlineIndex"])
                    || Set(input.keys) == Set(["view", "revision", "blockIndex", "itemIndex", "inlineIndex"])
                    || Set(input.keys) == Set(["view", "revision", "checklistIndex", "inlineIndex"])
                    || (input["field"] as? String == "project" && Set(input.keys) == Set(["view", "revision", "field"]))
                    || (["contexts", "tags"].contains(input["field"] as? String ?? "")
                        && Set(input.keys) == Set(["view", "revision", "field", "tokenIndex"])),
                  let view = input["view"] as? [String: Any],
                  Set(view.keys).isSubset(of: ["id", "draft", "checklist", "attachments"]),
                  let id = view["id"] as? String, !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  id.utf16.count <= 500,
                  view["draft"] == nil || view["draft"] is [String: Any],
                  view["checklist"] == nil || view["checklist"] is [[String: Any]],
                  view["attachments"] == nil || Self.validTaskAttachmentList(view["attachments"]),
                  let revision = input["revision"] as? String, !revision.isEmpty,
                  (input["field"] == nil ? [input["checklistIndex"] == nil ? "blockIndex" : "checklistIndex", "inlineIndex"]
                    : input["field"] as? String == "project" ? [] : ["tokenIndex"]).allSatisfy({
                      Self.isInteger(input[$0]) && (input[$0] as? Double ?? -1) >= 0
                        && (input[$0] as? Double ?? .infinity) <= 9_007_199_254_740_991
                  }),
                  input["itemIndex"] == nil || (Self.isInteger(input["itemIndex"])
                    && (input["itemIndex"] as? Double ?? -1) >= 0
                    && (input["itemIndex"] as? Double ?? .infinity) <= 9_007_199_254_740_991) else {
                throw HostFailure("INVALID_INPUT: Task reference needs a bounded source view, revision and indices")
            }
        }
        if method == "taskShare" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["id", "taskRevision", "draft", "checklist"]),
                  let id = input["id"] as? String, !id.isEmpty, id.utf16.count <= 200,
                  let revision = input["taskRevision"] as? String, !revision.isEmpty, revision.utf16.count <= 200,
                  input["draft"] is [String: Any], input["checklist"] is [[String: Any]] else {
                throw HostFailure("INVALID_INPUT: Task Share needs a bounded task, revision, draft and checklist")
            }
        }
        if method == "taskView" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys).isSubset(of: ["id", "draft", "checklist", "attachments", "offset", "limit", "revision"]),
                  let id = input["id"] as? String, !id.isEmpty, id.utf16.count <= 500,
                  input["attachments"] == nil || Self.validTaskAttachmentList(input["attachments"]) else {
                throw HostFailure("INVALID_INPUT: Task view needs bounded draft attachments")
            }
        }
        if ["taskAttachmentList", "taskAttachmentOpen", "taskAttachmentLinks", "taskAttachmentRemove"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Self.validTaskAttachmentOwner(input["owner"]),
                  Set(input.keys) == Set(method == "taskAttachmentList" ? ["owner"]
                    : method == "taskAttachmentOpen" ? ["owner", "attachmentId"]
                    : method == "taskAttachmentRemove" ? ["owner", "requestId", "attachmentId"]
                    : ["owner", "requestId", "text"] + (input["editing"] == nil ? [] : ["editing"])) else {
                throw HostFailure("INVALID_INPUT: Attachment draft needs a bounded Task owner")
            }
            if method != "taskAttachmentList" && method != "taskAttachmentOpen" {
                guard let requestID = input["requestId"] as? String,
                      requestID == UUID(uuidString: requestID)?.uuidString.lowercased() else {
                    throw HostFailure("INVALID_INPUT: Attachment draft needs a lowercase request UUID")
                }
            }
            if method == "taskAttachmentLinks" {
                guard (input["text"] as? String).map({ $0.utf16.count <= 32_000 }) == true,
                      input["editing"] == nil || input["editing"] is NSNull || Self.validTaskLinkEditing(input["editing"]) else {
                    throw HostFailure("INVALID_INPUT: Attachment link input is malformed")
                }
            } else if method == "taskAttachmentRemove" || method == "taskAttachmentOpen" {
                guard (input["attachmentId"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true else {
                    throw HostFailure("INVALID_INPUT: Attachment link target is malformed")
                }
            }
        }
        if ["projectAttachmentList", "projectAttachmentOpen"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(method == "projectAttachmentList" ? ["projectId"] : ["projectId", "attachmentId"]),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  method == "projectAttachmentList" || (input["attachmentId"] as? String)
                    .map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true else {
                throw HostFailure("INVALID_INPUT: Project attachment request is malformed")
            }
        }
        if ["focusGroupOptions", "focusGroupWrite", "focusGroupRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 1_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  input["controls"] is [String: Any] else {
                throw HostFailure("INVALID_INPUT: Focus grouping needs bounded controls")
            }
            if method == "focusGroupOptions" {
                guard Set(input.keys) == Set(["controls"]) else {
                    throw HostFailure("INVALID_INPUT: Focus grouping options need only controls")
                }
            } else {
                guard Set(input.keys) == Set(["requestId", "controls", "groupBy", "expected"]),
                      let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                      let group = input["groupBy"] as? String,
                      ["none", "context", "project", "area", "energy", "priority", "person", "tag"].contains(group),
                      let expected = input["expected"] as? [String: Any],
                      Set(expected.keys) == Set(["groupBy", "updatedAt"]),
                      expected["groupBy"] is NSNull || (expected["groupBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                      expected["updatedAt"] is NSNull || (expected["updatedAt"] as? String).map({ $0.utf16.count <= 500 }) == true else {
                    throw HostFailure("INVALID_INPUT: Focus grouping needs an exact choice, raw token, and lowercase UUID")
                }
            }
        }
        if ["taskListSortOptions", "taskListSortWrite", "taskListSortRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 4_096,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any] else {
                throw HostFailure("INVALID_INPUT: Task list sort needs a bounded object")
            }
            if method == "taskListSortOptions" {
                guard input.isEmpty else { throw HostFailure("INVALID_INPUT: Task list sort options need an empty object") }
            } else {
                guard Set(input.keys) == Set(["requestId", "sortBy", "expected"]),
                      let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                      let sortBy = input["sortBy"] as? String,
                      ["default", "due", "start", "review", "timeEstimate", "title", "created", "created-desc"].contains(sortBy),
                      let expected = input["expected"] as? [String: Any], Set(expected.keys) == Set(["sortBy"]),
                      expected["sortBy"] is NSNull || (expected["sortBy"] as? String).map({ $0.utf16.count <= 500 }) == true else {
                    throw HostFailure("INVALID_INPUT: Task list sort needs an exact choice, raw token, and lowercase UUID")
                }
            }
        }
        if ["unassignedAreaColorOptions", "unassignedAreaColorWrite", "unassignedAreaColorRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 4_096,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any] else {
                throw HostFailure("INVALID_INPUT: Unassigned area color needs a bounded object")
            }
            if method == "unassignedAreaColorOptions" {
                guard input.isEmpty else { throw HostFailure("INVALID_INPUT: Unassigned area color options need an empty object") }
            } else {
                guard Set(input.keys) == Set(["requestId", "color", "expected"]),
                      let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                      let color = input["color"] as? String, color.utf16.count <= 500,
                      let expected = input["expected"] as? [String: Any],
                      Set(expected.keys) == Set(["color", "updatedAt"]),
                      expected["color"] is NSNull || (expected["color"] as? String).map({ $0.utf16.count <= 500 }) == true,
                      expected["updatedAt"] is NSNull || (expected["updatedAt"] as? String).map({ $0.utf16.count <= 500 }) == true else {
                    throw HostFailure("INVALID_INPUT: Unassigned area color needs an exact choice, raw token, and lowercase UUID")
                }
            }
        }
        if ["somedaySectionCreateOptions", "somedaySectionCreateWrite", "somedaySectionCreateRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 1_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any] else {
                throw HostFailure("INVALID_INPUT: Someday section creation needs a bounded object")
            }
            if method == "somedaySectionCreateOptions" {
                guard input.isEmpty else { throw HostFailure("INVALID_INPUT: Someday section options need an empty object") }
            } else {
                guard Set(input.keys) == Set(["requestId", "title", "expected"]),
                      let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                      let title = input["title"] as? String, !title.isEmpty, title.utf16.count <= 200,
                      !title.contains("\0"),
                      let expected = input["expected"] as? [String: Any],
                      Set(expected.keys) == Set(["sections", "updatedAt"]),
                      expected["sections"] is NSNull || expected["sections"] is [Any],
                      expected["updatedAt"] is NSNull || expected["updatedAt"] is String else {
                    throw HostFailure("INVALID_INPUT: Someday section creation needs exact raw sections, stamp, title, and lowercase UUID")
                }
            }
        }
        if ["somedaySectionRenameOptions", "somedaySectionRenameWrite", "somedaySectionRenameRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 1_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  let sectionID = input["id"] as? String, !sectionID.isEmpty,
                  sectionID.utf16.count <= 500, !sectionID.contains("\0") else {
                throw HostFailure("INVALID_INPUT: Someday section rename needs a bounded exact ID")
            }
            if method == "somedaySectionRenameOptions" {
                guard Set(input.keys) == Set(["id"]) else {
                    throw HostFailure("INVALID_INPUT: Someday section rename options need an exact ID")
                }
            } else {
                guard Set(input.keys) == Set(["requestId", "id", "title", "expected"]),
                      let requestID = input["requestId"] as? String,
                      requestID == UUID(uuidString: requestID)?.uuidString.lowercased(),
                      let title = input["title"] as? String, !title.isEmpty,
                      title.utf16.count <= 200, !title.contains("\0"),
                      let expected = input["expected"] as? [String: Any],
                      Set(expected.keys) == Set(["sections", "updatedAt"]),
                      expected["sections"] is NSNull || expected["sections"] is [Any],
                      expected["updatedAt"] is NSNull || expected["updatedAt"] is String else {
                    throw HostFailure("INVALID_INPUT: Someday section rename needs exact raw sections, stamp, title, ID, and lowercase UUID")
                }
            }
        }
        if ["somedaySectionDeleteOptions", "somedaySectionDeleteWrite", "somedaySectionDeleteRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 1_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  let sectionID = input["id"] as? String, !sectionID.isEmpty,
                  sectionID.utf16.count <= 500, !sectionID.contains("\0") else {
                throw HostFailure("INVALID_INPUT: Someday section delete needs a bounded exact ID")
            }
            if method == "somedaySectionDeleteOptions" {
                guard Set(input.keys) == Set(["id"]) else {
                    throw HostFailure("INVALID_INPUT: Someday section delete options need an exact ID")
                }
            } else {
                guard Set(input.keys) == Set(["requestId", "id", "expected"]),
                      let requestID = input["requestId"] as? String,
                      requestID == UUID(uuidString: requestID)?.uuidString.lowercased(),
                      let expected = input["expected"] as? [String: Any],
                      Set(expected.keys) == Set(["sections", "updatedAt"]),
                      expected["sections"] is NSNull || expected["sections"] is [Any],
                      expected["updatedAt"] is NSNull || expected["updatedAt"] is String else {
                    throw HostFailure("INVALID_INPUT: Someday section delete needs exact raw sections, stamp, ID, and lowercase UUID")
                }
            }
        }
        if ["somedaySectionOrderOptions", "somedaySectionOrderWrite", "somedaySectionOrderRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 1_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  let sectionID = input["id"] as? String, !sectionID.isEmpty,
                  sectionID.utf16.count <= 500, !sectionID.contains("\0"),
                  Self.isInteger(input["offset"], equalTo: -1) || Self.isInteger(input["offset"], equalTo: 1) else {
                throw HostFailure("INVALID_INPUT: Someday section order needs an exact ID and direction")
            }
            if method == "somedaySectionOrderOptions" {
                guard Set(input.keys) == Set(["id", "offset"]) else {
                    throw HostFailure("INVALID_INPUT: Someday section order options need an exact ID and direction")
                }
            } else {
                guard Set(input.keys) == Set(["requestId", "id", "offset", "expected"]),
                      let requestID = input["requestId"] as? String,
                      requestID == UUID(uuidString: requestID)?.uuidString.lowercased(),
                      let expected = input["expected"] as? [String: Any],
                      Set(expected.keys) == Set(["sections", "updatedAt"]),
                      expected["sections"] is [Any],
                      expected["updatedAt"] is NSNull || expected["updatedAt"] is String else {
                    throw HostFailure("INVALID_INPUT: Someday section order needs exact raw sections, stamp, ID, direction, and lowercase UUID")
                }
            }
        }
        if ["somedaySectionTaskOptions", "somedaySectionTaskPrepare", "somedaySectionTaskCommit", "somedaySectionTaskRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 1_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any] else {
                throw HostFailure("INVALID_INPUT: Someday section task needs a bounded object")
            }
            if method == "somedaySectionTaskOptions" {
                guard Set(input.keys) == Set(["sectionId"]),
                      input["sectionId"] is NSNull || (input["sectionId"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 && !$0.contains("\0") }) == true else {
                    throw HostFailure("INVALID_INPUT: Someday task options need a section ID or null")
                }
            } else {
                let request: [String: Any]
                if method == "somedaySectionTaskPrepare" { request = input }
                else {
                    guard Set(input.keys) == Set(["request", "prepared"]),
                          let submitted = input["request"] as? [String: Any],
                          input["prepared"] is [String: Any] else {
                        throw HostFailure("INVALID_INPUT: Someday task needs an exact prepared envelope")
                    }
                    request = submitted
                }
                guard Set(request.keys) == Set(["requestId", "title", "sectionId"]),
                      let id = request["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                      let title = request["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      title.utf16.count <= 10_000, !title.contains("\0"),
                      request["sectionId"] is NSNull || (request["sectionId"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 && !$0.contains("\0") }) == true else {
                    throw HostFailure("INVALID_INPUT: Someday task needs an exact title, section, and lowercase UUID")
                }
            }
        }
        if ["somedaySectionMoveOptions", "somedaySectionMoveWrite", "somedaySectionMoveUndo",
            "somedaySectionMoveRetryOutcome", "somedaySectionMoveUndoRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 1_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any] else {
                throw HostFailure("INVALID_INPUT: Someday move needs a bounded request")
            }
            if method == "somedaySectionMoveOptions" {
                guard Set(input.keys).isSubset(of: Set(["taskId", "offset", "limit", "revision"])),
                      let id = input["taskId"] as? String, !id.isEmpty, id.utf16.count <= 500, !id.contains("\0"),
                      input["offset"] == nil || (Self.isInteger(input["offset"])
                        && (input["offset"] as? NSNumber).map({ $0.intValue >= 0 }) == true),
                      input["limit"] == nil || (Self.isInteger(input["limit"])
                        && (input["limit"] as? NSNumber).map({ (1...100).contains($0.intValue) }) == true),
                      input["revision"] == nil || (input["revision"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 && !$0.contains("\0") }) == true else {
                    throw HostFailure("INVALID_INPUT: Someday move needs a bounded task and window")
                }
            } else if ["somedaySectionMoveWrite", "somedaySectionMoveRetryOutcome"].contains(method) {
                guard Set(input.keys) == Set(["requestId", "taskId", "taskRevision", "sectionId"]),
                      let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                      let taskID = input["taskId"] as? String, !taskID.isEmpty, taskID.utf16.count <= 500, !taskID.contains("\0"),
                      let revision = input["taskRevision"] as? String, !revision.isEmpty, revision.utf16.count <= 200, !revision.contains("\0"),
                      input["sectionId"] is NSNull || (input["sectionId"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 && !$0.contains("\0") }) == true else {
                    throw HostFailure("INVALID_INPUT: Someday move needs an exact task, revision, destination, and lowercase UUID")
                }
            } else {
                guard Set(input.keys) == Set(["requestId", "moveRequestId"]),
                      let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                      let moveID = input["moveRequestId"] as? String, moveID == UUID(uuidString: moveID)?.uuidString.lowercased(),
                      id != moveID else {
                    throw HostFailure("INVALID_INPUT: Someday Undo needs two distinct lowercase UUIDs")
                }
            }
        }
        if method == "projectNotes" {
            guard let id = args[0] as? String, !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let offset = args[1] as? NSNumber, offset.doubleValue >= 0,
                  offset.doubleValue <= 9_007_199_254_740_991,
                  let limit = args[2] as? NSNumber, limit.doubleValue >= 1, limit.doubleValue <= 100,
                  let revision = args[3] as? String, (offset.doubleValue == 0 || !revision.isEmpty) else {
                throw HostFailure("INVALID_INPUT: Project Notes needs a bounded Project ID, window, and later-page revision")
            }
        }
        if method == "inboxStart" {
            guard let mode = args.first as? String, ["guided", "quick"].contains(mode) else {
                throw HostFailure("INVALID_INPUT: Process Inbox mode must be guided or quick")
            }
        }
        if method == "inboxEnd" {
            guard let session = args.first as? String, session.utf16.count <= 500,
                  !session.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw HostFailure("INVALID_INPUT: Process Inbox needs a bounded session ID")
            }
        }
        if ["inboxCommit", "inboxSkip", "inboxAfterCommit"].contains(method) {
            let fields: Set<String> = method == "inboxAfterCommit" ? ["sessionId", "requestId"]
                : method == "inboxSkip" ? ["sessionId", "taskId", "requestId"]
                : ["sessionId", "taskId", "requestId", "step", "decision"]
            guard let encoded = args.first as? String, encoded.utf8.count <= 8_192,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == fields,
                  fields.subtracting(["decision"]).allSatisfy({ field in
                      guard let value = input[field] as? String else { return false }
                      return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf16.count <= 500
                  }), let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased() else {
                throw HostFailure("INVALID_INPUT: Process Inbox needs a bounded request and lowercase UUID")
            }
            if method == "inboxCommit" {
                guard let decision = input["decision"] as? [String: Any], Set(decision.keys) == Set(["choice"]),
                      let choice = decision["choice"] as? String, !choice.isEmpty, choice.utf16.count <= 500 else {
                    throw HostFailure("INVALID_INPUT: Process Inbox needs one bounded decision choice")
                }
            }
        }
        if method == "inboxStep" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys).isSubset(of: Set(["sessionId", "taskId", "step", "edit", "mode"])),
                  ["sessionId", "taskId", "step"].allSatisfy({ field in
                      guard let value = input[field] as? String else { return false }
                      return !value.isEmpty && value.utf16.count <= 500
                  }),
                  (input["edit"] == nil || input["edit"] is [String: Any]),
                  (input["mode"] == nil || (input["mode"] as? String).map({ $0.utf16.count <= 32 }) == true) else {
                throw HostFailure("INVALID_INPUT: Process Inbox needs a bounded step object")
            }
        }
        if ["inboxView", "captureView", "captureEdit", "captureSubmit", "setAreaFilter", "taskView", "taskViewReferenceTarget", "editDraft", "destinationPicker", "search", "mindSweepGuide", "mindSweepAdd",
            "calendarComposerOpen", "calendarComposerEdit", "calendarComposerSave", "projectCreate", "projectCreateRetryOutcome", "projectSectionOptions", "projectSectionCreate", "projectSectionCreateRetryOutcome", "projectSectionRenameOptions", "projectSectionRename", "projectSectionRenameRetryOutcome", "projectSectionDeleteOptions", "projectSectionDelete", "projectSectionDeleteRetryOutcome",
            "appLockOptions", "appLock", "appLockRetryOutcome", "gtdWorkflowOptions", "gtdReviewOptions", "gtdInboxOptions", "gtdCaptureAreaOptions", "gtdCaptureParseOptions", "gtdTaskEditorOpenOptions", "gtdTaskEditorPresetOptions", "gtdWorkflowDraft", "gtdWorkflow", "gtdWorkflowRetryOutcome", "generalPreferenceOptions", "manageTaxonomyOptions", "managePersonEditOptions", "generalPreference", "manageTaxonomy", "managePersonEdit", "generalPreferenceRetryOutcome", "manageTaxonomyRetryOutcome", "managePersonEditRetryOutcome", "managePersonDeleteOptions", "managePersonDelete", "managePersonDeleteRetryOutcome", "managePersonCreateResolve", "managePersonCreate", "managePersonCreateRetryOutcome", "areaCreateResolve", "areaCreate", "manageAreaCreate", "areaCreateRetryOutcome", "areaColor", "areaColorRetryOutcome", "areaRename", "areaRenameRetryOutcome", "manageAreaEdit", "manageAreaEditRetryOutcome", "areaOrder", "areaOrderRetryOutcome", "areaDelete", "areaDeleteRetryOutcome", "manageAreaDelete", "manageAreaDeleteRetryOutcome", "projectFocusOptions", "projectFocusWrite", "projectFocusRetryOutcome", "taskFocusOptions", "taskFocusWrite", "taskFocusRetryOutcome", "projectRenameOptions", "projectRenameWrite", "projectRenameRetryOutcome", "projectFlowOptions", "projectFlowWrite", "projectFlowRetryOutcome", "projectTaskSortOptions", "projectTaskSortWrite", "projectTaskSortRetryOutcome", "projectTaskOrderWrite", "projectTaskOrderRetryOutcome", "projectNotesEditOptions", "projectNotesReferenceTarget", "projectNotesDraftDirection", "projectNotesWrite", "projectNotesWriteRetryOutcome", "projectTagsWrite", "projectTagsWriteRetryOutcome", "projectAttachmentEditOptions", "projectAttachmentWrite", "projectAttachmentWriteRetryOutcome", "projectStatusOptions", "projectStatusWrite", "projectStatusRetryOutcome", "projectDateOptions", "projectDateWrite", "projectDateRetryOutcome", "projectAreaWrite", "projectAreaRetryOutcome"].contains(method) {
            guard let json = args.first as? String,
                  (try NativeJSON.jsonObject(with: Data(json.utf8))) is [String: Any] else {
                throw HostFailure("Core input must be a JSON object")
            }
        }
        if method == "projectCreate" || method == "projectCreateRetryOutcome" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "title", "areaId"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let title = input["title"] as? String,
                  !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  input["areaId"] is NSNull || (input["areaId"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true else {
                throw HostFailure("INVALID_INPUT: Project creation needs one bounded title, area, and lowercase UUID")
            }
        }
        if method == "projectSectionOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId"]),
                  let projectID = input["projectId"] as? String,
                  !projectID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project Section options need one bounded Project ID")
            }
        }
        if ["projectSectionCreate", "projectSectionCreateRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "title"]),
                  let id = input["requestId"] as? String,
                  id == UUID(uuidString: id)?.uuidString.lowercased(),
                  let projectID = input["projectId"] as? String,
                  !projectID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  projectID.utf16.count <= 500,
                  let title = input["title"] as? String,
                  !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  title.utf16.count <= 100_000 else {
                throw HostFailure("INVALID_INPUT: Project Section creation needs a bounded parent, title, and lowercase UUID")
            }
        }
        if method == "projectSectionRenameOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId", "sectionId"]),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let sectionID = input["sectionId"] as? String, !sectionID.isEmpty, sectionID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project Section rename options need bounded IDs")
            }
        }
        if ["projectSectionRename", "projectSectionRenameRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "sectionId", "title", "expected"]),
                  let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let sectionID = input["sectionId"] as? String, !sectionID.isEmpty, sectionID.utf16.count <= 500,
                  let title = input["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  title.utf16.count <= 100_000,
                  let expected = input["expected"] as? [String: Any],
                  expected["id"] as? String == sectionID,
                  expected["projectId"] as? String == projectID,
                  expected["title"] is String else {
                throw HostFailure("INVALID_INPUT: Project Section rename needs a bounded token, title, and lowercase UUID")
            }
        }
        if method == "projectSectionDeleteOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId", "sectionId"]),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let sectionID = input["sectionId"] as? String, !sectionID.isEmpty, sectionID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project Section deletion options need bounded IDs")
            }
        }
        if ["projectSectionDelete", "projectSectionDeleteRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "sectionId", "expected"]),
                  let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let sectionID = input["sectionId"] as? String, !sectionID.isEmpty, sectionID.utf16.count <= 500,
                  let expected = input["expected"] as? [String: Any],
                  expected["id"] as? String == sectionID,
                  expected["projectId"] as? String == projectID,
                  expected["title"] is String else {
                throw HostFailure("INVALID_INPUT: Project Section deletion needs a bounded token and lowercase UUID")
            }
        }
        if method == "projectSectionOrderOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId"]),
                  let projectID = input["projectId"] as? String,
                  !projectID.isEmpty, projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project Section order options need one bounded Project ID")
            }
        }
        if ["projectSectionOrder", "projectSectionOrderRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "sectionId", "direction", "expectedSections"]),
                  let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let sectionID = input["sectionId"] as? String, !sectionID.isEmpty, sectionID.utf16.count <= 500,
                  let direction = input["direction"] as? String, ["up", "down"].contains(direction),
                  let expected = input["expectedSections"] as? [[String: Any]], expected.count >= 2,
                  expected.allSatisfy({ section in
                      guard let id = section["id"] as? String, !id.isEmpty, id.utf16.count <= 500,
                            section["projectId"] as? String == projectID,
                            let title = section["title"] as? String, title.utf16.count <= 100_000 else { return false }
                      return true
                  }),
                  Set(expected.compactMap { $0["id"] as? String }).count == expected.count else {
                throw HostFailure("INVALID_INPUT: Project Section order needs a complete bounded token and lowercase UUID")
            }
        }
        if method == "projectFocusOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId"]),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty,
                  projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project Focus options need one bounded Project ID")
            }
        }
        if ["projectFocusWrite", "projectFocusRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "focused", "expected"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  Self.isBoolean(input["focused"]),
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["title", "status", "isFocused", "rev", "revBy", "updatedAt"]),
                  let title = expected["title"] as? String, title.utf16.count <= 100_000,
                  let status = expected["status"] as? String, !status.isEmpty, status.utf16.count <= 100,
                  Self.isBoolean(expected["isFocused"]),
                  expected["rev"] is NSNull || Self.isInteger(expected["rev"]),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Project Focus needs a bounded row token and lowercase UUID")
            }
        }
        if method == "taskFocusOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["taskId"]),
                  let taskID = input["taskId"] as? String, !taskID.isEmpty,
                  taskID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Task Focus options need one bounded Task ID")
            }
        }
        if method == "focusOrderOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["controls"]), input["controls"] is [String: Any] else {
                throw HostFailure("INVALID_INPUT: Focus order options need bounded controls")
            }
        }
        if method == "savedSearchOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["operation"]), Self.validSavedSearchOperation(input["operation"]) else {
                throw HostFailure("INVALID_INPUT: Saved search options need a bounded operation")
            }
        }
        if ["savedSearchWrite", "savedSearchRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "operation", "name", "expected"]),
                  let requestID = input["requestId"] as? String,
                  requestID == UUID(uuidString: requestID)?.uuidString.lowercased(),
                  Self.validSavedSearchOperation(input["operation"]),
                  let operation = input["operation"] as? [String: Any],
                  (operation["type"] as? String == "save"
                    ? (input["name"] as? String).map({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf16.count <= 2000 }) == true
                    : input["name"] is NSNull),
                  let expected = input["expected"] as? String, !expected.isEmpty, expected.utf8.count <= 2_000_000,
                  try NativeJSON.jsonObject(with: Data(expected.utf8)) is [String: Any] else {
                throw HostFailure("INVALID_INPUT: Saved search needs a bounded operation, name, token, and lowercase UUID")
            }
        }
        if method == "focusSavedFilterOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["controls", "operation"]),
                  input["controls"] is [String: Any], Self.validFocusSavedFilterOperation(input["operation"]) else {
                throw HostFailure("INVALID_INPUT: Focus saved filter options need controls and operation")
            }
        }
        if ["focusSavedFilterWrite", "focusSavedFilterRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "controls", "operation", "name", "expected"]),
                  let requestID = input["requestId"] as? String,
                  requestID == UUID(uuidString: requestID)?.uuidString.lowercased(),
                  input["controls"] is [String: Any],
                  Self.validFocusSavedFilterOperation(input["operation"]),
                  let operation = input["operation"] as? [String: Any],
                  let type = operation["type"] as? String,
                  (type == "save" && (input["name"] as? String).map({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count <= 500 }) == true)
                    || (type != "save" && input["name"] is NSNull),
                  let expected = input["expected"] as? String, !expected.isEmpty, expected.utf8.count <= 2_000_000,
                  try NativeJSON.jsonObject(with: Data(expected.utf8)) is [String: Any] else {
                throw HostFailure("INVALID_INPUT: Focus saved filter needs bounded controls, operation, token, and lowercase UUID")
            }
        }
        if ["focusOrderWrite", "focusOrderRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "controls", "ids", "expectedOrder"]),
                  let requestID = input["requestId"] as? String,
                  requestID == UUID(uuidString: requestID)?.uuidString.lowercased(),
                  input["controls"] is [String: Any],
                  let ids = input["ids"] as? [String], !ids.isEmpty, ids.count <= 100,
                  ids.allSatisfy({ !$0.isEmpty && $0.utf16.count <= 500 }),
                  Set(ids.map({ Data($0.utf8) })).count == ids.count,
                  let order = input["expectedOrder"] as? String, !order.isEmpty, order.utf8.count <= 2_000_000,
                  try NativeJSON.jsonObject(with: Data(order.utf8)) is [Any] else {
                throw HostFailure("INVALID_INPUT: Focus order needs bounded unique IDs, token, controls, and lowercase UUID")
            }
        }
        if ["taskFocusWrite", "taskFocusRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "taskId", "focused", "expected"]),
                  let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                  let taskID = input["taskId"] as? String, !taskID.isEmpty, taskID.utf16.count <= 500,
                  Self.isBoolean(input["focused"]),
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["title", "status", "isFocusedToday", "rev", "revBy", "updatedAt"]),
                  let title = expected["title"] as? String, title.utf16.count <= 100_000,
                  let status = expected["status"] as? String,
                  ["inbox", "next", "waiting", "someday", "reference", "done", "archived"].contains(status),
                  Self.isBoolean(expected["isFocusedToday"]),
                  expected["rev"] is NSNull || (Self.isInteger(expected["rev"])
                      && (expected["rev"] as? NSNumber).map({ $0.doubleValue >= 0 && $0.doubleValue <= 9_007_199_254_740_991 }) == true),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, !updated.isEmpty, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Task Focus needs a bounded row token and lowercase UUID")
            }
        }
        if method == "projectRenameOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId"]),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty,
                  projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project rename options need one bounded Project ID")
            }
        }
        if ["projectRenameWrite", "projectRenameRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "title", "expected"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let title = input["title"] as? String, title.utf16.count <= 100_000,
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["title", "status", "rev", "revBy", "updatedAt"]),
                  let oldTitle = expected["title"] as? String, oldTitle.utf16.count <= 100_000,
                  let status = expected["status"] as? String,
                  ["active", "someday", "waiting", "archived"].contains(status),
                  expected["rev"] is NSNull || (Self.isInteger(expected["rev"]) && (expected["rev"] as? Int ?? -1) >= 0),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Project rename needs a bounded row token and lowercase UUID")
            }
        }
        if method == "projectDateOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId", "field"]),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty,
                  projectID.utf16.count <= 500,
                  let field = input["field"] as? String, ["startDate", "dueDate", "reviewAt"].contains(field) else {
                throw HostFailure("INVALID_INPUT: Project date options need a bounded Project ID and date field")
            }
        }
        if method == "projectAreaOptions" {
            guard let projectID = args.first as? String, !projectID.isEmpty,
                  projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project Area options need one bounded Project ID")
            }
        }
        if ["projectAreaWrite", "projectAreaRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "areaId", "expected", "selectedArea"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  input["areaId"] is NSNull || (input["areaId"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true,
                  let expected = input["expected"] as? [String: Any],
                  Self.validProjectAreaToken(expected, includesID: false) else {
                throw HostFailure("INVALID_INPUT: Project Area needs a bounded row token and lowercase UUID")
            }
            if input["areaId"] is NSNull {
                guard input["selectedArea"] is NSNull else {
                    throw HostFailure("INVALID_INPUT: No Area must have no selected Area witness")
                }
            } else {
                guard let areaID = input["areaId"] as? String,
                      let selected = input["selectedArea"] as? [String: Any],
                      Set(selected.keys) == Set(["id", "name"]),
                      selected["id"] as? String == areaID,
                      (selected["name"] as? String).map({ $0.utf16.count <= 100_000 }) == true else {
                    throw HostFailure("INVALID_INPUT: Project Area needs an exact selected Area witness")
                }
            }
        }
        if ["projectDateWrite", "projectDateRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "field", "value", "expected"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let field = input["field"] as? String, ["startDate", "dueDate", "reviewAt"].contains(field),
                  input["value"] is NSNull || (input["value"] as? String).map({
                      field == "reviewAt" ? Self.isCanonicalReviewInstant($0)
                        : $0.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
                  }) == true,
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["title", "status", "startDate", "dueDate", "rev", "revBy", "updatedAt"])
                    .union(field == "reviewAt" ? ["reviewAt"] : []),
                  let title = expected["title"] as? String, title.utf16.count <= 100_000,
                  let oldStatus = expected["status"] as? String,
                  ["active", "waiting", "someday", "archived"].contains(oldStatus),
                  ["startDate", "dueDate"].allSatisfy({ key in
                      expected[key] is NSNull || (expected[key] as? String).map({ $0.utf16.count <= 100 }) == true
                  }),
                  field != "reviewAt" || expected["reviewAt"] is NSNull
                    || (expected["reviewAt"] as? String).map({ $0.utf16.count <= 100 }) == true,
                  expected["rev"] is NSNull || (Self.isInteger(expected["rev"]) && (expected["rev"] as? Int ?? -1) >= 0),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Project date needs a bounded row token, date field, and lowercase UUID")
            }
        }
        if method == "projectStatusOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId"]),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty,
                  projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project status options need one bounded Project ID")
            }
        }
        if ["projectStatusWrite", "projectStatusRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "status", "expected"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let status = input["status"] as? String, ["active", "waiting", "someday"].contains(status),
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["title", "status", "isFocused", "cancelledAt", "rev", "revBy", "updatedAt"]),
                  let title = expected["title"] as? String, title.utf16.count <= 100_000,
                  let oldStatus = expected["status"] as? String,
                  ["active", "waiting", "someday", "archived"].contains(oldStatus),
                  expected["isFocused"] is NSNull || Self.isBoolean(expected["isFocused"]),
                  expected["cancelledAt"] is NSNull || (expected["cancelledAt"] as? String).map({ $0.utf16.count <= 100 }) == true,
                  expected["rev"] is NSNull || (Self.isInteger(expected["rev"]) && (expected["rev"] as? Int ?? -1) >= 0),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Project status needs bounded row token, requested status, and lowercase UUID")
            }
        }
        if method == "projectNotesReferenceTarget" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId", "revision", "blockIndex", "inlineIndex"])
                    || Set(input.keys) == Set(["projectId", "revision", "blockIndex", "itemIndex", "inlineIndex"]),
                  let projectID = input["projectId"] as? String, !projectID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  projectID.utf16.count <= 500,
                  let revision = input["revision"] as? String, !revision.isEmpty,
                  revision.utf16.count <= 500,
                  ["blockIndex", "inlineIndex"].allSatisfy({
                      Self.isInteger(input[$0]) && (input[$0] as? Double ?? -1) >= 0
                        && (input[$0] as? Double ?? .infinity) <= 9_007_199_254_740_991
                  }),
                  input["itemIndex"] == nil || (Self.isInteger(input["itemIndex"])
                    && (input["itemIndex"] as? Double ?? -1) >= 0
                    && (input["itemIndex"] as? Double ?? .infinity) <= 9_007_199_254_740_991) else {
                throw HostFailure("INVALID_INPUT: Project Notes reference needs a bounded source revision and indices")
            }
        }
        if method == "projectNotesDraftDirection" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId", "text"]),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty,
                  projectID.utf16.count <= 500, input["text"] is String else {
                throw HostFailure("INVALID_INPUT: Project Notes draft direction needs one bounded Project ID and raw text")
            }
        }
        if method == "taskEditorDraftDirection" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["id", "title", "description"]),
                  let taskID = input["id"] as? String, !taskID.isEmpty,
                  taskID.utf16.count <= 500,
                  input["title"] is String, input["description"] is String else {
                throw HostFailure("INVALID_INPUT: Task Editor draft direction needs one bounded Task ID, raw title, and raw Notes")
            }
        }
        if method == "projectNotesEditOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId"]),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty,
                  projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project Notes options need one bounded Project ID")
            }
        }
        if ["projectNotesWrite", "projectNotesWriteRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "text", "expected"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  input["text"] is String,
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["title", "status", "supportNotes", "rev", "revBy", "updatedAt"]),
                  let title = expected["title"] as? String, title.utf16.count <= 100_000,
                  let status = expected["status"] as? String,
                  ["active", "someday", "waiting", "archived"].contains(status),
                  expected["supportNotes"] is NSNull || expected["supportNotes"] is String,
                  expected["rev"] is NSNull || (Self.isInteger(expected["rev"]) && (expected["rev"] as? Int ?? -1) >= 0),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Project Notes write needs bounded raw text, row token, and lowercase UUID")
            }
        }
        if method == "projectTagsEditOptions" {
            guard let projectID = args.first as? String, !projectID.isEmpty,
                  projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project Tags options need one bounded Project ID")
            }
        }
        if ["projectTagsWrite", "projectTagsWriteRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "intent", "expected"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let intent = input["intent"] as? [String: Any],
                  let kind = intent["kind"] as? String,
                  (kind == "clear" && Set(intent.keys) == Set(["kind"])
                    || ["add", "toggle"].contains(kind) && Set(intent.keys) == Set(["kind", "input"])
                        && (intent["input"] as? String).map({ $0.utf16.count <= 100_000 }) == true),
                  let expected = input["expected"] as? [String: Any],
                  Self.validProjectTagsToken(expected, includesID: false) else {
                throw HostFailure("INVALID_INPUT: Project Tags write needs bounded raw intent, row token, and lowercase UUID")
            }
        }
        if method == "projectAttachmentEditOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId"]),
                  let projectID = input["projectId"] as? String,
                  !projectID.isEmpty, projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project URL link options need one bounded Project ID")
            }
        }
        if ["projectAttachmentWrite", "projectAttachmentWriteRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "intent", "expected"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let intent = input["intent"] as? [String: Any],
                  let kind = intent["kind"] as? String,
                  (kind == "add" && Set(intent.keys) == Set(["kind", "text"])
                    && (intent["text"] as? String).map({ $0.utf16.count <= 100_000 }) == true
                    || kind == "remove" && Set(intent.keys) == Set(["kind", "attachmentId"])
                        && (intent["attachmentId"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true),
                  let expected = input["expected"] as? [String: Any],
                  Self.validProjectAttachmentToken(expected, includesID: false) else {
                throw HostFailure("INVALID_INPUT: Project URL link write needs bounded intent, row token, and lowercase UUID")
            }
        }
        if method == "projectFlowOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId"]),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty,
                  projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project flow options need one bounded Project ID")
            }
        }
        if ["projectFlowWrite", "projectFlowRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "action", "expected"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let action = input["action"] as? [String: Any],
                  let kind = action["kind"] as? String,
                  (kind == "toggleType" && Set(action.keys) == Set(["kind"]))
                    || (kind == "setScope" && Set(action.keys) == Set(["kind", "scope"])
                        && (action["scope"] as? String).map({ ["project", "section"].contains($0) }) == true),
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["title", "status", "isSequential", "sequentialScope", "rev", "revBy", "updatedAt"]),
                  let title = expected["title"] as? String, title.utf16.count <= 100_000,
                  let status = expected["status"] as? String,
                  ["active", "someday", "waiting", "archived"].contains(status),
                  expected["isSequential"] is NSNull || Self.isBoolean(expected["isSequential"]),
                  Self.isProjectFlowScope(expected["sequentialScope"]),
                  expected["rev"] is NSNull || (Self.isInteger(expected["rev"]) && (expected["rev"] as? Int ?? -1) >= 0),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Project flow needs a bounded action, row token, and lowercase UUID")
            }
        }
        if method == "projectTaskSortOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["projectId"]),
                  let projectID = input["projectId"] as? String,
                  !projectID.isEmpty, projectID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Project task sort options need one bounded Project ID")
            }
        }
        if ["projectTaskSortWrite", "projectTaskSortRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "sortBy", "expected"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  Self.isProjectTaskSort(input["sortBy"], chosen: true),
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["title", "status", "taskSortBy", "rev", "revBy", "updatedAt"]),
                  let title = expected["title"] as? String, title.utf16.count <= 100_000,
                  let status = expected["status"] as? String,
                  ["active", "someday", "waiting", "archived"].contains(status),
                  Self.isProjectTaskSort(expected["taskSortBy"]),
                  expected["rev"] is NSNull || (Self.isInteger(expected["rev"])
                      && (expected["rev"] as? NSNumber).map({ $0.doubleValue >= 0 && $0.doubleValue <= 9_007_199_254_740_991 }) == true),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, !updated.isEmpty, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Project task sort needs a bounded choice, row token, and lowercase UUID")
            }
        }
        if ["projectTaskOrderWrite", "projectTaskOrderRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "projectId", "taskId", "after", "showCompleted", "filters", "expectedOrder"]),
                  let id = input["requestId"] as? String, id == UUID(uuidString: id)?.uuidString.lowercased(),
                  let projectID = input["projectId"] as? String, !projectID.isEmpty, projectID.utf16.count <= 500,
                  let taskID = input["taskId"] as? String, !taskID.isEmpty, taskID.utf16.count <= 500,
                  Self.isBoolean(input["showCompleted"]), input["filters"] is [String: Any],
                  let order = input["expectedOrder"] as? String, !order.isEmpty, order.utf8.count <= 2_000_000,
                  let token = try NativeJSON.jsonObject(with: Data(order.utf8)) as? [String: Any],
                  token["items"] is [[String: Any]],
                  input["after"] is NSNull || ((input["after"] as? [String: Any]).map({ after in
                      Set(after.keys) == Set(["type", "id"])
                        && ["task", "section"].contains(after["type"] as? String ?? "")
                        && (after["id"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500
                            && !$0.utf8.elementsEqual(taskID.utf8) }) == true
                  }) == true) else {
                throw HostFailure("INVALID_INPUT: Project task order needs a bounded token, typed anchor, and lowercase UUID")
            }
        }
        if ["appLockOptions", "appLock", "appLockRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 8_192,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any] else {
                throw HostFailure("INVALID_INPUT: App lock requires a bounded object")
            }
            if method == "appLockOptions" {
                guard input.isEmpty else { throw HostFailure("INVALID_INPUT: App lock options requires an empty object") }
            } else {
                guard Set(input.keys) == Set(["requestId", "value", "expected"]),
                      let id = input["requestId"] as? String, UUID(uuidString: id)?.uuidString.lowercased() == id,
                      Self.isBoolean(input["value"]), Self.validAppLockExpected(input["expected"]) else {
                    throw HostFailure("INVALID_INPUT: App lock requires a boolean, witness and lowercase UUID")
                }
            }
        }
        if ["gtdWorkflowOptions", "gtdReviewOptions", "gtdInboxOptions", "gtdCaptureAreaOptions", "gtdCaptureParseOptions", "gtdTaskEditorOpenOptions", "gtdTaskEditorPresetOptions", "gtdWorkflowDraft", "gtdWorkflow", "gtdWorkflowRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 8_192,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any] else {
                throw HostFailure("INVALID_INPUT: GTD workflow requires a bounded object")
            }
            if method == "gtdCaptureAreaOptions" {
                guard Set(input.keys).isSubset(of: Set(["offset", "limit", "revision"])),
                      Self.isInteger(input["offset"]), Self.isInteger(input["limit"]),
                      let offset = input["offset"] as? Int, offset >= 0, offset <= 9_007_199_254_740_991,
                      let limit = input["limit"] as? Int, (1...100).contains(limit),
                      input["revision"] == nil || (input["revision"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 100 }) == true,
                      offset == 0 || input["revision"] is String else { throw HostFailure("INVALID_INPUT: Invalid Capture default area page") }
            } else if ["gtdWorkflowOptions", "gtdReviewOptions", "gtdInboxOptions", "gtdCaptureParseOptions", "gtdTaskEditorOpenOptions", "gtdTaskEditorPresetOptions"].contains(method) {
                guard input.isEmpty else { throw HostFailure("INVALID_INPUT: GTD workflow options take an empty object") }
            } else if method == "gtdWorkflowDraft" {
                guard Set(input.keys) == Set(["value"]), (input["value"] as? String).map({ $0.utf16.count <= 50 }) == true else {
                    throw HostFailure("INVALID_INPUT: GTD schedule draft needs bounded text")
                }
            } else {
                guard Set(input.keys) == Set(["requestId", "edit", "expected"]),
                      let id = input["requestId"] as? String, UUID(uuidString: id)?.uuidString.lowercased() == id,
                      let edit = input["edit"] as? [String: Any], Self.validGtdWorkflowEdit(edit),
                      Self.validGtdWorkflowExpected(input["expected"], type: edit["type"] as? String ?? "") else {
                    throw HostFailure("INVALID_INPUT: GTD workflow requires a checked edit and lowercase UUID")
                }
            }
        }
        if method == "gtdArchiveOptions" {
            guard let encoded = args.first as? String, encoded.utf8.count <= 8_192,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any], input.isEmpty else {
                throw HostFailure("INVALID_INPUT: GTD Auto-archive options take an empty object")
            }
        }
        if ["generalPreferenceOptions", "generalPreference", "generalPreferenceRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 8_192,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any] else {
                throw HostFailure("INVALID_INPUT: General preference requires a bounded object")
            }
            if method == "generalPreferenceOptions" {
                guard input.isEmpty || Set(input.keys) == Set(["deviceTheme"])
                    && (input["deviceTheme"] is NSNull || (input["deviceTheme"] as? String).map { $0.utf16.count <= 500 } == true) else {
                    throw HostFailure("INVALID_INPUT: General preference options requires a bounded theme hint")
                }
            } else {
                guard Set(input.keys) == Set(["requestId", "edit", "expected"]),
                      let id = input["requestId"] as? String, UUID(uuidString: id)?.uuidString.lowercased() == id,
                      Self.validGeneralPreferenceEdit(input["edit"]), Self.validGeneralPreferenceExpected(input["expected"]) else {
                    throw HostFailure("INVALID_INPUT: General preference requires a checked edit and lowercase UUID")
                }
            }
        }
        if ["manageTaxonomyOptions", "manageTaxonomy", "manageTaxonomyRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == (method == "manageTaxonomyOptions" ? Set(["kind", "name"])
                    : Set(["requestId", "kind", "action", "name", "to", "expected"])),
                  let kind = input["kind"] as? String, ["context", "tag"].contains(kind),
                  let name = input["name"] as? String, !name.isEmpty, name.utf16.count <= 2_000_000 else {
                throw HostFailure("INVALID_INPUT: Taxonomy needs a bounded kind and name")
            }
            if method != "manageTaxonomyOptions" {
                guard let requestID = input["requestId"] as? String, UUID(uuidString: requestID)?.uuidString.lowercased() == requestID,
                      let action = input["action"] as? String, ["rename", "delete"].contains(action),
                      Self.validTaxonomyExpected(input["expected"], kind: kind),
                      action == "delete" ? input["to"] is NSNull
                        : (input["to"] as? String).map({ $0.utf16.count <= 2_000_000 }) == true else {
                    throw HostFailure("INVALID_INPUT: Taxonomy needs full carriers and a lowercase UUID")
                }
            }
        }
        if ["managePersonEditOptions", "managePersonEdit", "managePersonEditRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String,
                  encoded.utf8.count <= (method == "managePersonEditOptions" ? 4_096 : 2_000_000),
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == (method == "managePersonEditOptions" ? Set(["personId"]) : Set(["requestId", "personId", "expected", "name", "note", "referenceLink"])),
                  let personID = input["personId"] as? String, !personID.isEmpty, personID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Person edit needs a bounded person ID")
            }
            if method != "managePersonEditOptions" {
                guard let requestID = input["requestId"] as? String, UUID(uuidString: requestID)?.uuidString.lowercased() == requestID,
                      Self.isPersonDeleteExpected(input["expected"], personID: personID),
                      ["name", "note", "referenceLink"].allSatisfy({ (input[$0] as? String).map({ $0.utf16.count <= 2_000_000 }) == true }) else {
                    throw HostFailure("INVALID_INPUT: Person edit needs a live row and lowercase UUID")
                }
            }
        }
        if ["managePersonDeleteOptions", "managePersonDelete", "managePersonDeleteRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String,
                  encoded.utf8.count <= (method == "managePersonDeleteOptions" ? 4_096 : 2_000_000),
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == (method == "managePersonDeleteOptions" ? Set(["personId"]) : Set(["requestId", "personId", "expected"])),
                  let personID = input["personId"] as? String, !personID.isEmpty, personID.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Person deletion needs a bounded person ID")
            }
            if method != "managePersonDeleteOptions" {
                guard let requestID = input["requestId"] as? String, UUID(uuidString: requestID)?.uuidString.lowercased() == requestID,
                      Self.isPersonDeleteExpected(input["expected"], personID: personID) else {
                    throw HostFailure("INVALID_INPUT: Person deletion needs a live row and lowercase UUID")
                }
            }
        }
        if ["managePersonCreateResolve", "managePersonCreate", "managePersonCreateRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == (method == "managePersonCreateResolve"
                    ? Set(["requestId", "name"]) : Set(["requestId", "name", "note", "referenceLink", "expectedPersonId"])),
                  let id = input["requestId"] as? String, UUID(uuidString: id)?.uuidString.lowercased() == id,
                  let name = input["name"] as? String, name.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Person creation needs a bounded name and lowercase UUID")
            }
            if method != "managePersonCreateResolve" {
                guard let note = input["note"] as? String, note.utf16.count <= 10_000,
                      let reference = input["referenceLink"] as? String, reference.utf16.count <= 2_000,
                      let expected = input["expectedPersonId"] as? String, !expected.isEmpty, expected.utf16.count <= 500 else {
                    throw HostFailure("INVALID_INPUT: Person creation needs bounded note, reference and expected ID")
                }
            }
        }
        if ["areaCreateResolve", "areaCreate", "manageAreaCreate", "areaCreateRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == (method == "areaCreateResolve"
                    ? Set(["requestId", "name"]) : Set(["requestId", "name", "color", "expectedAreaId"])),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  input["name"] is String else {
                throw HostFailure("INVALID_INPUT: Area creation needs one bounded name and lowercase UUID")
            }
            if method != "areaCreateResolve" {
                guard input["color"] is String, let expected = input["expectedAreaId"] as? String,
                      !expected.isEmpty, expected.utf16.count <= 500 else {
                    throw HostFailure("INVALID_INPUT: Area creation needs color and expected ID")
                }
            }
        }
        if ["areaColor", "areaColorRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "areaId", "color", "expected"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let areaID = input["areaId"] as? String, !areaID.isEmpty, areaID.utf16.count <= 500,
                  input["color"] is NSNull || input["color"] is String,
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["name", "color", "rev", "revBy", "updatedAt"]),
                  let name = expected["name"] as? String, name.utf16.count <= 10_000,
                  expected["color"] is NSNull || (expected["color"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  expected["rev"] is NSNull || Self.isInteger(expected["rev"]),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Area color needs a bounded row token and lowercase UUID")
            }
        }
        if ["areaRename", "areaRenameRetryOutcome", "manageAreaEdit", "manageAreaEditRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == (["manageAreaEdit", "manageAreaEditRetryOutcome"].contains(method)
                    ? Set(["requestId", "areaId", "name", "expected", "manageColor"])
                    : Set(["requestId", "areaId", "name", "expected"])),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let areaID = input["areaId"] as? String, !areaID.isEmpty, areaID.utf16.count <= 500,
                  let name = input["name"] as? String, name.utf16.count <= 10_000,
                  !["manageAreaEdit", "manageAreaEditRetryOutcome"].contains(method)
                    || (input["manageColor"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true,
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["id", "name", "color", "order", "rev", "revBy", "updatedAt"]),
                  expected["id"] as? String == areaID,
                  let expectedName = expected["name"] as? String, expectedName.utf16.count <= 10_000,
                  expected["color"] is NSNull || (expected["color"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  Self.isFiniteNumber(expected["order"]),
                  expected["rev"] is NSNull || Self.isInteger(expected["rev"]),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Area rename needs a bounded name, row token, and lowercase UUID")
            }
        }
        if ["areaDelete", "areaDeleteRetryOutcome", "manageAreaDelete", "manageAreaDeleteRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == (method == "manageAreaDelete" || method == "manageAreaDeleteRetryOutcome"
                    ? Set(["requestId", "areaId", "expected", "detachProjects"])
                    : Set(["requestId", "areaId", "expected"])),
                  (method == "manageAreaDelete" || method == "manageAreaDeleteRetryOutcome"
                    ? Self.isBoolean(input["detachProjects"]) && input["detachProjects"] as? Bool == true
                    : true),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let areaID = input["areaId"] as? String, !areaID.isEmpty, areaID.utf16.count <= 500,
                  let expected = input["expected"] as? [String: Any],
                  Set(expected.keys) == Set(["name", "color", "order", "rev", "revBy", "updatedAt"]),
                  let name = expected["name"] as? String, name.utf16.count <= 10_000,
                  expected["color"] is NSNull || (expected["color"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  Self.isFiniteNumber(expected["order"]),
                  expected["rev"] is NSNull || Self.isInteger(expected["rev"]),
                  expected["revBy"] is NSNull || (expected["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true,
                  let updated = expected["updatedAt"] as? String, updated.utf16.count <= 100 else {
                throw HostFailure("INVALID_INPUT: Area deletion needs a bounded row token and lowercase UUID")
            }
        }
        if ["areaOrder", "areaOrderRetryOutcome"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "intent", "expectedAreas"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                  let intent = input["intent"] as? [String: Any],
                  let kind = intent["kind"] as? String,
                  (kind == "moveUp"
                    ? Set(intent.keys) == Set(["kind", "areaId"])
                        && (intent["areaId"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true
                    : ["sortName", "sortColor"].contains(kind) && Set(intent.keys) == Set(["kind"])),
                  let expected = input["expectedAreas"] as? [[String: Any]],
                  expected.allSatisfy({ row in
                      Set(row.keys) == Set(["id", "name", "color", "order", "rev", "revBy", "updatedAt"])
                          && (row["id"] as? String).map({ !$0.isEmpty && $0.utf16.count <= 500 }) == true
                          && (row["name"] as? String).map({ $0.utf16.count <= 10_000 }) == true
                          && (row["color"] is NSNull || (row["color"] as? String).map({ $0.utf16.count <= 500 }) == true)
                          && Self.isFiniteNumber(row["order"])
                          && (row["rev"] is NSNull || Self.isInteger(row["rev"]))
                          && (row["revBy"] is NSNull || (row["revBy"] as? String).map({ $0.utf16.count <= 500 }) == true)
                          && (row["updatedAt"] as? String).map({ $0.utf16.count <= 100 }) == true
                  }),
                  Set(expected.compactMap { $0["id"] as? String }).count == expected.count else {
                throw HostFailure("INVALID_INPUT: Area order needs a bounded complete token list and lowercase UUID")
            }
        }
        if method == "taskCancellationUndo" {
            guard let text = args.first as? String, text.utf8.count <= 4_096,
                  let request = try NativeJSON.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  Set(request.keys) == Set(["requestId", "cancelRequestId"]),
                  ["requestId", "cancelRequestId"].allSatisfy({ field in
                      guard let value = request[field] as? String else { return false }
                      return UUID(uuidString: value)?.uuidString.lowercased() == value
                  }), !Self.equalJSON(request["requestId"], request["cancelRequestId"]) else {
                throw HostFailure("INVALID_INPUT: Undo needs distinct request UUIDs")
            }
        }
        if method == "taskDelete" {
            guard let text = args.first as? String, text.utf8.count <= 4_096,
                  let request = try NativeJSON.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  Set(request.keys) == Set(["requestId", "taskId", "taskRevision"]),
                  let id = request["requestId"] as? String,
                  UUID(uuidString: id)?.uuidString.lowercased() == id,
                  let taskID = request["taskId"] as? String, !taskID.isEmpty, taskID.utf16.count <= 200,
                  let revision = request["taskRevision"] as? String, !revision.isEmpty, revision.utf16.count <= 200 else {
                throw HostFailure("INVALID_INPUT: Task Delete needs an exact saved revision and lowercase UUID")
            }
        }
        if method == "taskPromote" {
            guard let text = args.first as? String, text.utf8.count <= 2_000_000,
                  let request = try NativeJSON.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  Set(request.keys) == Set(["requestId", "taskId", "taskRevision", "title"]),
                  let requestID = request["requestId"] as? String,
                  UUID(uuidString: requestID)?.uuidString.lowercased() == requestID,
                  let taskID = request["taskId"] as? String, !taskID.isEmpty, taskID.utf16.count <= 500,
                  let revision = request["taskRevision"] as? String, !revision.isEmpty, revision.utf16.count <= 2_000,
                  let title = request["title"] as? String, title.utf16.count <= 100_000 else {
                throw HostFailure("INVALID_INPUT: Task promotion needs a title, exact saved revision and lowercase UUID")
            }
        }
        if method == "taskDeleteUndo" {
            guard let text = args.first as? String, text.utf8.count <= 4_096,
                  let request = try NativeJSON.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  Set(request.keys) == Set(["requestId", "deleteRequestId"]),
                  let id = request["requestId"] as? String,
                  UUID(uuidString: id)?.uuidString.lowercased() == id,
                  let deleted = request["deleteRequestId"] as? String,
                  UUID(uuidString: deleted)?.uuidString.lowercased() == deleted,
                  id != deleted else {
                throw HostFailure("INVALID_INPUT: Task Delete Undo needs distinct lowercase request UUIDs")
            }
        }
        if ["checklistEdit", "checklistSave", "checklistReset"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  let id = input["id"] as? String, !id.isEmpty, id.utf16.count <= 500 else {
                throw HostFailure("INVALID_INPUT: Checklist needs a bounded task ID and JSON object")
            }
            if method == "checklistEdit" {
                guard Set(input.keys) == Set(input["edit"] == nil ? ["id", "draft", "checklist"] : ["id", "draft", "checklist", "edit"]),
                      input["draft"] is [String: Any], input["checklist"] is [[String: Any]],
                      input["edit"] == nil || input["edit"] is [String: Any] else {
                    throw HostFailure("INVALID_INPUT: Checklist edit needs the complete draft and list")
                }
            } else {
                guard let requestID = input["requestId"] as? String, UUID(uuidString: requestID) != nil,
                      requestID == requestID.lowercased() else {
                    throw HostFailure("INVALID_INPUT: Checklist write needs a lowercase request UUID")
                }
                if method == "checklistReset" {
                    guard Set(input.keys) == Set(["id", "requestId", "checklistBase"]),
                          input["checklistBase"] is [[String: Any]] else {
                        throw HostFailure("INVALID_INPUT: Checklist reset needs the saved list baseline")
                    }
                } else {
                    guard Set(input.keys) == Set(["id", "requestId", "base", "patch", "scheduleBase", "checklist"]
                        + (input["recurrenceBase"] == nil ? [] : ["recurrenceBase"])
                        + (input["attachments"] == nil ? [] : ["attachments"])
                        + (input["intent"] == nil ? [] : ["intent"])),
                          input["intent"] == nil || ["cancel", "skip"].contains(input["intent"] as? String ?? ""),
                          let base = input["base"] as? [String: Any], let patch = input["patch"] as? [String: Any],
                          Set(base.keys) == Set(patch.keys),
                          input["attachments"] == nil || Self.validTaskAttachmentHalf(input["attachments"]),
                          let schedule = input["scheduleBase"] as? [String: Any], Set(schedule.keys) == Self.scheduleFields,
                          Self.isOffset(schedule["relativeStartOffset"]),
                          ["startTime", "dueDate", "reviewAt"].allSatisfy({ schedule[$0] is String || schedule[$0] is NSNull }),
                          let checklist = input["checklist"] as? [String: Any], Set(checklist.keys) == Set(["base", "value"]),
                          checklist["base"] is [[String: Any]], checklist["value"] is [[String: Any]] else {
                        throw HostFailure("INVALID_INPUT: Checklist save needs exact baselines and final list")
                    }
                    let allowed = Set(["title", "description", "location", "assignedTo", "priority", "energyLevel", "timeEstimate", "timeSpentMinutes", "projectId", "areaId", "sectionId", "contexts", "tags", "status", "focusedToday", "completedAt"])
                        .union(Self.scheduleFields).union(Self.recurrenceFields)
                    guard Set(patch.keys).isSubset(of: allowed), patch.keys.allSatisfy({ field in
                        if field == "relativeStartOffset" { return Self.isOffset(base[field]) && Self.isOffset(patch[field]) }
                        if field == "showFutureRecurrence" || field == "focusedToday" { return Self.isBoolean(base[field]) && Self.isBoolean(patch[field]) }
                        if field == "timeSpentMinutes" { return Self.isTimeSpent(base[field]) && Self.isTimeSpent(patch[field]) }
                        return base[field] is String && patch[field] is String
                    }) else { throw HostFailure("INVALID_INPUT: Checklist save contains unsupported draft fields") }
                    let hasRecurrence = !Self.recurrenceFields.isDisjoint(with: patch.keys)
                    guard (input["recurrenceBase"] != nil) == hasRecurrence else {
                        throw HostFailure("INVALID_INPUT: Checklist recurrence baseline is missing or unrequested")
                    }
                    if hasRecurrence {
                        guard Self.recurrenceFields.isSubset(of: Set(patch.keys)),
                              let recurrence = input["recurrenceBase"] as? [String: Any],
                              Set(recurrence.keys) == Set(["recurrence", "showFutureRecurrence"]),
                              recurrence["recurrence"] is NSNull || recurrence["recurrence"] is String || recurrence["recurrence"] is [String: Any],
                              recurrence["showFutureRecurrence"] is NSNull || Self.isBoolean(recurrence["showFutureRecurrence"]) else {
                            throw HostFailure("INVALID_INPUT: Checklist recurrence needs its complete raw baseline")
                        }
                    }
                    let associations: Set<String> = ["projectId", "areaId", "sectionId"]
                    if !associations.isDisjoint(with: patch.keys) && !associations.isSubset(of: Set(patch.keys)) {
                        throw HostFailure("INVALID_INPUT: Checklist destination needs every association field")
                    }
                }
            }
        }
        if ["mindSweepGuide", "mindSweepAdd"].contains(method) {
            guard let json = args.first as? String, json.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
                throw HostFailure("INVALID_INPUT: Mind Sweep needs a bounded JSON object")
            }
            if method == "mindSweepGuide" {
                guard Set(input.keys) == Set(["scope"]),
                      let scope = input["scope"] as? String, ["all", "personal", "work"].contains(scope) else {
                    throw HostFailure("INVALID_INPUT: Unsupported Mind Sweep scope")
                }
            } else {
                guard Set(input.keys) == Set(["requestId", "title"]),
                      let id = input["requestId"] as? String, UUID(uuidString: id) != nil, id == id.lowercased(),
                      input["title"] is String else {
                    throw HostFailure("INVALID_INPUT: Mind Sweep needs a literal title and lowercase UUID")
                }
            }
        }
        if ["calendarUnschedule", "calendarDelete"].contains(method) {
            guard let encoded = args.first as? String, encoded.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "taskId", "taskRevision"]),
                  let id = input["requestId"] as? String, UUID(uuidString: id) != nil,
                  let taskID = input["taskId"] as? String, !taskID.isEmpty, taskID.utf16.count <= 200,
                  let revision = input["taskRevision"] as? String, !revision.isEmpty, revision.utf16.count <= 200 else {
                throw HostFailure("INVALID_INPUT: Calendar action needs a task and revision")
            }
        }
        if ["calendarComposerOpen", "calendarComposerEdit", "calendarComposerSave"].contains(method) {
            guard let json = args.first as? String, json.utf8.count <= 2_000_000,
                  let input = try NativeJSON.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
                throw HostFailure("INVALID_INPUT: Native Calendar composer requires a bounded JSON object")
            }
            let fields: Set<String> = method == "calendarComposerOpen" ? ["at", "day", "rawMinutes", "scheduleTaskId", "mode", "calendar"]
                : method == "calendarComposerEdit" ? ["composer", "edit", "calendar"] : ["requestId", "composer", "calendar"]
            guard Set(input.keys).isSubset(of: fields),
                  (method != "calendarComposerOpen" || input["rawMinutes"] == nil || (
                    Self.isFiniteNumber(input["rawMinutes"]) && input["day"] is String
                    && input["mode"] as? String == "new" && input["at"] == nil && input["scheduleTaskId"] == nil)),
                  (method != "calendarComposerEdit" || (input["composer"] is [String: Any] && input["edit"] is [String: Any])),
                  (method != "calendarComposerSave" || (input["composer"] is [String: Any]
                    && ["existing", "new"].contains((input["composer"] as? [String: Any])?["mode"] as? String ?? "")
                    && (input["requestId"] as? String).flatMap({ UUID(uuidString: $0) }) != nil)) else {
                throw HostFailure("INVALID_INPUT: Unsupported native Calendar composer input")
            }
        }
        if method == "boardAction" {
            guard let json = args.first as? String, json.utf8.count <= 4_096,
                  let input = try NativeJSON.jsonObject(with: Data(json.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "action"]), let id = input["requestId"] as? String, UUID(uuidString: id) != nil,
                  let action = input["action"] as? [String: Any], Set(action.keys) == Set(["type", "taskId"]),
                  let type = action["type"] as? String, ["duplicateTask", "trashTask"].contains(type),
                  let taskID = action["taskId"] as? String, !taskID.isEmpty, taskID.count <= 500 else {
                throw HostFailure("Unsupported native Board action")
            }
        }
        if method == "menuRead" {
            guard let name = args[0] as? String, ["more", "savedSearch", "projects", "projectDetailView", "projectTaskOrderView", "projectDetailFilterView", "projectDetailFilterOptions", "waiting", "someday", "reference", "history", "done", "archive", "archiveTokens", "trash", "contexts", "focus", "focusSection", "focusControls", "collection", "reviewOverview", "dailyReview", "weeklyReview", "weeklyReviewList", "calendar", "calendarItem", "calendarPreferences", "board", "boardList", "settingsMenu", "generalSettings", "manageSettings", "manageAreas", "managePeople", "manageContexts", "manageTags", "managePersonCreateCheck", "manageTaxonomyCheck", "managePersonEditCheck", "somedaySections"].contains(name),
                  let json = args[1] as? String,
                  let input = try NativeJSON.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
                throw HostFailure("Unsupported native menu read or JSON object input")
            }
            if name == "savedSearch" {
                guard json.utf8.count <= 2_000_000,
                      Set(input.keys).isSubset(of: ["id", "offset", "limit", "revision"]),
                      let id = input["id"] as? String, !id.isEmpty, id.utf16.count <= 200,
                      (input["offset"] == nil || Self.isInteger(input["offset"]) && (0...9_007_199_254_740_991).contains((input["offset"] as? NSNumber)?.doubleValue ?? -1)),
                      (input["limit"] == nil || Self.isInteger(input["limit"]) && (1...100).contains((input["limit"] as? NSNumber)?.intValue ?? 0)),
                      (input["revision"] == nil || input["revision"] is String) else {
                    throw HostFailure("INVALID_INPUT: Unsupported native saved search input")
                }
            }
            if name == "generalSettings" {
                guard input.isEmpty, json.utf8.count <= 4_096 else { throw HostFailure("Unsupported native General Settings input") }
            }
            if name == "settingsMenu" {
                guard json.utf8.count <= 2_000_000,
                      Set(input.keys).isSubset(of: ["query", "syncBadge", "updateAvailable"]),
                      (input["query"] == nil || (input["query"] as? String).map({ $0.utf16.count <= 500 && !$0.contains("\0") }) == true),
                      (input["syncBadge"] == nil || ["hidden", "syncing", "healthy", "attention"].contains(input["syncBadge"] as? String ?? "")),
                      (input["updateAvailable"] == nil || Self.isBoolean(input["updateAvailable"])) else {
                    throw HostFailure("Unsupported native Settings menu input")
                }
            }
            if name == "manageSettings" {
                guard json.utf8.count <= 2_000_000, Set(input.keys).isSubset(of: ["openSections"]),
                      (input["openSections"] == nil || input["openSections"] is NSNull
                        || (input["openSections"] as? String).map({ $0.utf16.count <= 2_000 && !$0.contains("\0") }) == true) else {
                    throw HostFailure("Unsupported native Manage Settings input")
                }
            }
            if name == "manageTaxonomyCheck" {
                guard json.utf8.count <= 2_000_000, Set(input.keys) == Set(["kind", "name"]),
                      ["context", "tag"].contains(input["kind"] as? String ?? ""), input["name"] is String else {
                    throw HostFailure("INVALID_INPUT: Unsupported native taxonomy check")
                }
            }
            if name == "managePersonEditCheck" {
                guard json.utf8.count <= 2_000_000, Set(input.keys) == Set(["name"]), input["name"] is String else {
                    throw HostFailure("INVALID_INPUT: Unsupported native Person edit check")
                }
            }
            if name == "managePersonCreateCheck" {
                guard json.utf8.count <= 4_096, Set(input.keys) == Set(["name"]),
                      let value = input["name"] as? String, value.utf16.count <= 500 else {
                    throw HostFailure("INVALID_INPUT: Unsupported native Person name check")
                }
            }
            if ["manageAreas", "managePeople", "manageContexts", "manageTags"].contains(name) {
                guard json.utf8.count <= 4_096, Set(input.keys) == Set(["offset", "limit", "revision"]),
                      Self.isInteger(input["offset"]), Self.isInteger(input["limit"]),
                      let offset = input["offset"] as? NSNumber, (0...9_007_199_254_740_991).contains(offset.doubleValue),
                      let limit = input["limit"] as? NSNumber, (1...100).contains(limit.doubleValue),
                      let revision = input["revision"] as? String, revision.utf8.count <= 500 else {
                    throw HostFailure("Unsupported native Manage \(name.dropFirst(6)) page")
                }
            }
            if name == "somedaySections" {
                guard json.utf8.count <= 1_048_576,
                      Set(input.keys) == Set(input["revision"] == nil ? ["offset", "limit"] : ["offset", "limit", "revision"]),
                      Self.isInteger(input["offset"]), Self.isInteger(input["limit"]),
                      let offset = input["offset"] as? NSNumber, (0...9_007_199_254_740_991).contains(offset.doubleValue),
                      let limit = input["limit"] as? NSNumber, (1...100).contains(limit.doubleValue),
                      (input["revision"] == nil || input["revision"] is String),
                      (offset.doubleValue == 0 || input["revision"] is String) else {
                    throw HostFailure("Unsupported native Someday sections page")
                }
            }
            if name == "projects" {
                guard Set(input.keys) == Set(["tagFilter"]), let filter = input["tagFilter"] as? String,
                      filter.utf16.count <= 100_000 else {
                    throw HostFailure("Unsupported native Projects tag filter")
                }
            }
            if name == "projectDetailView" {
                let required: Set<String> = ["projectId", "offset", "limit", "showCompleted", "completedCollapsed"]
                guard json.utf8.count <= 1_048_576,
                      required.isSubset(of: Set(input.keys)), Set(input.keys).isSubset(of: required.union(["revision"])),
                      let id = input["projectId"] as? String, !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      id.utf16.count <= 500, Self.isInteger(input["offset"]), Self.isInteger(input["limit"]),
                      let offset = input["offset"] as? NSNumber, (0...9_007_199_254_740_991).contains(offset.doubleValue),
                      let limit = input["limit"] as? NSNumber, (1...100).contains(limit.doubleValue),
                      Self.isBoolean(input["showCompleted"]), Self.isBoolean(input["completedCollapsed"]),
                      (input["revision"] == nil || input["revision"] is String),
                      (offset.doubleValue == 0 || input["revision"] is String) else {
                    throw HostFailure("Unsupported native Project detail view input")
                }
            }
            if name == "projectTaskOrderView" {
                let required: Set<String> = ["projectId", "offset", "limit", "showCompleted", "filters"]
                guard json.utf8.count <= 2_000_000,
                      required.isSubset(of: Set(input.keys)), Set(input.keys).isSubset(of: required.union(["revision"])),
                      let id = input["projectId"] as? String, !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      id.utf16.count <= 500, Self.isInteger(input["offset"]), Self.isInteger(input["limit"]),
                      let offset = input["offset"] as? NSNumber, (0...9_007_199_254_740_991).contains(offset.doubleValue),
                      let limit = input["limit"] as? NSNumber, (1...100).contains(limit.doubleValue),
                      Self.isBoolean(input["showCompleted"]), input["filters"] is [String: Any],
                      input["revision"] == nil || input["revision"] is String,
                      offset.doubleValue == 0 || input["revision"] is String else {
                    throw HostFailure("Unsupported native Project task order input")
                }
            }
            if ["projectDetailFilterView", "projectDetailFilterOptions"].contains(name) {
                let picker = name == "projectDetailFilterOptions"
                let required: Set<String> = ["projectId", "offset", "limit", "showCompleted", "completedCollapsed", "filters"]
                let requiredFields = picker ? required.union(["picker", "query"]) : required
                let allowed = requiredFields.union(picker ? ["revision"] : ["revision", "filterEdit", "filterSheetOpen"])
                guard json.utf8.count <= 2_000_000,
                      requiredFields.isSubset(of: Set(input.keys)), Set(input.keys).isSubset(of: allowed),
                      let id = input["projectId"] as? String, !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      id.utf16.count <= 500, Self.isInteger(input["offset"]), Self.isInteger(input["limit"]),
                      let offset = input["offset"] as? NSNumber, (0...9_007_199_254_740_991).contains(offset.doubleValue),
                      let limit = input["limit"] as? NSNumber, (1...100).contains(limit.doubleValue),
                      Self.isBoolean(input["showCompleted"]), Self.isBoolean(input["completedCollapsed"]),
                      input["filters"] is [String: Any],
                      input["revision"] == nil || input["revision"] is String,
                      offset.doubleValue == 0 || input["revision"] is String,
                      input["filterEdit"] == nil || input["filterEdit"] is [String: Any],
                      input["filterSheetOpen"] == nil || Self.isBoolean(input["filterSheetOpen"]) else {
                    throw HostFailure("Unsupported native Project task filter input")
                }
                if picker {
                    guard input["picker"] as? String == "tokens", let query = input["query"] as? String,
                          query.utf16.count <= 500 else {
                        throw HostFailure("Unsupported native Project task filter picker")
                    }
                }
            }
            if name == "contexts" {
                let fields = Set(["tokens", "matchMode", "searchQuery", "offset", "limit", "revision"])
                guard Set(input.keys).isSubset(of: fields) else {
                    throw HostFailure("Unsupported native Contexts browsing input")
                }
            }
            let focusFields: [String: Set<String>] = [
                "focus": ["limit", "controls", "controlEdit"],
                "focusSection": ["key", "offset", "limit", "revision", "controls"],
                "focusControls": ["list", "offset", "limit", "revision", "controls", "query"],
            ]
            if let fields = focusFields[name] {
                guard input["controls"] is [String: Any], Set(input.keys).isSubset(of: fields) else {
                    throw HostFailure("Unsupported native Focus read or missing controls object")
                }
            }
            let reviewFields: [String: Set<String>] = [
                "reviewOverview": ["scope", "expandedAreaIds", "expandedProjectIds", "expansionEdit", "offset", "limit", "revision"],
                "dailyReview": ["checkpoint", "offset", "limit", "revision"],
                "weeklyReview": ["checkpoint", "expandedProjectId", "offset", "limit", "revision"],
                "weeklyReviewList": ["checkpoint", "expandedProjectId", "list", "key", "offset", "limit", "revision"],
            ]
            if let fields = reviewFields[name], !Set(input.keys).isSubset(of: fields) {
                throw HostFailure("Unsupported native Review browsing input")
            }
            let calendarFields: [String: Set<String>] = [
                "calendar": ["state", "scheduleQuery", "offset", "limit", "revision"],
                "calendarItem": ["taskId", "state"],
                "calendarPreferences": [],
            ]
            if let fields = calendarFields[name], !Set(input.keys).isSubset(of: fields) {
                throw HostFailure("Unsupported native Calendar browsing input")
            }
            if name == "board" || name == "boardList" {
                let fields: Set<String> = name == "board" ? ["filters", "filterEdit", "limit"]
                    : ["filters", "list", "status", "query", "offset", "limit", "revision"]
                guard json.utf8.count <= 1_048_576, Set(input.keys).isSubset(of: fields),
                      Self.isInteger(input["limit"]), let limit = input["limit"] as? NSNumber,
                      (1.0...100.0).contains(limit.doubleValue) else {
                    throw HostFailure("Unsupported native Board browsing input")
                }
                if let value = input["filters"] {
                    let filterFields: Set<String> = ["searchQuery", "tokens", "excludedTokens", "projects", "contextMatchMode", "tagMatchMode", "duePreset"]
                    guard let filters = value as? [String: Any], Set(filters.keys).isSubset(of: filterFields) else {
                        throw HostFailure("Unsupported native Board filters")
                    }
                    for (field, value) in filters {
                        if ["tokens", "excludedTokens", "projects"].contains(field) {
                            guard let values = value as? [String], values.count <= 100,
                                  values.allSatisfy({ $0.utf16.count <= 500 }) else { throw HostFailure("Unsupported native Board filters") }
                        } else if field != "duePreset" || !(value is NSNull) {
                            guard let text = value as? String, text.utf16.count <= (field == "searchQuery" ? 2000 : 500) else {
                                throw HostFailure("Unsupported native Board filters")
                            }
                        }
                    }
                }
                if let value = input["filterEdit"] {
                    guard let edit = value as? [String: Any], edit["type"] is String,
                          Set(edit.keys).isSubset(of: ["type", "value", "kind", "preset"]),
                          edit.values.allSatisfy({ ($0 as? String).map { $0.utf16.count <= 2000 } == true }) else {
                        throw HostFailure("Unsupported native Board filter edit")
                    }
                }
                if name == "boardList" {
                    guard let list = input["list"] as? String, list.utf16.count <= 500,
                          let revision = input["revision"] as? String, revision.utf16.count <= 4096,
                          Self.isInteger(input["offset"]), let offset = input["offset"] as? NSNumber,
                          (0.0...9_007_199_254_740_991.0).contains(offset.doubleValue),
                          input["status"] == nil || (input["status"] as? String).map({ $0.utf16.count <= 500 }) == true,
                          list != "cards" || input["status"] is String else {
                        throw HostFailure("Unsupported native Board list input")
                    }
                    if let query = input["query"] {
                        guard ["tokens", "projects"].contains(list), let text = query as? String,
                              text.utf16.count <= 500 else { throw HostFailure("Unsupported native Board picker query") }
                    }
                }
            }
            if name == "collection" {
                let collections = ["more": ["savedSearches"], "waiting": ["people", "deferredProjects"],
                                   "someday": ["tokens", "projects", "sections", "deferredProjects"],
                                   "reference": ["tokens", "projects"], "done": ["tokens"]]
                guard let view = input["view"] as? String, let collection = input["collection"] as? String,
                      collections[view]?.contains(collection) == true else {
                    throw HostFailure("Unsupported native menu collection")
                }
                if view == "more" {
                    guard json.utf8.count <= 2_000_000,
                          Set(input.keys) == Set(["view", "collection", "offset", "limit", "revision"]),
                          Self.isInteger(input["offset"]), Self.isInteger(input["limit"]),
                          (0...9_007_199_254_740_991).contains((input["offset"] as? NSNumber)?.doubleValue ?? -1),
                          (1...100).contains((input["limit"] as? NSNumber)?.intValue ?? 0),
                          input["revision"] is String else { throw HostFailure("INVALID_INPUT: Unsupported saved search Menu page") }
                }
            }
        }
        if method == "calendarPreference" {
            // Types and the static request envelope are checked before journaling
            // and again before startup replay. Core owns option/range/conflict policy.
            guard let json = args.first as? String,
                  let input = try NativeJSON.jsonObject(with: Data(json.utf8)) as? [String: Any],
                  Set(input.keys) == Set(["requestId", "field", "before", "value"]),
                  let requestID = input["requestId"] as? String, UUID(uuidString: requestID) != nil,
                  let field = input["field"] as? String else {
                throw HostFailure("INVALID_INPUT: Native Calendar preference requires an exact request object and UUID")
            }
            let valid: Bool
            switch field {
            case "viewMode": valid = input["before"] is String && input["value"] is String
            case "showCompleted": valid = Self.isBoolean(input["before"]) && Self.isBoolean(input["value"])
            case "weekVisibleDays": valid = Self.isInteger(input["before"]) && Self.isInteger(input["value"])
            default: valid = false
            }
            guard valid else { throw HostFailure("INVALID_INPUT: Unsupported native Calendar preference field or value type") }
        }
        if method == "saveDraft" {
            // Deliberate draft-field subset. Validate again on journal replay;
            // dates/recurrence additionally require their original raw tuples and
            // enter only the prepared commit journal path.
            guard let json = args.first as? String,
                  let input = try NativeJSON.jsonObject(with: Data(json.utf8)) as? [String: Any],
                  input["attachments"] == nil || json.utf8.count <= 2_000_000,
                  input["id"] is String,
                  let base = input["base"] as? [String: Any], let patch = input["patch"] as? [String: Any],
                  (!patch.isEmpty || input["attachments"] != nil), Set(base.keys) == Set(patch.keys) else {
                throw HostFailure("INVALID_INPUT: Native editor requires matching supported draft fields")
            }
            let hasSchedule = !Self.scheduleFields.isDisjoint(with: patch.keys)
            let hasRecurrence = !Self.recurrenceFields.isDisjoint(with: patch.keys)
            let isPrepared = hasSchedule || hasRecurrence || input["scheduleBase"] != nil
            let allowed = Set(["title", "description", "priority", "energyLevel", "timeEstimate", "projectId", "areaId", "sectionId", "contexts", "tags"])
                .union(allowPreparedDates && isPrepared ? ["location", "assignedTo", "timeSpentMinutes"] : [])
                .union(allowPreparedDates ? Self.scheduleFields.union(Self.recurrenceFields) : [])
            var inputFields: Set<String> = ["id", "base", "patch"]
            if isPrepared && allowPreparedDates { inputFields.insert("scheduleBase") }
            if hasRecurrence && allowPreparedDates { inputFields.insert("recurrenceBase") }
            if input["attachments"] != nil && allowPreparedDates { inputFields.insert("attachments") }
            guard Set(patch.keys).isSubset(of: allowed),
                  Set(input.keys) == inputFields,
                  input["attachments"] == nil || (allowPreparedDates && Self.validTaskAttachmentHalf(input["attachments"])),
                  patch.keys.allSatisfy({ field in
                      if field == "relativeStartOffset" { return Self.isOffset(base[field]) && Self.isOffset(patch[field]) }
                      if field == "showFutureRecurrence" { return Self.isBoolean(base[field]) && Self.isBoolean(patch[field]) }
                      if field == "timeSpentMinutes" { return Self.isTimeSpent(base[field]) && Self.isTimeSpent(patch[field]) }
                      return base[field] is String && patch[field] is String
                  }) else { throw HostFailure("INVALID_INPUT: Native editor requires matching supported draft fields") }
            if isPrepared {
                guard allowPreparedDates, let schedule = input["scheduleBase"] as? [String: Any], Set(schedule.keys) == Self.scheduleFields,
                      Self.isOffset(schedule["relativeStartOffset"]),
                      ["startTime", "dueDate", "reviewAt"].allSatisfy({ schedule[$0] is String || schedule[$0] is NSNull }) else {
                    throw HostFailure("INVALID_INPUT: Native schedule save requires a complete raw schedule baseline")
                }
            }
            if hasRecurrence {
                guard Self.recurrenceFields.isSubset(of: Set(patch.keys)),
                      let recurrence = input["recurrenceBase"] as? [String: Any],
                      Set(recurrence.keys) == Set(["recurrence", "showFutureRecurrence"]),
                      recurrence["recurrence"] is NSNull || recurrence["recurrence"] is String || recurrence["recurrence"] is [String: Any],
                      recurrence["showFutureRecurrence"] is NSNull || Self.isBoolean(recurrence["showFutureRecurrence"]) else {
                    throw HostFailure("INVALID_INPUT: Native recurrence save requires its complete draft tuple and raw baseline")
                }
            }
            // A move can clear its section/area. Guard unchanged companions too,
            // so an intervening writer's assignment cannot be silently cleared.
            let associations: Set<String> = ["projectId", "areaId", "sectionId"]
            if !associations.isDisjoint(with: patch.keys) {
                let complete = associations.isSubset(of: Set(patch.keys))
                NSLog("Native iOS destination guard releaseCheck=v1.3.3/native-ios-destination-guard outcome=%@", complete ? "validated" : "rejected")
                guard complete else {
                    throw HostFailure("INVALID_INPUT: Native destination save requires all association fields")
                }
            }
        }
        return args
    }

    private func persist(_ command: PendingCommand) throws {
        #if DEBUG
        try faults?.journalWrite?()
        #endif
        try DurableFile.write(JSONEncoder().encode(command), to: journalURL)
    }

    private func clearPending() throws {
        #if DEBUG
        try faults?.journalRemove?()
        #endif
        try DurableFile.remove(journalURL)
        pending = nil
    }

    private func invoke(_ method: String, arguments: [Any]) throws -> String {
        guard let context, let host = context.objectForKeyedSubscript("MindwtrHost") else { throw HostFailure("Core runtime unavailable") }
        context.exception = nil
        let ticket = host.invokeMethod(method, withArguments: arguments)
        try checkException()
        guard let ticket, ticket.isString, let id = ticket.toString(), Int(id).map({ $0 > 0 }) == true else {
            throw HostFailure("Malformed core request ticket")
        }
        // No timeout abandons a command while its durable result is unknown.
        // Promise jobs drain whenever JSC returns from a call; timers share this queue.
        while true {
            _ = context.objectForKeyedSubscript("__pumpTimers")?.call(withArguments: [])
            try checkException()
            let reply = host.invokeMethod("poll", withArguments: [id])
            try checkException()
            if let reply, !reply.isNull, !reply.isUndefined {
                guard reply.isString, let json = reply.toString(),
                      let envelope = try NativeJSON.jsonObject(with: Data(json.utf8)) as? [String: Any],
                      let ok = envelope["ok"] as? Bool else { throw HostFailure("Malformed core response") }
                if !ok { throw HostFailure(envelope["error"] as? String ?? "Core command failed") }
                guard let value = envelope["value"] else { throw HostFailure("Core response has no value") }
                return String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]), as: UTF8.self)
            }
            let delay = context.objectForKeyedSubscript("__nextTimerDelay")?.call(withArguments: [])?.toDouble() ?? 1
            try checkException()
            Thread.sleep(forTimeInterval: delay.isFinite && delay > 0 ? min(delay, 10) / 1_000 : 0.001)
        }
    }

    private func checkException() throws {
        if let exception = context?.exception {
            let message = exception.toString() ?? "JavaScriptCore exception"
            context?.exception = nil
            throw HostFailure(message)
        }
    }

    private func installBridge(_ context: JSContext) {
        let run: @convention(block) (String, String) -> String? = { [weak self] sql, parameters in
            guard let self else { return "!MindwtrNativeError:Native database unavailable" }
            return self.guarded { _ = try self.requireDatabase().execute(sql, parametersJSON: parameters); return nil }
        }
        let all: @convention(block) (String, String) -> String = { [weak self] sql, parameters in
            guard let self else { return "!MindwtrNativeError:Native database unavailable" }
            return self.guarded { try self.requireDatabase().execute(sql, parametersJSON: parameters) } ?? "[]"
        }
        let exec: @convention(block) (String) -> String? = { [weak self] sql in
            guard let self else { return "!MindwtrNativeError:Native database unavailable" }
            return self.guarded { _ = try self.requireDatabase().execute(sql); return nil }
        }
        let now: @convention(block) () -> Double = { ProcessInfo.processInfo.systemUptime * 1_000 }
        let random: @convention(block) (Int) -> String = { length in
            guard (0...65_536).contains(length) else { return "!MindwtrNativeError:Invalid random byte count" }
            if length == 0 { return "[]" }
            var bytes = [UInt8](repeating: 0, count: length)
            let result = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, length, $0.baseAddress!) }
            guard result == errSecSuccess else { return "!MindwtrNativeError:Secure random failed" }
            return String(decoding: (try? JSONEncoder().encode(bytes)) ?? Data(), as: UTF8.self)
        }
        let rnState: @convention(block) (String) -> String? = { [weak self] change in
            guard let self, let legacy = self.legacyStorage else {
                return "!MindwtrNativeError:Legacy app storage is unavailable in the foundation"
            }
            return self.guarded {
                try legacy.commit(changeJSON: change, checkpointURL: self.databaseURL.appendingPathExtension("rn-state.prewrite"))
                return nil
            }
        }
        let log: @convention(block) (String) -> Void = { [weak self] line in
            // Accept only the fixed, field-allowlisted release check. Generic JS
            // console output can contain task content and must not leave the host.
            guard let at = line.firstIndex(of: "{"),
                  let payload = try? NativeJSON.jsonObject(with: Data(line[at...].utf8)) as? [String: Any] else { return }
            if payload["scope"] as? String == "native-host",
               let encoded = payload["context"] as? String,
               let context = try? NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [String: Any] {
                if context["releaseCheck"] as? String == "v1.3.3/native-readonly-completion" {
                    #if DEBUG
                    self?.faults?.commandDiagnostic?("readOnlyCompletion")
                    #endif
                    NSLog("Native completion refused for a read-only project releaseCheck=v1.3.3/native-readonly-completion")
                } else if context["releaseCheck"] as? String == "v1.3.3/native-token-replay",
                          context["outcome"] as? String == "matched" {
                    #if DEBUG
                    self?.faults?.commandDiagnostic?("tokenReplay")
                    #endif
                    NSLog("Native canonical token retry matched releaseCheck=v1.3.3/native-token-replay outcome=matched")
                } else if context["releaseCheck"] as? String == "v1.3.3/native-prepared-date-save",
                          let outcome = context["outcome"] as? String, ["applied", "replayed"].contains(outcome) {
                    #if DEBUG
                    self?.faults?.commandDiagnostic?("dateSave")
                    #endif
                    NSLog("Native prepared date save releaseCheck=v1.3.3/native-prepared-date-save outcome=%@", outcome)
                } else if context["releaseCheck"] as? String == "v1.3.3/native-prepared-recurrence-save",
                          let outcome = context["outcome"] as? String, ["applied", "replayed"].contains(outcome) {
                    #if DEBUG
                    self?.faults?.commandDiagnostic?("recurrenceSave:" + outcome)
                    #endif
                    NSLog("Native prepared recurrence save releaseCheck=v1.3.3/native-prepared-recurrence-save outcome=%@", outcome)
                } else if context["releaseCheck"] as? String == "v1.3.3/native-calendar-preference",
                          let outcome = context["outcome"] as? String, ["applied", "replayed"].contains(outcome) {
                    #if DEBUG
                    self?.faults?.commandDiagnostic?("calendarPreference:" + outcome)
                    #endif
                    NSLog("Native Calendar preference releaseCheck=v1.3.3/native-calendar-preference outcome=%@", outcome)
                }
                return
            }
            // The shared host puts its fields in core's `context` (the part the Android log file keeps); older bundles used `extra`.
            guard payload["scope"] as? String == "native-ios",
                  let encodedExtra = (payload["context"] ?? payload["extra"]) as? String,
                  let extra = try? NativeJSON.jsonObject(with: Data(encodedExtra.utf8)) as? [String: Any] else { return }
            if extra["releaseCheck"] as? String == "v1.3.3/native-ios-legacy-json-import" {
                guard let outcome = extra["outcome"] as? String, ["imported", "abandoned", "none"].contains(outcome),
                      let rnState = extra["rnState"] as? String, ["updated", "unchanged", "failed"].contains(rnState) else { return }
                NSLog("Native iOS legacy JSON import releaseCheck=v1.3.3/native-ios-legacy-json-import outcome=%@ rnState=%@", outcome, rnState)
                return
            }
            guard extra["releaseCheck"] as? String == "v1.3.3/native-ios-dev-task-command",
                  let operation = extra["operation"] as? String, ["quickCapture", "complete", "areaFilter", "saveTaskDraft"].contains(operation),
                  let outcome = extra["outcome"] as? String, ["saved", "failed"].contains(outcome) else { return }
            #if DEBUG
            self?.faults?.commandDiagnostic?(operation)
            #endif
            NSLog("Native iOS task command releaseCheck=v1.3.3/native-ios-dev-task-command operation=%@ outcome=%@", operation, outcome)
        }
        let bridge = JSValue(newObjectIn: context)!
        for (name, block) in ["sqlRun": run as Any, "sqlAll": all as Any, "sqlExec": exec as Any,
                              "nowMs": now as Any, "randomBytes": random as Any, "rnStateCommit": rnState as Any, "log": log as Any] {
            bridge.setObject(block, forKeyedSubscript: name as NSString)
        }
        context.setObject(bridge, forKeyedSubscript: "__mindwtrNative" as NSString)
    }

    private func requireDatabase() throws -> SQLiteBridge {
        guard let database else { throw HostFailure("Native database unavailable") }
        return database
    }

    private func guarded(_ work: () throws -> String?) -> String? {
        do { return try work() }
        catch { return "!MindwtrNativeError:" + error.localizedDescription }
    }

    func shutdown() {
        dispatchPrecondition(condition: .onQueue(queue))
        closed = true
        releaseRuntime()
    }

    private func releaseRuntime() {
        started = false
        recoveryActivationPending = false
        startupBoardResult = nil
        startupCalendarResult = nil
        startupMindSweepResult = nil
        startupInboxResult = nil
        startupChecklistResult = nil
        startupFocusGroupResult = nil
        context = nil
        database?.close()
        database = nil
        if lockFD >= 0 { flock(lockFD, LOCK_UN); Darwin.close(lockFD); lockFD = -1 }
    }
}
