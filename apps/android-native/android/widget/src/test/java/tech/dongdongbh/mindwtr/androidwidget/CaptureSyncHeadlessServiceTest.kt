package tech.dongdongbh.mindwtr.androidwidget

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
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
    context.getSharedPreferences(CheckoffStore.COMMITTED_PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
    File(context.filesDir, PendingCaptureWriter.DIRECTORY).deleteRecursively()
    PendingCheckoffStore(context).write(emptyMap())
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
  fun aCheckOffRnsSweepQueuesStartsTheHookAndAPruneDoesNot() {
    CaptureSyncHeadlessService.install(context) { started += it }
    PendingCheckoffStore(context).write(mapOf("task-1" to 0L))
    val swept = CheckoffStore.sweep(context, now = 10_000L)
    assertEquals(1, swept.newlyCommitted)
    assertEquals(1, File(context.filesDir, PendingCaptureWriter.DIRECTORY).list()!!.size)
    assertEquals("the queued check-off starts the drain", 1, started.size)
    CheckoffStore.prune(context, emptySet())
    assertEquals("a prune (the app stored it) starts nothing", 1, started.size)
    CheckoffStore.sweep(context, now = 20_000L)
    assertEquals("a sweep with nothing new starts nothing", 1, started.size)
  }
}
