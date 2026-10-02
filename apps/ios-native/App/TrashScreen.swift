import SwiftUI

struct TrashScreen: View {
    @ObservedObject var model: CoreModel
    let palette: AppPalette
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if model.trashCurrent {
                if !model.trash.text("summary").isEmpty {
                    Text(model.trash.text("summary")).rnFont(13, .medium).foregroundStyle(palette.secondary)
                        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 2)
                        .accessibilityIdentifier("trash-summary")
                }
                if !model.trash.text("retentionHint").isEmpty {
                    Text(model.trash.text("retentionHint")).rnFont(12).foregroundStyle(palette.secondary)
                        .padding(.horizontal, 16).padding(.top, 4)
                        .accessibilityIdentifier("trash-retention-hint")
                }
            }
            GeometryReader { geometry in
                List {
                    Group {
                        if let error = model.trashError {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(error).rnFont(13).foregroundStyle(palette.danger).textSelection(.enabled)
                                    .accessibilityIdentifier("trash-error")
                                Button(model.label("common.retry")) { Task { await model.retryTrash() } }
                                    .rnFont(14, .semibold).frame(minHeight: 44)
                                    .disabled(model.busy).accessibilityIdentifier("trash-retry")
                            }
                        }
                        if model.trashCurrent {
                            ForEach(model.trash.objects("items").map(TrashRowEntry.init)) { entry in
                                row(entry)
                                    .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                        if entry.item.text("type") == "task", model.trashActionsEnabled {
                                            Button {
                                                Task { await model.restoreTrashTask(entry.item.object("row").text("id")) }
                                            } label: {
                                                Label(model.trash.object("labels").text("restore"), systemImage: "arrow.counterclockwise")
                                            }
                                            .tint(palette.tint)
                                            .accessibilityIdentifier("trash-restore-" + entry.item.object("row").text("id"))
                                        }
                                    }
                            }
                            if model.trash.objects("items").count < model.trash.number("total") {
                                Button { Task { await model.loadMoreTrash() } } label: {
                                    Text(model.label("common.more")).rnFont(12, .semibold)
                                        .padding(.horizontal, 12).frame(minHeight: 44)
                                        .background(palette.filter, in: Capsule()).contentShape(Capsule())
                                }
                                .buttonStyle(.plain).disabled(!model.trashActionsEnabled).accessibilityIdentifier("trash-more")
                            }
                            if !model.trash.object("empty").isEmpty {
                                emptyState.frame(minHeight: max(0, geometry.size.height - 32))
                            }
                        }
                        if model.busy || (!model.trashCurrent && model.trashError == nil) {
                            ProgressView().frame(maxWidth: .infinity).padding(12)
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .accessibilityIdentifier("trash-scroll")
                .refreshable { await model.refresh() }
            }
        }
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
                guard scenePhase == .active, model.selectedSurface == .trash else { return }
                await model.refresh()
            }
        }
    }

    private func row(_ entry: TrashRowEntry) -> some View {
        let item = entry.item
        let project = item.text("type") == "project"
        let data = project ? item : item.object("row")
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text(data.text("title")).rnFont(16, .semibold).strikethrough()
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 4)
                if !item.text("descriptionMarkdown").isEmpty {
                    Text(inlineMarkdown(item.text("descriptionMarkdown"))).rnFont(14).lineLimit(1).padding(.bottom, 4)
                }
                Text(item.text("typeLabel")).rnFont(12).italic()
                Text(item.text("deletedLabel")).rnFont(12).italic()
            }
            .foregroundStyle(palette.secondary)
            if !project || !item.text("indicatorColor").isEmpty {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(hex: project ? item.text("indicatorColor") : "6B7280"))
                    .frame(width: 4).accessibilityHidden(true)
            }
        }
        .fixedSize(horizontal: false, vertical: true).padding(16)
        .background(palette.row, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("trash-" + entry.id)
    }

    private func inlineMarkdown(_ source: String) -> AttributedString {
        var preview = (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(source)
        // RN's Trash rows are static outside selection. Preserve inline styling
        // without turning Markdown in a deleted item into an interactive link.
        preview.link = nil
        return preview
    }

    private var emptyState: some View {
        let empty = model.trash.object("empty")
        return VStack(spacing: 0) {
            Image(systemName: "trash").font(.system(size: 40, weight: .light))
                .foregroundStyle(palette.secondary).padding(.bottom, 12).accessibilityHidden(true)
            Text(empty.text("title")).rnFont(18, .semibold).padding(.bottom, 6).accessibilityIdentifier("trash-empty")
            Text(empty.text("message")).rnFont(14).foregroundStyle(palette.secondary)
        }
        .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.vertical, 40)
    }
}

private struct TrashRowEntry: Identifiable {
    let item: CoreObject
    var id: String {
        item.text("type") + "-" + (item.text("type") == "task" ? item.object("row").text("id") : item.text("id"))
    }
}
