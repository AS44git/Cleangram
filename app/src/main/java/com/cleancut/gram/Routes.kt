package com.cleancut.gram

import android.net.Uri

/** What kind of Instagram page an address is. Mirrors route() in assets/cleangram.js. */
enum class Route(val css: String) {
    HOME("home"), SEARCH("search"), INBOX("inbox"), ACTIVITY("activity"), PROFILE("profile"),
    POST("post"), STORIES("stories"), REELS("reels"), EXPLORE("explore"), ACCOUNTS("accounts"),
    OTHER("other"), OUTSIDE("outside"),
}

object Routes {
    const val ORIGIN = "https://www.instagram.com"
    const val HOME = "/"
    const val INBOX = "/direct/inbox/"
    const val SEARCH = "/explore/search/"

    private val RESERVED = setOf(
        "accounts", "direct", "explore", "reels", "reel", "p", "tv", "stories", "about", "legal",
        "developer", "challenge", "emails", "web", "api", "graphql", "oauth", "privacy", "session",
        "create", "notifications", "your_activity", "settings", "ar", "topics", "locations",
    )

    fun isInstagram(host: String?): Boolean =
        host != null && (host == "instagram.com" || host.endsWith(".instagram.com"))

    fun classify(url: String?): Route {
        val uri = url?.let { runCatching { Uri.parse(it) }.getOrNull() } ?: return Route.OTHER
        if (!isInstagram(uri.host)) return Route.OUTSIDE
        val s = uri.pathSegments.filter { it.isNotEmpty() }
        if (s.isEmpty()) return Route.HOME
        return when (s[0]) {
            "direct" -> Route.INBOX
            "explore" -> if (s.getOrNull(1) == "search") Route.SEARCH else Route.EXPLORE
            "reels" -> Route.REELS
            "reel", "p", "tv" -> Route.POST
            "stories" -> Route.STORIES
            "notifications" -> Route.ACTIVITY
            "accounts" -> if (s.getOrNull(1) == "activity") Route.ACTIVITY else Route.ACCOUNTS
            else -> if (s[0] in RESERVED) Route.OTHER else Route.PROFILE
        }
    }

    /** Pages Cleangram doesn't show, and where it goes instead. */
    fun redirectFor(route: Route): String? = when (route) {
        Route.REELS -> INBOX         // the Reels feed
        Route.EXPLORE -> SEARCH      // the Explore grid, tag and place grids
        else -> null
    }

    /** "/name/" if a path is a profile's own page. */
    fun profileName(path: String?): String? {
        val s = path?.split('/')?.filter { it.isNotEmpty() } ?: return null
        if (s.size != 1 || s[0] in RESERVED) return null
        return s[0].takeIf { it.matches(Regex("[A-Za-z0-9._]{1,30}")) }
    }
}
