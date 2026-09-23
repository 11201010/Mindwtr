package tech.dongdongbh.mindwtr.pilot

import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/*
 * The lucide icons the React Native app uses (lucide-react-native 0.556.0), built
 * from lucide's own 24x24 path data: stroke 2 unless RN sets another, round caps
 * and joins, no fill. Only the icons this app shows are here.
 *
 * Lucide is ISC licensed:
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of
 * Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2025.
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS"
 * AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE
 * LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF
 * CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH
 * THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/** Lucide's `<circle>` as a path. */
private fun circle(cx: Int, cy: Int, r: Int) = "M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0"

private fun lucide(name: String, vararg paths: String, stroke: Float = 2f, filled: Boolean = false): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        for (path in paths) {
            addPath(
                addPathNodes(path), fill = if (filled) SolidColor(ICON_MASK) else null, stroke = SolidColor(ICON_MASK),
                strokeLineWidth = stroke, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
            )
        }
    }.build()

private const val STAR = "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 " +
    ".294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 " +
    "0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 " +
    "2.122 0 0 0 1.597-1.16z"

object Lucide {
    val Target = lucide("Target", circle(12, 12, 10), circle(12, 12, 6), circle(12, 12, 2))
    val Inbox = lucide("Inbox", "M22 12L16 12L14 15L10 15L8 12L2 12",
        "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z")
    val Folder = lucide("Folder",
        "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z")
    /** RN's capture button draws Plus at stroke 3. */
    val Plus = lucide("Plus", "M5 12h14", "M12 5v14", stroke = 3f)
    val Check = lucide("Check", "M20 6 9 17l-5-5")
    val Circle = lucide("Circle", circle(12, 12, 10))
    val Star = lucide("Star", STAR)
    val StarFilled = lucide("StarFilled", STAR, filled = true)
    val TriangleAlert = lucide("TriangleAlert", "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
        "M12 9v4", "M12 17h.01", stroke = 2.5f)
    val ChevronLeft = lucide("ChevronLeft", "m15 18-6-6 6-6")
    val ChevronDown = lucide("ChevronDown", "m6 9 6 6 6-6", stroke = 2.2f)
    val ChevronRight = lucide("ChevronRight", "m9 18 6-6-6-6", stroke = 2.2f)
    val X = lucide("X", "M18 6 6 18", "m6 6 12 12")
}
