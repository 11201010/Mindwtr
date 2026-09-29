import SwiftUI

struct ReferenceScreen: View {
    @ObservedObject var model: CoreModel
    let palette: AppPalette
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        StatusListContent(model: model, palette: palette, data: model.reference, prefix: "reference",
                          current: model.referenceCurrent, enabled: model.referenceActionsEnabled,
                          error: model.referenceError, disableStatus: false,
                          onRetry: { Task { await model.retryReference() } },
                          onMore: { Task { await model.loadMoreReference() } },
                          onFilters: { model.referencePanel = "filters" },
                          onChipAction: { action in Task { await model.applyReferenceChipAction(action) } },
                          onClear: { Task { await model.editReferenceFilter(model.reference.object("filters").object("clearEdit")) } },
                          onCollapse: { id in Task { await model.toggleReferenceSection(id) } })
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
                guard scenePhase == .active, model.selectedSurface == .reference else { return }
                await model.refresh()
            }
        }
    }
}

// Grouped tag lists may contain the same task in several sections.
struct ListRowEntry: Identifiable {
    let item: CoreObject
    var id: String {
        switch item.text("type") {
        case "task": return "task:" + item.text("groupId") + ":" + item.object("row").text("id")
        default: return item.text("type") + ":" + item.text("id")
        }
    }
}

// Reference and Done consume the same core status-list DTO and RN TaskList layout.
struct StatusListContent: View {
    @ObservedObject var model: CoreModel
    let palette: AppPalette
    let data: CoreObject
    let prefix: String
    let current: Bool
    let enabled: Bool
    let error: String?
    let disableStatus: Bool
    let onRetry: () -> Void
    let onMore: () -> Void
    let onFilters: () -> Void
    let onChipAction: (CoreObject) -> Void
    let onClear: () -> Void
    let onCollapse: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            if current { activeFilters }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if let error = error {
                        Text(error).rnFont(13).foregroundStyle(palette.danger).textSelection(.enabled)
                            .accessibilityIdentifier(prefix + "-error")
                        Button(model.label("common.retry")) { onRetry() }
                            .rnFont(14, .semibold).frame(minHeight: 44).disabled(model.busy || model.retryNeeded)
                            .accessibilityIdentifier(prefix + "-retry")
                    }
                    if current {
                        let items = data.objects("items")
                        ForEach(items.map(ListRowEntry.init)) { entry in
                            let item = entry.item
                            if item.text("type") == "task" {
                                let row = item.object("row")
                                TaskCard(row: row, model: model, palette: palette, readOnly: disableStatus || row.flag("readOnly"),
                                         onProject: { project in Task { await model.openProject(project) } })
                                    .id(entry.id)
                            } else if item.text("type") == "section" { section(item) }
                        }
                        if items.count < data.number("total") {
                            Button { onMore() } label: {
                                Text(model.label("common.more")).rnFont(12, .semibold).padding(.horizontal, 12).frame(minHeight: 44)
                                    .background(palette.filter, in: Capsule()).contentShape(Capsule())
                            }
                            .buttonStyle(.plain).disabled(!enabled).accessibilityIdentifier(prefix + "-more")
                        }
                        if items.isEmpty { emptyState }
                    }
                    if model.busy || (!current && error == nil) {
                        ProgressView().frame(maxWidth: .infinity).padding(12)
                    }
                }
                .padding(16)
            }
            .refreshable { await model.refresh() }
        }
    }

    @ViewBuilder private var activeFilters: some View {
        if data.flag("hasActiveFilters") {
            HStack {
                Button { onFilters() } label: {
                    HStack(spacing: 6) {
                        AppIcon(name: "sliders", size: 16)
                        Text(model.label("filters.label") + " · " + String(data.number("filterActiveCount"))).rnFont(12, .semibold)
                    }
                    .foregroundStyle(palette.tint).padding(.horizontal, 12).frame(minHeight: 44)
                    .background(palette.filter, in: Capsule()).overlay(Capsule().stroke(palette.tint, lineWidth: 1)).contentShape(Capsule())
                }
                .buttonStyle(.plain).disabled(!enabled).accessibilityAddTraits(.isSelected)
                .accessibilityIdentifier(prefix + "-active-filters")
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.vertical, 6)
        }
        let chips = data.objects("chips")
        if !chips.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(chips.indices, id: \.self) { index in
                        let chip = chips[index]
                        let tone = chip.flag("excluded") ? palette.danger : palette.tint
                        Button { onChipAction(chip.object("action")) } label: {
                            HStack(spacing: 6) {
                                Text(chip.text("label")).rnFont(12, .semibold).strikethrough(chip.flag("excluded"))
                                AppIcon(name: "x", size: 14)
                            }
                            .foregroundStyle(tone).padding(.horizontal, 12).frame(minHeight: 44)
                            .background(palette.filter, in: Capsule()).overlay(Capsule().stroke(tone, lineWidth: 1)).contentShape(Capsule())
                        }
                        .buttonStyle(.plain).disabled(!enabled)
                        .accessibilityLabel(model.label("filters.remove") + ": " + chip.text("label"))
                        .accessibilityValue(chip.flag("excluded") ? model.label("filters.excluded") : "")
                        .accessibilityIdentifier(prefix + "-chip-" + chip.text("id"))
                    }
                    Button { onClear() } label: {
                        Text(model.label("filters.clear")).rnFont(12, .semibold).foregroundStyle(palette.secondary)
                            .padding(.horizontal, 12).frame(minHeight: 44).background(palette.filter, in: Capsule())
                            .overlay(Capsule().stroke(palette.border, lineWidth: 1)).contentShape(Capsule())
                    }
                    .buttonStyle(.plain).disabled(!enabled).accessibilityIdentifier(prefix + "-clear-filters")
                }
                .padding(.horizontal, 16).padding(.vertical, 8)
            }
            .fixedSize(horizontal: false, vertical: true).background(palette.card)
            .overlay(alignment: .bottom) { palette.border.frame(height: 1) }
        }
    }

    @ViewBuilder private func section(_ item: CoreObject) -> some View {
        if item.flag("collapsible") {
            Button { onCollapse(item.text("id")) } label: { sectionLabel(item) }
                .buttonStyle(.plain).disabled(!enabled)
                .accessibilityValue(model.label(item.flag("collapsed") ? "markdown.expand" : "markdown.collapse"))
                .accessibilityIdentifier(prefix + "-section-" + item.text("id"))
        } else { sectionLabel(item).accessibilityAddTraits(.isHeader) }
    }

    private func sectionLabel(_ item: CoreObject) -> some View {
        HStack(spacing: 6) {
            if item.flag("collapsible") {
                AppIcon(name: "chevron", size: 15).rotationEffect(.degrees(item.flag("collapsed") ? -90 : 0))
                    .foregroundStyle(palette.secondary)
            }
            Text(item.text("title")).rnFont(13, .bold).foregroundStyle(item.flag("muted") ? palette.secondary : palette.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(String(item.number("count"))).rnFont(12, .semibold).foregroundStyle(palette.secondary)
        }
        .frame(minHeight: 44).contentShape(Rectangle()).padding(.top, 4)
    }

    private var emptyState: some View {
        let empty = data.object("empty")
        return VStack(spacing: 8) {
            Text(empty.text("message")).rnFont(18, .semibold)
            Text(empty.text("hint")).rnFont(14).foregroundStyle(palette.secondary)
            if empty.flag("clear") {
                Button(empty.text("actionLabel")) {
                    onClear()
                }
                .rnFont(14, .semibold).frame(minHeight: 44).disabled(!enabled)
                .accessibilityIdentifier(prefix + "-empty-clear")
            }
        }
        .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.horizontal, 24).padding(.vertical, 48)
    }
}

struct ReferencePanel: View {
    @ObservedObject var model: CoreModel
    let palette: AppPalette
    @FocusState private var focusedField: String?
    private var isFilter: Bool { model.referencePanel == "filters" }
    private var isSort: Bool { model.referencePanel == "sort" }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: isFilter ? .bottom : .center) {
                Button { close() } label: { Color.black.opacity(isFilter ? 0.35 : 0.28).contentShape(Rectangle()) }
                    .buttonStyle(.plain).ignoresSafeArea().accessibilityLabel(model.label("common.close"))
                    .accessibilityIdentifier("reference-panel-dismiss").disabled(model.busy || model.retryNeeded)
                VStack(alignment: .leading, spacing: 0) {
                    if isFilter { filterControls }
                    else {
                        HStack(spacing: 8) {
                            if model.referencePanel == "group" || isSort {
                                Button { model.referencePanel = "menu" } label: {
                                    Text(model.label("common.back")).rnFont(13, .semibold).padding(.horizontal, 8).frame(minHeight: 44).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain).foregroundStyle(palette.tint).accessibilityIdentifier("reference-panel-back").disabled(model.busy || model.retryNeeded)
                            }
                            Text(isSort ? model.label("sort.label") : model.referencePanel == "group" ? model.reference.object("group").text("title") : model.label("taskEdit.moreOptions"))
                                .rnFont(17, .bold).frame(maxWidth: .infinity, alignment: .leading).accessibilityAddTraits(.isHeader)
                            Button { close() } label: { AppIcon(name: "x", size: 20).frame(width: 44, height: 44).contentShape(Rectangle()) }
                                .buttonStyle(.plain).accessibilityLabel(model.label("common.close")).accessibilityIdentifier("reference-menu-close").disabled(model.busy || model.retryNeeded)
                        }
                        .frame(minHeight: 44).padding(.bottom, 12)
                        ViewThatFits(in: .vertical) {
                            overflowContent.fixedSize(horizontal: false, vertical: true)
                            ScrollView { overflowContent }.accessibilityIdentifier("reference-panel-scroll")
                        }
                    }
                }
                .padding(isFilter ? 16 : 12)
                .frame(maxWidth: isFilter ? 860 : 440, maxHeight: geometry.size.height * 0.82, alignment: .top)
                .fixedSize(horizontal: false, vertical: !isFilter)
                .background(palette.card, in: RoundedRectangle(cornerRadius: isFilter ? 24 : 16))
                .overlay(RoundedRectangle(cornerRadius: isFilter ? 24 : 16).stroke(palette.border, lineWidth: 1))
                .padding(.horizontal, isFilter ? 0 : 12)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .contain).accessibilityAddTraits(.isModal)
            .accessibilityAction(.escape) {
                guard !model.busy, !model.retryNeeded else { return }
                focusedField = nil
                if !model.referencePickerName.isEmpty { model.closeReferencePicker() }
                else if model.referencePanel == "group" || isSort { model.referencePanel = "menu" }
                else { close() }
            }
        }
    }

    private var overflowContent: some View {
        VStack(spacing: 4) {
            if model.referencePanel == "menu" {
                overflowRow(title: model.label("filters.label"), selected: model.reference.flag("hasActiveFilters"),
                            icon: "sliders", id: "reference-filter-action") { model.referencePanel = "filters" }
                overflowRow(title: model.label("sort.label"), value: model.reference.object("sort").text("label"),
                            icon: "sort", id: "reference-sort-action") { Task { await model.openReferenceSort() } }
                overflowRow(title: model.label("list.groupBy"), value: model.reference.object("group").text("label"),
                            icon: "folder", id: "reference-group-action") { model.referencePanel = "group" }
            } else if isSort {
                if let error = model.referenceSortError {
                    Text(error).rnFont(13).foregroundStyle(palette.danger)
                        .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("reference-sort-error")
                    Button(model.label("common.retry")) { Task { await model.retryReferenceSort() } }
                        .rnFont(15, .semibold).foregroundStyle(palette.tint).frame(minHeight: 44)
                        .disabled(model.busy).accessibilityIdentifier("reference-sort-retry")
                }
                let choices = model.referenceSortOptions.objects("choices")
                ForEach(choices.indices, id: \.self) { index in
                    let option = choices[index]
                    overflowRow(title: option.text("label"), selected: option.flag("selected"),
                                id: "reference-sort-" + option.text("value")) {
                        Task { await model.setReferenceSort(option.text("value")) }
                    }
                }
                if model.busy { ProgressView().frame(maxWidth: .infinity).padding(12) }
            } else {
                let options = model.reference.object("group").objects("options")
                ForEach(options.indices, id: \.self) { index in
                    let option = options[index]
                    overflowRow(title: option.text("label"), selected: option.flag("selected"),
                                id: "reference-group-" + option.text("value")) {
                        close()
                        Task { await model.setReferenceOption("groupBy", value: option.text("value")) }
                    }
                }
            }
        }
    }

    private func overflowRow(title: String, value: String = "", selected: Bool = false, icon: String = "",
                             id: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if !icon.isEmpty {
                    AppIcon(name: icon, size: 18).foregroundStyle(selected ? palette.tint : palette.secondary)
                        .frame(width: 34, height: 34).background(palette.filter, in: RoundedRectangle(cornerRadius: 8))
                }
                Text(title).rnFont(15, .semibold).frame(maxWidth: .infinity, alignment: .leading)
                if !value.isEmpty { Text(value).rnFont(13).foregroundStyle(palette.secondary).multilineTextAlignment(.trailing) }
                if selected { Image(systemName: "checkmark").font(.system(size: 16)).foregroundStyle(palette.tint) }
            }
            .padding(10).frame(minHeight: 52).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(!model.referenceActionsEnabled || !enabled).opacity(enabled ? 1 : 0.55)
        .accessibilityLabel(value.isEmpty ? title : title + ": " + value)
        .accessibilityAddTraits(selected ? .isSelected : []).accessibilityIdentifier(id)
    }

    private var filterControls: some View {
        ListFilterControls(
            data: model.reference, strings: model.strings, palette: palette, prefix: "reference",
            enabled: model.referenceActionsEnabled, busy: model.busy, frozen: model.retryNeeded, error: model.referenceError,
            searchText: Binding(get: { model.referenceSearchText }, set: { model.setReferenceText($0) }),
            locationText: Binding(get: { model.referenceLocationText }, set: { model.setReferenceText($0, location: true) }),
            pickerName: model.referencePickerName, picker: model.referencePicker, pickerCurrent: model.referencePickerCurrent,
            pickerEnabled: model.referencePickerActionsEnabled, pickerError: model.referencePickerError,
            pickerQuery: Binding(get: { model.referencePickerQuery }, set: { model.setReferencePickerQuery($0) }),
            onEdit: { edit in Task { await model.editReferenceFilter(edit) } },
            onChipAction: { action in Task { await model.applyReferenceChipAction(action) } },
            onArchived: { value in Task { await model.setReferenceOption("includeArchivedProjects", value: value) } },
            onOpenPicker: model.openReferencePicker, onBack: model.closeReferencePicker,
            onMore: model.loadMoreReferencePicker, onRetry: { Task { await model.retryReference() } },
            onRetryPicker: model.retryReferencePicker, onClose: model.closeReferencePanel, focusedField: $focusedField)
    }

    private func close() { focusedField = nil; model.closeReferencePanel() }
}
