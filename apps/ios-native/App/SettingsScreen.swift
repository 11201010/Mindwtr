import SwiftUI

struct SettingsScreen: View {
    @ObservedObject var model: CoreModel
    let palette: AppPalette
    @FocusState private var renameFocused: Bool
    @State private var deleteConfirmPresented = false
    @State private var deleteConfirmAnswered = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    renameFocused = false
                    if model.settingsManagePresented { model.closeManageSettings() }
                    else { Task { await model.closeSettings() } }
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(model.busy || model.retryNeeded || model.somedaySectionRenamePending
                          || model.somedaySectionRenameAwaitingRefresh
                          || model.somedaySectionDeletePending || model.somedaySectionDeleteAwaitingRefresh)
                .accessibilityLabel(model.label("common.back"))
                .accessibilityIdentifier(model.settingsManagePresented ? "manage-back" : "settings-back")
                Text(model.settingsManagePresented ? model.manageSettings.text("title") : model.settingsMenu.text("title"))
                    .rnFont(20, .bold).foregroundStyle(palette.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
            }
            .padding(.horizontal, 12).padding(.vertical, 5)
            .background(palette.card)
            if model.settingsManagePresented { manageContent }
            else { menuContent }
        }
        .background(palette.bg)
        .alert(model.somedaySectionDeleteOptions.object("text").text("title"),
               isPresented: $deleteConfirmPresented) {
            Button(model.somedaySectionDeleteOptions.object("text").text("cancelLabel"), role: .cancel) {
                deleteConfirmAnswered = true
                model.cancelSomedaySectionDelete()
            }
            .accessibilityIdentifier("manage-someday-delete-cancel")
            Button(model.somedaySectionDeleteOptions.object("text").text("confirmLabel"), role: .destructive) {
                deleteConfirmAnswered = true
                Task { await model.confirmSomedaySectionDelete() }
            }
            .accessibilityIdentifier("manage-someday-delete-confirm")
        } message: {
            Text(model.somedaySectionDeleteOptions.object("text").text("message"))
        }
        .onChange(of: deleteConfirmPresented) { presented in
            guard !presented else { return }
            // A system dismissal may publish before its destructive Button action.
            // Defer implicit-cancel cleanup so that action can retain frozen Options.
            DispatchQueue.main.async {
                if !deleteConfirmAnswered && !deleteConfirmPresented { model.cancelSomedaySectionDelete() }
            }
        }
        .accessibilityAction(.escape) {
            if model.settingsManagePresented { model.closeManageSettings() }
            else { Task { await model.closeSettings() } }
        }
    }

    private var menuContent: some View {
        ScrollView {
            VStack(spacing: 16) {
                TextField(model.settingsMenu.text("searchPlaceholder"), text: Binding(
                    get: { model.settingsSearch }, set: { model.setSettingsSearch($0) }))
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .rnFont(15).padding(.horizontal, 12).frame(minHeight: 44)
                    .background(palette.card, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.border, lineWidth: 1))
                    .accessibilityLabel(model.settingsMenu.text("searchPlaceholder"))
                    .accessibilityIdentifier("settings-search")
                if let groups = model.settingsMenu["groups"] as? [[CoreObject]] {
                    ForEach(groups.indices, id: \.self) { groupIndex in
                        VStack(spacing: 0) {
                            ForEach(groups[groupIndex].indices, id: \.self) { rowIndex in
                                let row = groups[groupIndex][rowIndex]
                                Button {
                                    if row.text("id") == "manage" { Task { await model.openManageSettings() } }
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: settingsSymbol(row.text("icon")))
                                            .font(.system(size: 20)).foregroundStyle(palette.tint)
                                            .frame(width: 32).accessibilityHidden(true)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(row.text("title")).rnFont(15, .semibold).foregroundStyle(palette.text)
                                            if !row.text("description").isEmpty {
                                                Text(row.text("description")).rnFont(12)
                                                    .foregroundStyle(palette.secondary)
                                                    .fixedSize(horizontal: false, vertical: true)
                                            }
                                        }
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        Image(systemName: "chevron.right").font(.system(size: 12))
                                            .foregroundStyle(palette.secondary).accessibilityHidden(true)
                                    }
                                    .padding(.horizontal, 14).frame(minHeight: 60).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain).disabled(row.text("id") != "manage" || model.busy || model.retryNeeded)
                                .opacity(row.text("id") == "manage" ? 1 : 0.55)
                                .accessibilityLabel(row.text("accessibilityLabel").isEmpty ? row.text("title") : row.text("accessibilityLabel"))
                                .accessibilityIdentifier("settings-" + row.text("id"))
                                if rowIndex < groups[groupIndex].count - 1 { palette.border.frame(height: 0.5) }
                            }
                        }
                        .background(palette.card, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                if !model.settingsMenu.text("noMatches").isEmpty {
                    Text(model.settingsMenu.text("noMatches")).rnFont(14).foregroundStyle(palette.secondary)
                        .frame(maxWidth: .infinity).padding(20).accessibilityIdentifier("settings-no-matches")
                }
                if let failure = model.settingsReadError ?? (!model.settingsManagePresented ? model.manageReadError : nil) {
                    errorBlock(failure, id: "settings-read-error") { Task { await model.retryManageSettingsRead() } }
                }
                if model.busy { ProgressView().padding(12) }
            }
            .padding(16)
        }
        .accessibilityIdentifier("settings-scroll")
    }

    private var manageContent: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                if let failure = model.somedaySectionDeleteError {
                    errorBlock(failure, id: "manage-someday-delete-error",
                               retryID: "manage-someday-delete-retry") {
                        Task {
                            await model.retrySomedaySectionDelete()
                            presentSomedayDeleteConfirmationIfReady()
                        }
                    }
                } else if let failure = model.somedaySectionRenameError ?? model.manageReadError {
                    errorBlock(failure, id: "manage-someday-error") {
                        Task {
                            if model.somedaySectionRenameIndex != nil || model.somedaySectionRenameReadPending {
                                await model.retrySomedaySectionRename()
                            }
                            else { await model.retryManageSettingsRead() }
                        }
                    }
                }
                ForEach(model.manageSettings.objects("sections").indices, id: \.self) { index in
                    let section = model.manageSettings.objects("sections")[index]
                    let someday = section.text("key") == "somedaySections"
                    VStack(spacing: 1) {
                        Button { if someday { Task { await model.toggleManageSection("somedaySections") } } } label: {
                            HStack(spacing: 10) {
                                Image(systemName: section.flag("open") ? "chevron.down" : "chevron.right")
                                    .font(.system(size: 14)).foregroundStyle(palette.secondary).accessibilityHidden(true)
                                Text(section.text("title")).rnFont(15, .semibold)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Text(String(section.number("count"))).rnFont(13).foregroundStyle(palette.secondary)
                            }
                            .foregroundStyle(palette.text).padding(.horizontal, 16)
                            .frame(minHeight: 52).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).disabled(!someday || model.busy || model.retryNeeded
                                                      || model.somedaySectionRenameIndex != nil
                                                      || model.somedaySectionRenameReadPending
                                                      || model.somedaySectionDeleteActive)
                        .opacity(someday ? 1 : 0.55)
                        .accessibilityValue(section.flag("open") ? "expanded" : "collapsed")
                        .accessibilityIdentifier("manage-section-toggle-" + (someday ? "someday-sections" : section.text("key")))
                        if someday && section.flag("open") {
                            if model.managedSomedayTotal == 0 {
                                Text(model.manageSettings.object("somedaySections").text("emptyHint"))
                                    .rnFont(14).foregroundStyle(palette.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                            } else {
                                ForEach(model.managedSomedaySections.indices, id: \.self) { rowIndex in
                                    somedayRow(index: rowIndex)
                                }
                                if model.managedSomedaySections.count < model.managedSomedayTotal {
                                    Button(model.label("common.more")) {
                                        Task { await model.loadMoreManagedSomedaySections() }
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .disabled(model.busy || model.retryNeeded || model.manageReadError != nil
                                              || model.somedaySectionRenameIndex != nil
                                              || model.somedaySectionDeleteActive)
                                    .accessibilityIdentifier("manage-someday-more")
                                }
                            }
                        }
                    }
                    .background(palette.card, in: RoundedRectangle(cornerRadius: 12))
                }
                if model.busy { ProgressView().padding(12) }
            }
            .padding(16)
        }
        .accessibilityIdentifier("manage-someday-scroll")
    }

    private func somedayRow(index: Int) -> some View {
        let row = model.managedSomedaySections[index]
        let editing = model.somedaySectionRenameIndex == index
        return HStack(spacing: 8) {
            if editing {
                TextField(model.somedaySectionRenameOptions.object("text").text("nameLabel"), text: Binding(
                    get: { model.somedaySectionRenameTitle }, set: { model.setSomedaySectionRenameTitle($0) }))
                    .focused($renameFocused).submitLabel(.done)
                    .onSubmit { Task { await model.saveSomedaySectionRename() } }
                    .rnFont(15).padding(.horizontal, 10).frame(minHeight: 44)
                    .background(palette.input, in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                    .onTapGesture { renameFocused = true }
                    .disabled(!model.somedaySectionRenameInputEnabled)
                    .accessibilityLabel(model.somedaySectionRenameOptions.object("text").text("nameLabel"))
                    .accessibilityIdentifier("manage-someday-name")
                Button { renameFocused = false; model.cancelSomedaySectionRename() } label: {
                    Text(model.label("common.cancel")).rnFont(13).frame(minHeight: 44)
                        .padding(.horizontal, 4).contentShape(Rectangle())
                }
                .buttonStyle(.plain).disabled(model.busy || model.retryNeeded
                                              || model.somedaySectionRenamePending || model.somedaySectionRenameAwaitingRefresh)
                .accessibilityIdentifier("manage-someday-cancel")
                Button { renameFocused = false; Task { await model.saveSomedaySectionRename() } } label: {
                    Image(systemName: "checkmark").font(.system(size: 18, weight: .semibold))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain).disabled(!model.somedaySectionRenameCanSave)
                .opacity(model.somedaySectionRenameCanSave ? 1 : 0.45)
                .accessibilityLabel(model.somedaySectionRenameOptions.object("text").text("saveLabel"))
                .accessibilityIdentifier("manage-someday-save")
            } else {
                Text(row.text("title")).rnFont(15).foregroundStyle(palette.text)
                    .frame(maxWidth: .infinity, alignment: .leading).lineLimit(1)
                Button { Task { await model.openSomedaySectionRename(index: index); renameFocused = true } } label: {
                    Image(systemName: "pencil").font(.system(size: 18))
                        .foregroundStyle(palette.secondary).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain).disabled(model.busy || model.retryNeeded || model.manageReadError != nil
                                              || model.somedaySectionRenameReadPending || model.somedaySectionRenameIndex != nil
                                              || model.somedaySectionDeleteActive)
                .accessibilityLabel(row.text("renameLabel"))
                .accessibilityIdentifier("manage-someday-rename-\(index)")
                Button {
                    Task {
                        await model.openSomedaySectionDelete(index: index)
                        presentSomedayDeleteConfirmationIfReady()
                    }
                } label: {
                    Image(systemName: "trash").font(.system(size: 18))
                        .foregroundStyle(palette.danger).frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain).disabled(model.busy || model.retryNeeded || model.manageReadError != nil
                                              || model.somedaySectionRenameReadPending || model.somedaySectionRenameIndex != nil
                                              || model.somedaySectionDeleteActive)
                .accessibilityLabel(row.text("deleteLabel"))
                .accessibilityIdentifier("manage-someday-delete-\(index)")
            }
        }
        .padding(.horizontal, 12).frame(minHeight: 52)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(row.text("title"))
        .accessibilityIdentifier("manage-someday-row-\(index)")
    }

    private func presentSomedayDeleteConfirmationIfReady() {
        guard model.somedaySectionDeleteCanConfirm else { return }
        deleteConfirmAnswered = false
        deleteConfirmPresented = true
    }

    private func errorBlock(_ failure: String, id: String,
                            retryID: String = "manage-someday-retry", retry: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(failure).rnFont(13).foregroundStyle(palette.danger).textSelection(.enabled)
                .accessibilityIdentifier(id)
            Button(action: retry) {
                Text(model.label("common.retry")).rnFont(14, .semibold)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(model.busy)
            .accessibilityIdentifier(retryID)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func settingsSymbol(_ name: String) -> String {
        switch name {
        case "Monitor": return "display"
        case "ListChecks": return "checklist"
        case "Layers": return "square.3.layers.3d"
        case "Bell": return "bell"
        case "RefreshCw": return "arrow.clockwise"
        case "Database": return "externaldrive"
        case "Settings2": return "slider.horizontal.3"
        case "Info": return "info.circle"
        case "Sparkles": return "sparkles"
        case "CalendarDays": return "calendar"
        default: return "gearshape"
        }
    }
}
