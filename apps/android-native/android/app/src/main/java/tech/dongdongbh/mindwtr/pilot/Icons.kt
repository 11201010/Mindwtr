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
    val RotateCcw = lucide("RotateCcw", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5")
    val ArrowRight = lucide("ArrowRight", "M5 12h14", "m12 5 7 7-7 7")
    val CircleDot = lucide("CircleDot", circle(12, 12, 10), circle(12, 12, 1))
    val UserRound = lucide("UserRound", circle(12, 8, 5), "M20 21a8 8 0 0 0-16 0")
    val Repeat = lucide("Repeat", "m17 2 4 4-4 4", "M3 11v-1a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3")
    val History = lucide("History", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2")
    val ListChecks = lucide("ListChecks", "M13 5h8", "M13 12h8", "M13 19h8", "m3 17 2 2 4-4", "m3 7 2 2 4-4")
    val Paperclip = lucide("Paperclip", "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551")
    val ChevronsUp = lucide("ChevronsUp", "m17 11-5-5-5 5", "m17 18-5-5-5 5")
    val ChevronsDown = lucide("ChevronsDown", "m7 6 5 5 5-5", "m7 13 5 5 5-5")
    // The task editor's field headings and controls (TaskEditFormTab and its field components).
    val Type = lucide("Type", "M12 4v16", "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2", "M9 20h6")
    val ListTodo = lucide("ListTodo", "M13 5h8", "M13 12h8", "M13 19h8", "m3 17 2 2 4-4",
        "M4 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z")
    val Layers = lucide("Layers", "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
        "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",
        "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17")
    val AtSign = lucide("AtSign", circle(12, 12, 4), "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8")
    val Tag = lucide("Tag", "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",
        "M7 7.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0-1 0")
    private const val CALENDAR = "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
    val Calendar = lucide("Calendar", "M8 2v4", "M16 2v4", CALENDAR, "M3 10h18")
    val CalendarDays = lucide("CalendarDays", "M8 2v4", "M16 2v4", CALENDAR, "M3 10h18", "M8 14h.01", "M12 14h.01", "M16 14h.01",
        "M8 18h.01", "M12 18h.01", "M16 18h.01")
    val CalendarX = lucide("CalendarX", "M8 2v4", "M16 2v4", CALENDAR, "M3 10h18", "m14 14-4 4", "m10 14 4 4")
    val CalendarClock = lucide("CalendarClock", "M16 14v2.2l1.6 1", "M16 2v4", "M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5",
        "M3 10h5", "M8 2v4", circle(16, 16, 6))
    val Clock = lucide("Clock", "M12 6v6l4 2", circle(12, 12, 10))
    val Flag = lucide("Flag", "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528")
    private const val BATTERY = "M4 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
    val BatteryCharging = lucide("BatteryCharging", "m11 7-3 5h4l-3 5", "M14.856 6H16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.935", "M22 14v-4",
        "M5.14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.936")
    val BatteryLow = lucide("BatteryLow", "M22 14v-4", "M6 14v-4", BATTERY)
    val BatteryMedium = lucide("BatteryMedium", "M10 14v-4", "M22 14v-4", "M6 14v-4", BATTERY)
    val BatteryFull = lucide("BatteryFull", "M10 10v4", "M14 10v4", "M22 14v-4", "M6 10v4", BATTERY)
    val CircleSlash = lucide("CircleSlash", circle(12, 12, 10), "M9 15 15 9")
    val Hourglass = lucide("Hourglass", "M5 22h14", "M5 2h14", "M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22",
        "M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2")
    val User = lucide("User", "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", circle(12, 7, 4))
    val AlignLeft = lucide("AlignLeft", "M21 5H3", "M15 12H3", "M17 19H3")
    val Navigation = lucide("Navigation", "M3 11 22 2 13 21 11 13z")
    /** RN's field help button draws Ionicons help-circle-outline; lucide's CircleQuestionMark is the same glyph. */
    val CircleHelp = lucide("CircleHelp", circle(12, 12, 10), "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01")
    // RN's TASK_STATUS_ICONS (lib/task-status-icons.ts): Inbox, ArrowRight, Check and these.
    val CirclePause = lucide("CirclePause", circle(12, 12, 10), "M10 15V9", "M14 15V9")
    val CircleArrowUp = lucide("CircleArrowUp", circle(12, 12, 10), "m16 12-4-4-4 4", "M12 16V8")
    val Book = lucide("Book", "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20")
    // Global search (app/global-search.tsx) and Process Inbox (inbox-processing/ and inbox.tsx).
    val Search = lucide("Search", "m21 21-4.34-4.34", circle(11, 11, 8))
    val SlidersHorizontal = lucide("SlidersHorizontal", "M10 5H3", "M12 19H3", "M14 3v4", "M16 17v4", "M21 12h-9", "M21 19h-5",
        "M21 5h-7", "M8 10v4", "M8 12H3")
    /** RN's CheckCircle (lucide CircleCheckBig). */
    val CheckCircle = lucide("CheckCircle", "M21.801 10A10 10 0 1 1 17 3.335", "m9 11 3 3L22 4")
    /** RN's CheckCircle2 (lucide CircleCheck). */
    val CheckCircle2 = lucide("CheckCircle2", circle(12, 12, 10), "m9 12 2 2 4-4")
    /** RN's XCircle (lucide CircleX). */
    val XCircle = lucide("XCircle", circle(12, 12, 10), "m15 9-6 6", "m9 9 6 6")
    val Trash2 = lucide("Trash2", "M10 11v6", "M14 11v6", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2")
    val LayoutList = lucide("LayoutList", "M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
        "M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z", "M14 4h7", "M14 9h7", "M14 15h7", "M14 20h7")
    val ChevronUp = lucide("ChevronUp", "m18 15-6-6-6 6")
    /** RN's START_LATER_ICON. */
    val Clock3 = lucide("Clock3", "M12 6v6h4", circle(12, 12, 10))
    /** RN's INCUBATE_ICON. */
    val Sprout = lucide("Sprout", "M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3",
        "M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4", "M5 21h14")
    /** RN's add-project button draws Plus at stroke 2.4. */
    val PlusMedium = lucide("PlusMedium", "M5 12h14", "M12 5v14", stroke = 2.4f)
}
