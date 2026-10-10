package tech.dongdongbh.mindwtr.pilot

import org.junit.Assert.assertEquals
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
}
