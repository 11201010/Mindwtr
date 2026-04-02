import Foundation
import ExpoModulesCore

public class SyncPathBookmarksModule: Module {
  private var activeScopedUrl: URL?

  public func definition() -> ModuleDefinition {
    Name("SyncPathBookmarks")

    OnDestroy {
      self.stopActiveScopedAccess()
    }

    AsyncFunction("createBookmark") { (url: URL) -> String? in
      let didStartAccessing = url.startAccessingSecurityScopedResource()
      defer {
        if didStartAccessing {
          url.stopAccessingSecurityScopedResource()
        }
      }

      let bookmarkData = try url.bookmarkData(
        options: .withSecurityScope,
        includingResourceValuesForKeys: nil,
        relativeTo: nil
      )

      return bookmarkData.base64EncodedString()
    }

    AsyncFunction("resolveBookmark") { (bookmarkBase64: String) -> String? in
      guard let bookmarkData = Data(base64Encoded: bookmarkBase64) else {
        return nil
      }

      var isStale = false
      let resolvedUrl = try URL(
        resolvingBookmarkData: bookmarkData,
        options: .withSecurityScope,
        relativeTo: nil,
        bookmarkDataIsStale: &isStale
      )

      self.startActiveScopedAccess(resolvedUrl)

      return resolvedUrl.absoluteString
    }
  }

  private func startActiveScopedAccess(_ url: URL) {
    stopActiveScopedAccess()

    if url.startAccessingSecurityScopedResource() {
      activeScopedUrl = url
    }
  }

  private func stopActiveScopedAccess() {
    guard let activeScopedUrl = activeScopedUrl else {
      return
    }

    activeScopedUrl.stopAccessingSecurityScopedResource()
    self.activeScopedUrl = nil
  }
}
