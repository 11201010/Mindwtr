import SwiftUI

struct HistoryScreen: View {
    @ObservedObject var model: CoreModel
    let palette: AppPalette
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(model.historyTabs.objects("tabs").indices, id: \.self) { index in
                    let tab = model.historyTabs.objects("tabs")[index]
                    Button {
                        searchFocused = false
                        Task { await model.selectHistoryTab(tab.text("id")) }
                    } label: {
                        Text(tab.text("label")).rnFont(14, .bold).multilineTextAlignment(.center)
                            .foregroundStyle(tab.flag("selected") ? palette.tint : palette.secondary)
                            .frame(maxWidth: .infinity, minHeight: 44).padding(.vertical, 2)
                            .overlay(alignment: .bottom) { (tab.flag("selected") ? palette.tint : .clear).frame(height: 2) }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).disabled(model.busy || model.retryNeeded || !model.historyCurrent)
                    .accessibilityAddTraits(tab.flag("selected") ? .isSelected : [])
                    .accessibilityIdentifier("history-tab-" + tab.text("id"))
                }
            }
            .padding(.horizontal, 12).background(palette.card)
            .overlay(alignment: .bottom) { palette.border.frame(height: 0.5) }
            if model.historyArchived { archiveContent }
            else {
                StatusListContent(model: model, palette: palette, data: model.history, prefix: "done",
                                  current: model.historyCurrent, enabled: model.historyActionsEnabled,
                                  error: model.historyError, disableStatus: true,
                                  onRetry: { Task { await model.retryHistory() } },
                                  onMore: { Task { await model.loadMoreHistory() } },
                                  onFilters: { model.setHistoryPanel("filters") },
                                  onChipAction: { action in Task { await model.applyHistoryChipAction(action) } },
                                  onClear: clearFilters,
                                  onCollapse: { id in Task { await model.toggleHistorySection(id) } })
            }
        }
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
                guard scenePhase == .active, model.selectedSurface == .history else { return }
                await model.refresh()
            }
        }
    }

    private var archiveContent: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                ForEach(model.history.objects("segments").indices, id: \.self) { index in
                    let segment = model.history.objects("segments")[index]
                    Button {
                        searchFocused = false
                        Task { await model.setHistoryOption("segment", value: segment.text("id")) }
                    } label: {
                        Text(segment.text("label")).rnFont(12, .semibold).multilineTextAlignment(.center)
                            .foregroundStyle(segment.flag("selected") ? palette.onTint : palette.text)
                            .padding(.horizontal, 12).frame(minHeight: 44)
                            .background(segment.flag("selected") ? palette.tint : palette.filter, in: Capsule())
                            .overlay(Capsule().stroke(palette.border, lineWidth: 1)).contentShape(Capsule())
                    }
                    .buttonStyle(.plain).disabled(!model.historyActionsEnabled)
                    .accessibilityAddTraits(segment.flag("selected") ? .isSelected : [])
                    .accessibilityIdentifier("archive-segment-" + segment.text("id"))
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
            if !model.history.object("search").isEmpty {
                VStack(spacing: 8) {
                    if dynamicTypeSize.isAccessibilitySize {
                        archiveSearchField
                        HStack { archiveSearchTools; Spacer(minLength: 0) }
                    } else { HStack(spacing: 8) { archiveSearchField; archiveSearchTools } }
                }
                .padding(.horizontal, 16).padding(.bottom, 8)
            }
            List {
                Group {
                    if let error = model.historyError {
                        Text(error).rnFont(13).foregroundStyle(palette.danger).textSelection(.enabled)
                            .accessibilityIdentifier("archive-error")
                        Button(model.label("common.retry")) { Task { await model.retryHistory() } }
                            .rnFont(14, .semibold).frame(minHeight: 44)
                            .disabled(model.busy || (model.retryNeeded && !model.historyArchiveRestorePending))
                            .accessibilityIdentifier("archive-retry")
                    }
                    if model.historyCurrent {
                        if !model.history.text("summary").isEmpty {
                            Text(model.history.text("summary")).rnFont(13, .medium).foregroundStyle(palette.secondary)
                                .padding(.top, 4).accessibilityIdentifier("archive-summary")
                        }
                        ForEach(model.history.objects("items").map(ListRowEntry.init)) { entry in
                            let item = entry.item
                            if item.text("type") == "section" { archiveSection(item) }
                            else if item.text("type") == "task" {
                                archiveCard(item)
                                    .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                        if model.historyActionsEnabled {
                                            Button {
                                                searchFocused = false
                                                Task { await model.restoreArchivedTask(item.object("row").text("id")) }
                                            } label: {
                                                Label(model.history.object("labels").text("restore"), systemImage: "arrow.counterclockwise")
                                            }
                                            .tint(palette.tint)
                                            .accessibilityIdentifier("archive-restore-" + item.object("row").text("id"))
                                        }
                                    }
                            }
                            else { archiveCard(item) }
                        }
                        if model.history.objects("items").count < model.history.number("total") {
                            Button(model.label("common.more")) { Task { await model.loadMoreHistory() } }
                                .rnFont(12, .semibold).padding(.horizontal, 12).frame(minHeight: 44)
                                .background(palette.filter, in: Capsule()).buttonStyle(.plain)
                                .disabled(!model.historyActionsEnabled).accessibilityIdentifier("archive-more")
                        }
                        if !model.history.object("empty").isEmpty { archiveEmpty }
                    }
                    if model.busy || (!model.historyCurrent && model.historyError == nil) {
                        ProgressView().frame(maxWidth: .infinity).padding(12)
                    }
                }
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("archive-scroll")
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await model.refresh() }
        }
    }

    private var archiveSearchField: some View {
        TextField(model.history.object("search").text("placeholder"),
                  text: Binding(get: { model.historySearchText }, set: { model.setHistoryText($0) }))
            .rnFont(15).autocorrectionDisabled().textInputAutocapitalization(.never)
            .submitLabel(.search).focused($searchFocused).onSubmit { searchFocused = false }
            .padding(.horizontal, 12).frame(minHeight: 44)
            .background(palette.input, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(palette.border, lineWidth: 1))
            .disabled(model.retryNeeded).accessibilityLabel(model.history.object("search").text("placeholder"))
            .accessibilityIdentifier("archive-search")
    }

    @ViewBuilder private var archiveSearchTools: some View {
        if !model.history.object("filters").text("buttonLabel").isEmpty {
            Button { searchFocused = false; model.setHistoryPanel("filters") } label: {
                HStack(spacing: 6) {
                    AppIcon(name: "sliders", size: 16)
                    Text(model.history.object("filters").text("buttonLabel")).rnFont(12, .semibold)
                }
                .foregroundStyle(palette.tint).padding(.horizontal, 12).frame(minHeight: 44)
                .background(palette.filter, in: Capsule()).overlay(Capsule().stroke(palette.tint, lineWidth: 1))
            }
            .buttonStyle(.plain).disabled(!model.historyActionsEnabled).accessibilityAddTraits(.isSelected)
            .accessibilityIdentifier("archived-active-filters-button")
        }
        Button { searchFocused = false; model.setHistoryPanel("menu") } label: {
            Image(systemName: "ellipsis").font(.system(size: 20)).frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(!model.historyActionsEnabled)
        .accessibilityLabel(model.label("taskEdit.moreOptions")).accessibilityIdentifier("archived-overflow-button")
    }

    private func archiveCard(_ item: CoreObject) -> some View {
        let project = item.text("type") == "project"
        let row = project ? item : item.object("row")
        let group = item.text("groupId").isEmpty ? "none" : item.text("groupId")
        return Button {
            searchFocused = false
            Task {
                if project { await model.openProject(item) }
                else { await model.openTask(row.text("id")) }
            }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.text("title")).rnFont(16, .semibold).strikethrough(item.flag("struck"))
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if !item.text("descriptionMarkdown").isEmpty {
                        Text(inlineMarkdown(item.text("descriptionMarkdown"))).rnFont(14).lineLimit(1)
                    }
                    Text(item.text("dateLabel")).rnFont(12).italic()
                    if !item.text("areaName").isEmpty { Text(item.text("areaName")).rnFont(12).italic() }
                }
                .foregroundStyle(palette.secondary)
                if !project || !item.text("indicatorColor").isEmpty {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color(hex: project ? item.text("indicatorColor") : "6B7280"))
                        .frame(width: 4)
                }
            }
            .fixedSize(horizontal: false, vertical: true).padding(16).frame(minHeight: 44)
            .background(palette.row, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.border, lineWidth: 1)).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(!model.historyActionsEnabled)
        .accessibilityIdentifier(project ? "archive-project-" + row.text("id") : "archive-task-" + group + "-" + row.text("id"))
    }

    private func inlineMarkdown(_ source: String) -> AttributedString {
        // This is core's already-shortened inline preview, never task/date policy.
        (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(source)
    }

    @ViewBuilder private func archiveSection(_ item: CoreObject) -> some View {
        if item.flag("collapsible") {
            Button { searchFocused = false; Task { await model.toggleHistorySection(item.text("id")) } } label: { sectionLabel(item) }
                .buttonStyle(.plain).disabled(!model.historyActionsEnabled)
                .accessibilityValue(model.label(item.flag("collapsed") ? "markdown.expand" : "markdown.collapse"))
                .accessibilityIdentifier("archive-section-" + item.text("id"))
        } else { sectionLabel(item).accessibilityAddTraits(.isHeader) }
    }

    private func sectionLabel(_ item: CoreObject) -> some View {
        HStack(spacing: 6) {
            if item.flag("collapsible") {
                AppIcon(name: "chevron", size: 15).rotationEffect(.degrees(item.flag("collapsed") ? -90 : 0))
            }
            Text(item.text("title")).textCase(.uppercase).rnFont(13, .bold).tracking(0.4)
            Text(String(item.number("count"))).rnFont(12, .semibold)
            Spacer(minLength: 0)
        }
        .foregroundStyle(palette.secondary).frame(minHeight: 44).contentShape(Rectangle())
    }

    private var archiveEmpty: some View {
        let empty = model.history.object("empty")
        return VStack(spacing: 8) {
            Image(systemName: "archivebox").font(.system(size: 48, weight: .light)).foregroundStyle(palette.secondary).accessibilityHidden(true)
            Text(empty.text("title")).rnFont(18, .semibold).accessibilityIdentifier("archive-empty")
            Text(empty.text("message")).rnFont(14).foregroundStyle(palette.secondary)
            if !empty.text("clearLabel").isEmpty {
                Button(empty.text("clearLabel"), action: clearFilters)
                    .rnFont(14, .semibold).frame(minHeight: 44).disabled(!model.historyActionsEnabled)
                    .accessibilityIdentifier("archive-empty-clear")
            }
        }
        .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.horizontal, 24).padding(.vertical, 48)
    }

    private func clearFilters() {
        searchFocused = false
        Task { await model.editHistoryFilter(model.history.object("filters").object("clearEdit")) }
    }
}

struct HistoryPanel: View {
    @ObservedObject var model: CoreModel
    let palette: AppPalette
    @FocusState private var focusedField: String?
    private var isFilter: Bool { model.historyPanel == "filters" }
    private var menuPrefix: String { model.historyArchived ? "archived" : "done" }
    private var menu: CoreObject { model.historyArchived ? model.history.object("menu") : model.history }
    private var submenu: CoreObject { menu.object(model.historyPanel) }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: isFilter ? .bottom : .center) {
                Button { close() } label: { Color.black.opacity(isFilter ? 0.35 : 0.28).contentShape(Rectangle()) }
                    .buttonStyle(.plain).ignoresSafeArea().accessibilityLabel(model.label("common.close"))
                    .accessibilityIdentifier(model.historyPrefix + "-panel-dismiss")
                VStack(alignment: .leading, spacing: 0) {
                    if isFilter { filterControls }
                    else {
                        HStack(spacing: 8) {
                            if model.historyPanel != "menu" {
                                Button { model.setHistoryPanel("menu") } label: {
                                    Text(model.label("common.back")).rnFont(13, .semibold).padding(.horizontal, 8).frame(minHeight: 44).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain).foregroundStyle(palette.tint).accessibilityIdentifier(menuPrefix + "-panel-back")
                            }
                            Text(model.historyPanel == "menu" ? model.label("taskEdit.moreOptions") :
                                 submenu.text(model.historyArchived ? "label" : "title"))
                                .rnFont(17, .bold).frame(maxWidth: .infinity, alignment: .leading).accessibilityAddTraits(.isHeader)
                            Button { close() } label: { AppIcon(name: "x", size: 20).frame(width: 44, height: 44).contentShape(Rectangle()) }
                                .buttonStyle(.plain).accessibilityLabel(model.label("common.close")).accessibilityIdentifier(menuPrefix + "-menu-close")
                        }
                        .frame(minHeight: 44).padding(.bottom, 12)
                        ViewThatFits(in: .vertical) {
                            overflowContent.fixedSize(horizontal: false, vertical: true)
                            ScrollView { overflowContent }.accessibilityIdentifier(menuPrefix + "-panel-scroll")
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
                focusedField = nil
                if !model.historyPickerName.isEmpty { model.closeHistoryPicker() }
                else if !isFilter && model.historyPanel != "menu" { model.setHistoryPanel("menu") }
                else { close() }
            }
        }
    }

    private var overflowContent: some View {
        VStack(spacing: 4) {
            if model.historyPanel == "menu" {
                overflowRow(title: model.historyArchived ? menu.text("filtersLabel") : model.label("filters.label"),
                            selected: model.history.object("filters").flag("hasActive"), icon: "sliders", id: menuPrefix + "-filter-action") {
                    model.setHistoryPanel("filters")
                }
                ForEach(["sort", "group"], id: \.self) { field in
                    overflowRow(title: model.historyArchived ? menu.object(field).text("label") : model.label(field == "sort" ? "sort.label" : "list.groupBy"),
                                value: menu.object(field).text(model.historyArchived ? "value" : "label"),
                                icon: field == "sort" ? "sort" : "folder", id: menuPrefix + "-" + field + "-action") {
                        model.setHistoryPanel(field)
                    }
                }
            } else {
                ForEach(submenu.objects("options").indices, id: \.self) { index in
                    let option = submenu.objects("options")[index]
                    let value = option.text(model.historyArchived ? "id" : "value")
                    let field = model.historyPanel
                    overflowRow(title: option.text("label"), selected: option.flag("selected"), id: menuPrefix + "-" + field + "-" + value) {
                        close()
                        Task { await model.setHistoryOption(field == "sort" ? "sortBy" : "groupBy", value: value) }
                    }
                }
            }
        }
    }

    private func overflowRow(title: String, value: String = "", selected: Bool = false, icon: String = "",
                             id: String, action: @escaping () -> Void) -> some View {
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
        .buttonStyle(.plain).disabled(!model.historyActionsEnabled)
        .accessibilityLabel(value.isEmpty ? title : title + ": " + value)
        .accessibilityAddTraits(selected ? .isSelected : []).accessibilityIdentifier(id)
    }

    private var filterControls: some View {
        ListFilterControls(
            data: model.history, strings: model.strings, palette: palette, prefix: model.historyPrefix,
            enabled: model.historyActionsEnabled, busy: model.busy, frozen: model.retryNeeded, error: model.historyError,
            searchText: Binding(get: { model.historySearchText }, set: { model.setHistoryText($0) }),
            locationText: Binding(get: { model.historyLocationText }, set: { model.setHistoryText($0, location: true) }),
            pickerName: model.historyPickerName, picker: model.historyPicker, pickerCurrent: model.historyPickerCurrent,
            pickerEnabled: model.historyPickerActionsEnabled, pickerError: model.historyPickerError,
            pickerQuery: Binding(get: { model.historyPickerQuery }, set: { model.setHistoryPickerQuery($0) }),
            onEdit: { edit in Task { await model.editHistoryFilter(edit) } },
            onChipAction: { action in Task { await model.applyHistoryChipAction(action) } },
            onArchived: { _ in }, onOpenPicker: model.openHistoryPicker, onBack: model.closeHistoryPicker,
            onMore: model.loadMoreHistoryPicker, onRetry: { Task { await model.retryHistory() } },
            onRetryPicker: model.retryHistoryPicker, onClose: model.closeHistoryPanel, focusedField: $focusedField)
    }

    private func close() { focusedField = nil; model.closeHistoryPanel() }
}
