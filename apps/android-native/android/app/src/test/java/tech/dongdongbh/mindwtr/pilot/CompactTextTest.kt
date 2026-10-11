package tech.dongdongbh.mindwtr.pilot

import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** RN's CompactText (constants/text-scale.ts): a control label grows with the system font scale up to 1.2x, no further. */
class CompactTextTest {
    @Test fun aLabelGrowsWithTheFontScaleUpToTheCap() {
        assertEquals(1f, compactFontFactor(1f), 0.0001f)
        assertEquals(1f, compactFontFactor(1.2f), 0.0001f)
        assertEquals(1f, compactFontFactor(0.85f), 0.0001f)
    }

    @Test fun pastTheCapTheLabelStaysAt1Point2x() {
        // fontScale x factor = 1.2: the label shows at RN's capped size.
        assertEquals(1.2f, 2f * compactFontFactor(2f), 0.0001f)
        assertEquals(1.2f, 1.5f * compactFontFactor(1.5f), 0.0001f)
    }

    /**
     * Android 14's font scale is not linear: a large sp grows less than the scale. A stand-in for it: past 10 sp, each sp
     * grows at half the scale.
     */
    private class NonlinearDensity(override val fontScale: Float) : Density {
        override val density = 2.625f
        override fun TextUnit.toDp(): Dp = Dp(if (value <= 10f) value * fontScale else 10f * fontScale + (value - 10f) * (1f + (fontScale - 1f) / 2f))
        override fun Dp.toSp(): TextUnit {
            val small = 10f * fontScale
            return (if (value <= small) value / fontScale else 10f + (value - small) / (1f + (fontScale - 1f) / 2f)).sp
        }
    }

    @Test fun theLineHeightIsRnsUncappedSpLineHeight() {
        // RN (backendOptionText, lineHeight 17): the line height takes the system's sp scale uncapped while the size stops at
        // 1.2x (S23 at 2.0: 17 sp is 31 dp, the pill's content). Compose scales an sp line height with its font size's ratio,
        // so the line height is given in em of the shown size.
        for (scale in listOf(1f, 1.3f, 2f)) {
            val density = NonlinearDensity(scale)
            val style = rnText(13, 700, 17).compact(density)
            val rn = with(density) { 17.sp.toDp() }.value
            assertTrue("font scale $scale", style.lineHeight.isEm)
            assertEquals("font scale $scale", rn, style.lineHeight.value * with(density) { style.fontSize.toDp() }.value, 0.01f)
        }
        // RN's single line keeps its whole line height (RN's pill is its padding and border around the whole line): Compose's default trims a
        // single line's spacing above and below, so the pill would shrink to the glyphs.
        assertEquals(LineHeightStyle.Trim.None, rnText(13, 700, 17).compact(NonlinearDensity(1f)).lineHeightStyle?.trim)
        // The size stays capped: 13 sp shown at 1.2x the base, whatever the scale.
        assertEquals(13f * 1.2f / 2f, rnText(13, 700, 17).compact(NonlinearDensity(2f)).fontSize.value, 0.01f)
    }
}
