# Mindwtr Unreleased

Changes collected since the latest stable release.

- Mobile: a recovery snapshot taken right after the phone's clock went back is no longer deleted at once. Before, five snapshots named for the later time outranked it, so Undo on that import or restore could not find its snapshot.
- Mobile: restoring a recovery snapshot larger than the backup limit (128 MB) now stops with the backup's "file is too large" message before it is read into memory, as a picked backup file already does.
