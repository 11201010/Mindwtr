package tech.dongdongbh.mindwtr.androidwidget

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class CaptureIntentConfigStoreTest {
  private class FakePersistence(
    var raw: String? = null,
    private val discardWrites: Boolean = false,
  ) : CaptureIntentConfigPersistence {
    var deleteCalls = 0

    override fun read(): String? = raw

    override fun write(raw: String) {
      if (!discardWrites) this.raw = raw
    }

    override fun delete() {
      deleteCalls += 1
      raw = null
    }
  }

  @Test
  fun returnsEnabledOnlyAfterTheTokenReadsBackExactly() {
    val storage = FakePersistence()
    val token = "12".repeat(32)

    val result = CaptureIntentConfigStore.setEnabled(storage, enabled = true) { token }

    assertEquals(CaptureIntentConfig(enabled = true, token = token), result)
    assertEquals(result, CaptureIntentConfigStore.read(storage))
  }

  @Test
  fun failsClosedWhenAWriteReturnsButReadbackDoesNotMatch() {
    val storage = FakePersistence(discardWrites = true)

    assertThrows(IOException::class.java) {
      CaptureIntentConfigStore.setEnabled(storage, enabled = true) { "34".repeat(32) }
    }

    assertEquals(1, storage.deleteCalls)
    assertNull(storage.raw)
  }

  @Test
  fun disablingRevokesAnUnreadableConfigWithoutParsingItFirst() {
    val storage = FakePersistence(raw = "{not-json")

    val result = CaptureIntentConfigStore.setEnabled(storage, enabled = false) { error("must not generate") }

    assertEquals(CaptureIntentConfig.DISABLED, result)
    assertEquals(1, storage.deleteCalls)
    assertNull(storage.raw)
  }
}
