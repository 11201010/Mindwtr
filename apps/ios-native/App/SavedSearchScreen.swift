import SwiftUI

struct SavedSearchScreen: View {
    @ObservedObject var model: CoreModel
    let palette: AppPalette
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(spacing: 0) {
            if !model.savedSearch.text("query").isEmpty {
                Text(model.savedSearch.text("query"))
                    .rnFont(12).foregroundStyle(palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .background(palette.card)
                    .overlay(alignment: .bottom) { palette.border.frame(height: 1) }
                    .accessibilityIdentifier("saved-search-query")
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if let error = model.savedSearchError {
                        Text(error).rnFont(13).foregroundStyle(palette.danger).textSelection(.enabled)
                            .accessibilityIdentifier("saved-search-error")
                        Button(model.label("common.retry")) { Task { await model.retrySavedSearch() } }
                            .rnFont(14, .semibold).frame(minHeight: 44)
                            .disabled(model.busy || model.retryNeeded)
                            .accessibilityIdentifier("saved-search-retry")
                    }
                    // Keep the published rows mounted while a new read is staged.
                    let rows = model.savedSearch.objects("rows")
                    ForEach(rows.indices, id: \.self) { index in
                        let row = rows[index]
                        TaskCard(row: row, model: model, palette: palette,
                                 onProject: { project in Task { await model.openProject(project) } },
                                 onToken: { model.focusSavedSearchToken($0) })
                            .id(row.text("id"))
                            .disabled(!model.savedSearchCurrent || !model.savedSearchActionsEnabled)
                    }
                    if rows.count < model.savedSearch.number("total") {
                        Button { Task { await model.loadMoreSavedSearch() } } label: {
                            Text(model.label("common.more")).rnFont(13, .semibold)
                                .padding(.horizontal, 16).frame(minHeight: 44)
                                .background(palette.filter, in: Capsule()).contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(!model.savedSearchCurrent || !model.savedSearchActionsEnabled)
                        .accessibilityIdentifier("saved-search-more")
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    let empty = model.savedSearch.object("empty")
                    if model.savedSearchCurrent && rows.isEmpty && !empty.isEmpty {
                        VStack(spacing: 16) {
                            Text(empty.text("message")).rnFont(16).foregroundStyle(palette.secondary)
                                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                            let actions = empty.object("actions")
                            if !actions.isEmpty {
                                if dynamicTypeSize.isAccessibilitySize {
                                    VStack(spacing: 12) { emptyActions(actions) }
                                } else {
                                    HStack(spacing: 12) { emptyActions(actions) }
                                }
                            }
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 48).padding(.horizontal, 24)
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("saved-search-empty")
                    }
                    if model.busy || (!model.savedSearchCurrent && model.savedSearchError == nil) {
                        ProgressView().frame(maxWidth: .infinity).padding(12)
                            .accessibilityLabel(model.label("common.loading"))
                    }
                }
                .padding(16)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("saved-search-scroll")
            .refreshable { await model.refresh() }
        }
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
                guard scenePhase == .active, model.selectedSurface == .savedSearch else { return }
                await model.refresh()
            }
        }
    }

    @ViewBuilder private func emptyActions(_ actions: CoreObject) -> some View {
        emptyButton(actions.text("inboxLabel"), id: "saved-search-inbox") {
            await model.savedSearchGoInbox()
        }
        emptyButton(actions.text("backLabel"), id: "saved-search-back-empty") {
            await model.closeSavedSearch()
        }
    }

    private func emptyButton(_ label: String, id: String, action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            Text(label).rnFont(14, .semibold).foregroundStyle(palette.text)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(palette.card, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(palette.border, lineWidth: 1))
                .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .disabled(!model.savedSearchCurrent || !model.savedSearchActionsEnabled)
        .accessibilityIdentifier(id)
    }
}
