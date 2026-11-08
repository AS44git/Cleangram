package com.cleancut.gram

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout

enum class Tab(val icon: Int, val label: String) {
    MESSAGES(R.drawable.ic_tab_messages, "Messages"),
    PROFILE(R.drawable.ic_tab_profile, "Profile"),
}

/** Cleangram's own bottom bar (Instagram's is hidden): Messages and Profile, like Cleancutgram. */
@SuppressLint("ViewConstructor")
class TabBar(
    context: Context,
    private val onTap: (Tab) -> Unit,
    private val onLongPress: (Tab) -> Boolean,
) : LinearLayout(context) {
    private val icons = HashMap<Tab, ImageView>()
    private var selected: Tab? = null
    private val row = LinearLayout(context)

    init {
        orientation = VERTICAL
        setBackgroundColor(context.getColor(R.color.bar))
        addView(View(context).apply { setBackgroundColor(context.getColor(R.color.divider)) },
            LayoutParams(LayoutParams.MATCH_PARENT, 1))
        row.orientation = HORIZONTAL
        addView(row, LayoutParams(LayoutParams.MATCH_PARENT, dp(50)))
        for (tab in Tab.entries) {
            val icon = ImageView(context).apply {
                setImageResource(tab.icon)
                contentDescription = tab.label
            }
            icons[tab] = icon
            val cell = FrameLayout(context).apply {
                addView(icon, FrameLayout.LayoutParams(dp(26), dp(26), Gravity.CENTER))
                background = RippleDrawable(ColorStateList.valueOf(0x22888888), null, null)
                isClickable = true
                setOnClickListener {
                    it.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                    select(tab)
                    onTap(tab)
                }
                setOnLongClickListener { onLongPress(tab) }
            }
            row.addView(cell, LayoutParams(0, LayoutParams.MATCH_PARENT, 1f))
        }
        select(null)
    }

    fun select(tab: Tab?) {
        selected = tab
        for ((t, icon) in icons) {
            val on = t == tab
            icon.imageTintList = ColorStateList.valueOf(context.getColor(if (on) R.color.icon else R.color.icon_muted))
            icon.animate().scaleX(if (on) 1.08f else 1f).scaleY(if (on) 1.08f else 1f).setDuration(120).start()
        }
    }

    fun setBottomInset(px: Int) {
        if (paddingBottom != px) setPadding(0, 0, 0, px)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
