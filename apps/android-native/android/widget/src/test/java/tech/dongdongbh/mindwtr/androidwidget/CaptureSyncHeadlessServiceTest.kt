package tech.dongdongbh.mindwtr.androidwidget

import android.content.Context
import android.os.FileObserver
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The native stand-in for RN's headless task: what starts the app's CoreWork queue drain. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CaptureSyncHeadlessServiceTest {
  private val context = ApplicationProvider.getApplicationContext<Context>()
  private val started = mutableListOf<Context>()

  @Before
  fun clean() {
    File(context.filesDir, PendingCaptureWriter.DIRECTORY).deleteRecursively()
  }

  @After
  fun uninstall() = CaptureSyncHeadlessService.install(context, null)

  @Test
  fun theDialogsStartReachesTheAppsHookWithTheApplicationContext() {
    CaptureSyncHeadlessService.start(context)
    assertEquals("no hook yet: nothing starts, nothing throws", 0, started.size)
    CaptureSyncHeadlessService.install(context) { started += it }
    CaptureSyncHeadlessService.start(context)
    assertEquals(1, started.size)
    assertSame(context.applicationContext, started.single())
    CaptureSyncHeadlessService.install(context) { error("enqueue refused") }
    CaptureSyncHeadlessService.start(context)
  }

  @Test
  fun anItemRnsWriterPublishesInTheQueueStartsTheHook() {
    val queue = File(context.filesDir, PendingCaptureWriter.DIRECTORY)
    CaptureSyncHeadlessService.install(context) { started += it }
    assertTrue("the watched queue folder exists", queue.isDirectory)
    // RN's writer (the dialog, the capture intent receiver, a check-off's sweep) renames `<id>.tmp` to `<id>.json`.
    CaptureSyncHeadlessService.queueEvent(context, FileObserver.MOVED_TO, "a.json")
    assertEquals(1, started.size)
    CaptureSyncHeadlessService.queueEvent(context, FileObserver.CREATE, "b.tmp")
    CaptureSyncHeadlessService.queueEvent(context, FileObserver.MOVED_TO, "b.tmp")
    CaptureSyncHeadlessService.queueEvent(context, FileObserver.DELETE, "a.json")
    assertEquals("a half-written file or the drain's delete starts nothing", 1, started.size)
    CaptureSyncHeadlessService.install(context, null)
    CaptureSyncHeadlessService.queueEvent(context, FileObserver.MOVED_TO, "c.json")
    assertEquals("no hook: nothing starts", 1, started.size)
  }
}
