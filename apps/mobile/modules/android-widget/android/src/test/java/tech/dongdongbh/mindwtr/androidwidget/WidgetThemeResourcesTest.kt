package tech.dongdongbh.mindwtr.androidwidget

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetThemeResourcesTest {
  @Test
  fun systemHeaderUsesTheOpaqueDayNightWidgetSurface() {
    val band = resource("drawable/mindwtr_widget_band.xml")
    val chevron = resource("drawable/mindwtr_widget_chevron.xml")

    assertTrue(band.contains("@color/mindwtr_widget_background"))
    assertFalse(band.contains("mindwtr_widget_header_wash"))
    assertTrue(chevron.contains("@color/mindwtr_widget_muted_text"))
  }

  @Test
  fun customHeaderUsesBackgroundAndMutedTextWithoutAlphaWash() {
    val palette = WidgetPayload.Palette(
      background = 0xFFF7EEDB.toInt(),
      card = 0xFFFFFAEF.toInt(),
      text = 0xFF342A20.toInt(),
      mutedText = 0xFF7B6A58.toInt(),
      accent = 0xFFA56A28.toInt(),
      onAccent = 0xFFFFFFFF.toInt(),
      border = 0xFFD9C9B1.toInt(),
      warning = 0xFFB45309.toInt(),
    )

    assertEquals(
      WidgetRenderer.TasksTheme(headerSurface = 0xFFF7EEDB.toInt(), chevron = 0xFF7B6A58.toInt()),
      WidgetRenderer.tasksTheme(palette),
    )
  }

  @Test
  fun tasksLayoutKeepsSeparateTitleAndFortyFourDpChooserTargets() {
    val layout = resource("layout/mindwtr_widget.xml")

    assertTrue(layout.contains("android:id=\"@+id/mindwtr_widget_title_target\""))
    assertTrue(layout.contains("android:id=\"@+id/mindwtr_widget_chooser\""))
    assertTrue(layout.contains("android:layout_width=\"44dp\""))
    assertFalse(layout.contains("android:drawableEnd=\"@drawable/mindwtr_widget_chevron\""))
  }

  private fun resource(path: String): String = File("src/main/res/$path").readText()
}
