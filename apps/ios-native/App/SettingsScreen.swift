import SwiftUI

struct SettingsScreen: View {
    @ObservedObject var model: CoreModel
    let palette: AppPalette
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @FocusState private var renameFocused: Bool
    @FocusState private var areaNameFocused: Bool
    @State private var deleteConfirmPresented = false
    @State private var deleteConfirmAnswered = false
    @State private var areaDeleteConfirmPresented = false
    @State private var areaDeleteConfirmAnswered = false

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
                          || model.somedaySectionDeletePending || model.somedaySectionDeleteAwaitingRefresh
                          || model.somedaySectionOrderActive || model.unassignedAreaColorActive
                          || model.settingsAreaDeleteActive)
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
        .alert(model.settingsAreaDeleteOptions.object("text").text("title"),
               isPresented: $areaDeleteConfirmPresented) {
            Button(model.settingsAreaDeleteOptions.object("text").text("cancelLabel"), role: .cancel) {
                areaDeleteConfirmAnswered = true
                model.cancelSettingsAreaDelete()
            }
            .accessibilityIdentifier("manage-area-delete-cancel")
            Button(model.settingsAreaDeleteOptions.object("text").text("confirmLabel"), role: .destructive) {
                areaDeleteConfirmAnswered = true
                Task { await model.confirmSettingsAreaDelete() }
            }
            .accessibilityIdentifier("manage-area-delete-confirm")
        } message: {
            Text(model.settingsAreaDeleteOptions.object("text").text("message"))
        }
        .onChange(of: areaDeleteConfirmPresented) { presented in
            guard !presented else { return }
            DispatchQueue.main.async {
                if !areaDeleteConfirmAnswered && !areaDeleteConfirmPresented { model.cancelSettingsAreaDelete() }
            }
        }
        .sheet(isPresented: Binding(
            get: { !model.unassignedAreaColorOptions.isEmpty },
            set: { if !$0 { model.cancelUnassignedAreaColor() } }
        )) { unassignedAreaColorSheet }
        .sheet(isPresented: Binding(
            get: { model.settingsAreaCreatePresented },
            set: { if !$0 { model.cancelSettingsAreaCreate() } }
        )) { newAreaSheet }
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
                if let failure = model.unassignedAreaColorError, model.unassignedAreaColorOptions.isEmpty {
                    errorBlock(failure, id: "manage-unassigned-color-error",
                               retryID: "manage-unassigned-color-retry") {
                        Task { await model.retryUnassignedAreaColor() }
                    }
                } else if let failure = model.settingsAreaDeleteError {
                    VStack(alignment: .leading, spacing: 4) {
                        errorBlock(failure, id: "manage-area-delete-error", retryID: "manage-area-delete-retry") {
                            Task {
                                await model.retrySettingsAreaDelete()
                                presentAreaDeleteConfirmationIfReady()
                            }
                        }
                        if model.settingsAreaDeleteCanCancel {
                            Button(model.label("common.cancel")) { model.cancelSettingsAreaDelete() }
                                .frame(minHeight: 44).accessibilityIdentifier("manage-area-delete-error-cancel")
                        }
                    }
                } else if let failure = model.somedaySectionOrderError {
                    errorBlock(failure, id: "manage-someday-order-error",
                               retryID: "manage-someday-order-retry") {
                        Task { await model.retrySomedaySectionOrder() }
                    }
                } else if let failure = model.somedaySectionDeleteError {
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
                    let areas = section.text("key") == "areas"
                    VStack(spacing: 1) {
                        Button { if someday || areas { Task { await model.toggleManageSection(section.text("key")) } } } label: {
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
                        .buttonStyle(.plain).disabled(!(someday || areas) || model.busy || model.retryNeeded
                                                      || model.somedaySectionRenameIndex != nil
                                                      || model.somedaySectionRenameReadPending
                                                      || model.somedaySectionDeleteActive
                                                      || model.somedaySectionOrderActive
                                                      || model.unassignedAreaColorActive
                                                      || model.settingsAreaDeleteActive)
                        .opacity((someday || areas) ? 1 : 0.55)
                        .accessibilityValue(section.flag("open") ? "expanded" : "collapsed")
                        .accessibilityIdentifier("manage-section-toggle-" + (someday ? "someday-sections" : section.text("key")))
                        if areas && section.flag("open") {
                            unassignedAreaRow
                            if model.managedAreasTotal == 0,
                               let empty = model.manageSettings.object("areas")["empty"] as? String {
                                Text(empty).rnFont(14).foregroundStyle(palette.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                            }
                            ForEach(model.managedAreas.indices, id: \.self) { rowIndex in
                                areaRow(model.managedAreas[rowIndex], index: rowIndex)
                            }
                            if model.managedAreas.count < model.managedAreasTotal {
                                Button(model.label("common.more")) {
                                    Task { await model.loadMoreManagedAreas() }
                                }
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .disabled(model.busy || model.retryNeeded || model.manageReadError != nil
                                          || model.unassignedAreaColorActive
                                          || model.somedaySectionRenameIndex != nil
                                          || model.somedaySectionDeleteActive || model.somedaySectionOrderActive
                                          || model.settingsAreaDeleteActive)
                                .accessibilityIdentifier("manage-areas-more")
                            }
                            newAreaRow
                        }
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
                                              || model.somedaySectionDeleteActive
                                              || model.somedaySectionOrderActive
                                              || model.unassignedAreaColorActive
                                              || model.settingsAreaDeleteActive)
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

    private var unassignedAreaRow: some View {
        let row = model.manageSettings.object("areas").object("unassigned")
        return HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 6).fill(Color(hex: row.text("color")))
                .frame(width: 24, height: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.text("label")).rnFont(15, .semibold).foregroundStyle(palette.text)
                Text(row.text("description")).rnFont(12).foregroundStyle(palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button { Task { await model.openUnassignedAreaColor() } } label: {
                Image(systemName: "pencil").font(.system(size: 18))
                    .foregroundStyle(palette.secondary).frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.busy || model.retryNeeded || model.manageReadError != nil
                      || model.unassignedAreaColorActive || model.somedaySectionRenameIndex != nil
                      || model.somedaySectionDeleteActive || model.somedaySectionOrderActive
                      || model.settingsAreaDeleteActive)
            .accessibilityLabel(model.label("common.edit") + ": " + row.text("label"))
            .accessibilityIdentifier("manage-unassigned-color")
        }
        .padding(.horizontal, 12).frame(minHeight: 56)
    }

    private func areaRow(_ row: CoreObject, index: Int) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 6).fill(Color(hex: row.text("color")))
                .frame(width: 24, height: 24).accessibilityHidden(true)
            Text(row.text("name")).rnFont(15).foregroundStyle(palette.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                .accessibilityIdentifier("manage-area-name-\(index)")
            Button {} label: {
                Image(systemName: "pencil").font(.system(size: 18)).foregroundStyle(palette.secondary)
                    .frame(width: 44, height: 44)
            }
            .disabled(true).accessibilityLabel(model.label("common.edit") + ": " + row.text("name"))
            .accessibilityIdentifier("manage-area-edit-\(index)")
            Button {
                Task {
                    await model.openSettingsAreaDelete(index: index)
                    presentAreaDeleteConfirmationIfReady()
                }
            } label: {
                Image(systemName: "trash").font(.system(size: 18)).foregroundStyle(palette.danger)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.busy || model.retryNeeded || model.manageReadError != nil
                      || model.settingsAreaDeleteActive || model.settingsAreaCreatePresented
                      || model.unassignedAreaColorActive || model.somedaySectionDeleteActive
                      || model.somedaySectionOrderActive || model.somedaySectionRenameIndex != nil)
            .accessibilityLabel(model.label("common.delete") + ": " + row.text("name"))
            .accessibilityIdentifier("manage-area-delete-\(index)")
        }
        .padding(.horizontal, 12).frame(minHeight: 52)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("manage-area-row-\(index)")
    }

    private var newAreaRow: some View {
        let row = model.manageSettings.object("areas").object("newArea")
        return HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 6).fill(Color(hex: row.text("color")))
                .frame(width: 24, height: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.text("label")).rnFont(15, .semibold).foregroundStyle(palette.text)
                Text(row.text("hint")).rnFont(12).foregroundStyle(palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(row.text("addLabel")) { Task { await model.openSettingsAreaCreate() } }
                .disabled(model.busy || model.retryNeeded || model.manageReadError != nil
                          || model.settingsAreaCreatePresented || model.unassignedAreaColorActive
                          || model.somedaySectionRenameIndex != nil || model.somedaySectionDeleteActive
                          || model.somedaySectionOrderActive || model.settingsAreaDeleteActive)
                .frame(minWidth: 86, minHeight: 44)
                .accessibilityLabel(row.text("label"))
                .accessibilityIdentifier("manage-area-add")
        }
        .padding(.horizontal, 12).frame(minHeight: 56)
    }

    private var newAreaSheet: some View {
        let copy = model.manageSettings.object("editor").object("text").object("newArea")
        let colors = model.manageSettings.object("editor").objects("colors")
        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    TextField(copy.text("namePlaceholder"), text: Binding(
                        get: { model.areaCreateName }, set: { model.setAreaCreateName($0) }))
                        .focused($areaNameFocused).submitLabel(.done)
                        .onSubmit { areaNameFocused = false }
                        .rnFont(16).padding(.horizontal, 12).frame(minHeight: 48)
                        .background(palette.input, in: RoundedRectangle(cornerRadius: 10))
                        .disabled(!model.settingsAreaCreateInputEnabled)
                        .accessibilityLabel(copy.text("namePlaceholder"))
                        .accessibilityIdentifier("manage-area-create-name")
                    if model.areaCreateNameTaken {
                        Text(copy.text("nameTaken")).rnFont(13).foregroundStyle(palette.danger)
                            .accessibilityIdentifier("manage-area-create-name-taken")
                    }
                    Text(copy.text("changeColor")).rnFont(14, .semibold)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: 12)], spacing: 12) {
                        ForEach(colors.indices, id: \.self) { index in
                            let choice = colors[index]
                            let selected = model.areaCreateColor == choice.text("color")
                            Button { model.selectAreaCreateColor(choice.text("color")) } label: {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color(hex: choice.text("color")))
                                    .frame(minWidth: 48, minHeight: 48)
                                    .overlay {
                                        if selected {
                                            Image(systemName: "checkmark").font(.system(size: 17, weight: .bold))
                                                .foregroundStyle(.white)
                                        }
                                    }
                            }
                            .buttonStyle(.plain).disabled(!model.settingsAreaCreateInputEnabled)
                            .accessibilityLabel(copy.text("changeColor") + ": " + choice.text("color"))
                            .accessibilityAddTraits(selected ? .isSelected : [])
                            .accessibilityIdentifier("manage-area-create-color-\(index)")
                        }
                    }
                    if let failure = model.areaCreateError ?? model.areaCreateReadError {
                        errorBlock(failure, id: "manage-area-create-error", retryID: "manage-area-create-retry") {
                            Task {
                                if model.retryNeeded { await model.retry() }
                                else { await model.retrySettingsAreaCreateRead() }
                            }
                        }
                    }
                    HStack(spacing: 12) {
                        Button { areaNameFocused = false; model.cancelSettingsAreaCreate() } label: {
                            Text(copy.text("cancelLabel"))
                                .frame(maxWidth: .infinity, minHeight: 48).contentShape(Rectangle())
                        }
                        .disabled(!model.settingsAreaCreateCanCancel)
                        .accessibilityIdentifier("manage-area-create-cancel")
                        Button { areaNameFocused = false; Task { await model.addArea() } } label: {
                            Text(copy.text("saveLabel"))
                                .foregroundStyle(palette.onTint)
                                .frame(maxWidth: .infinity, minHeight: 48).contentShape(Rectangle())
                        }
                        .buttonStyle(.borderedProminent).tint(palette.tint)
                        .disabled(!model.settingsAreaCreateCanSave)
                        .accessibilityIdentifier("manage-area-create-save")
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(copy.text("title"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(!model.settingsAreaCreateCanCancel)
    }

    private var unassignedAreaColorSheet: some View {
        let editor = model.manageSettings.object("editor")
        let copy = editor.object("text").object("unassignedArea")
        let colors = editor.objects("colors")
        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: 12)], spacing: 12) {
                        ForEach(colors.indices, id: \.self) { index in
                            let choice = colors[index]
                            let selected = model.unassignedAreaColorDraft == choice.text("color")
                            Button { model.selectUnassignedAreaColor(choice.text("color")) } label: {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color(hex: choice.text("color")))
                                    .frame(minWidth: 48, minHeight: 48)
                                    .overlay {
                                        if selected {
                                            Image(systemName: "checkmark").font(.system(size: 17, weight: .bold))
                                                .foregroundStyle(.white)
                                        }
                                    }
                            }
                            .buttonStyle(.plain).disabled(!model.unassignedAreaColorCanSave)
                            .accessibilityLabel(choice.text("label"))
                            .accessibilityAddTraits(selected ? .isSelected : [])
                            .accessibilityIdentifier("manage-unassigned-color-option-\(index)")
                        }
                    }
                    if let failure = model.unassignedAreaColorError {
                        errorBlock(failure, id: "manage-unassigned-color-error",
                                   retryID: "manage-unassigned-color-retry") {
                            Task { await model.retryUnassignedAreaColor() }
                        }
                    }
                    HStack(spacing: 12) {
                        Button { model.cancelUnassignedAreaColor() } label: {
                            Text(copy.text("cancelLabel"))
                                .frame(maxWidth: .infinity, minHeight: 48).contentShape(Rectangle())
                        }
                            .disabled(model.busy || model.retryNeeded || model.unassignedAreaColorAwaitingRefresh)
                            .accessibilityIdentifier("manage-unassigned-color-cancel")
                        Button { Task { await model.saveUnassignedAreaColor() } } label: {
                            Text(copy.text("saveLabel"))
                                .foregroundStyle(palette.onTint)
                                .frame(maxWidth: .infinity, minHeight: 48).contentShape(Rectangle())
                        }
                            .buttonStyle(.borderedProminent)
                            .tint(palette.tint)
                            .disabled(!model.unassignedAreaColorCanSave)
                            .accessibilityIdentifier("manage-unassigned-color-save")
                    }
                }
                .padding(20)
            }
            .navigationTitle(copy.text("title"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(model.busy || model.retryNeeded || model.unassignedAreaColorAwaitingRefresh)
    }

    private func somedayRow(index: Int) -> some View {
        let row = model.managedSomedaySections[index]
        let editing = model.somedaySectionRenameIndex == index
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .trailing, spacing: 4))
            : AnyLayout(HStackLayout(spacing: 8))
        return Group {
            if editing {
                HStack(spacing: 8) {
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
                }
            } else {
                layout {
                    Text(row.text("title")).rnFont(15).foregroundStyle(palette.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .accessibilityIdentifier("manage-someday-title-\(index)")
                    HStack(spacing: 8) {
                        orderButton(row: row, index: index, offset: -1)
                        orderButton(row: row, index: index, offset: 1)
                        Button { Task { await model.openSomedaySectionRename(index: index); renameFocused = true } } label: {
                            Image(systemName: "pencil").font(.system(size: 18))
                                .foregroundStyle(palette.secondary).frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).disabled(model.busy || model.retryNeeded || model.manageReadError != nil
                                                      || model.somedaySectionRenameReadPending || model.somedaySectionRenameIndex != nil
                                                      || model.somedaySectionDeleteActive || model.somedaySectionOrderActive)
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
                                                      || model.somedaySectionDeleteActive || model.somedaySectionOrderActive)
                        .accessibilityLabel(row.text("deleteLabel"))
                        .accessibilityIdentifier("manage-someday-delete-\(index)")
                    }
                }
            }
        }
        .padding(.horizontal, 12).frame(minHeight: 52)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(row.text("title"))
        .accessibilityIdentifier("manage-someday-row-\(index)")
    }

    private func orderButton(row: CoreObject, index: Int, offset: Int) -> some View {
        let up = offset == -1
        let control = row.object(up ? "moveUp" : "moveDown")
        let disabled = control.flag("disabled") || model.busy || model.retryNeeded
            || model.manageReadError != nil || model.somedaySectionRenameReadPending
            || model.somedaySectionRenameIndex != nil || model.somedaySectionDeleteActive
            || model.somedaySectionOrderActive
        return Button { Task { await model.moveManagedSomedaySection(index: index, offset: offset) } } label: {
            Image(systemName: up ? "chevron.up" : "chevron.down")
                .font(.system(size: 18)).foregroundStyle(palette.secondary)
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(disabled).opacity(disabled ? 0.45 : 1)
        .accessibilityLabel(control.text("label"))
        .accessibilityIdentifier("manage-someday-\(up ? "up" : "down")-\(index)")
    }

    private func presentSomedayDeleteConfirmationIfReady() {
        guard model.somedaySectionDeleteCanConfirm else { return }
        deleteConfirmAnswered = false
        deleteConfirmPresented = true
    }

    private func presentAreaDeleteConfirmationIfReady() {
        guard model.settingsAreaDeleteCanConfirm else { return }
        areaDeleteConfirmAnswered = false
        areaDeleteConfirmPresented = true
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
