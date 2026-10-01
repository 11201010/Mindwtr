package tech.dongdongbh.mindwtr.pilot

import android.app.Application
import tech.dongdongbh.mindwtr.androidwidget.CaptureSyncHeadlessService

/**
 * Sets, before any component of this process runs, the hook through which RN's widget module (the quick capture dialog, the
 * capture intent receiver, a widget check-off queued by RN's CheckoffStore) has the pending-captures queue stored now: CoreWork's
 * ingest job, where RN started its headless task.
 */
class MindwtrApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        CaptureSyncHeadlessService.install(this) { context -> CoreWork.enqueue(context, CoreJob.INGEST) }
    }
}
