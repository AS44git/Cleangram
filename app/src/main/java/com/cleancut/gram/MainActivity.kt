package com.cleancut.gram

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.material.progressindicator.LinearProgressIndicator
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Cleangram: Instagram's own website, full screen, as an app, laid out like Cleancutgram:
 * Stories along the top of your messages, and two tabs, Messages and Profile. No feed, no
 * Reels, no Explore.
 *
 * Every request is made by Instagram's website code, as in any browser; the app only watches
 * which page is showing and adds a stylesheet (assets/cleangram.js). The Stories row is read
 * from Instagram's Home page, open in a second view nobody sees (assets/stories-read.js), and
 * handed to the inbox page as data. Nothing is exposed to the pages: no JavaScript bridge.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var tray: WebView
    private lateinit var refresh: SwipeRefreshLayout
    private lateinit var progress: LinearProgressIndicator
    private lateinit var splash: View
    private lateinit var bar: TabBar

    private var route = Route.OTHER
    private var path = "/"
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var fullscreen: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var lastRedirect = 0L
    private var redirects = 0
    private var loadStarted = 0L
    private var trayLoaded = 0L
    private var stories: String? = null
    private var trayGen = 0
    private var trayReads = 0
    private var trayBlocked: String? = null
    private var storiesFound = 0

    private val prefs by lazy { getSharedPreferences("cleangram", MODE_PRIVATE) }
    private val pageScript by lazy {
        val css = assets.open("cleangram.css").bufferedReader().readText()
        assets.open("cleangram.js").bufferedReader().readText()
            .replace("\"__CLEANGRAM_CSS__\"", JSONObject.quote(css))
    }
    private val readStoriesJs by lazy { assets.open("stories-read.js").bufferedReader().readText() }

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val request = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        val allowed = request.resources.filter { res ->
            when (res) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> granted[Manifest.permission.CAMERA] == true || hasPermission(Manifest.permission.CAMERA)
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> granted[Manifest.permission.RECORD_AUDIO] == true || hasPermission(Manifest.permission.RECORD_AUDIO)
                else -> false
            }
        }
        if (allowed.isEmpty()) request.deny() else request.grant(allowed.toTypedArray())
    }

    // --- setup -------------------------------------------------------------------------------

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        web = WebView(this)
        // Instagram's Home page, read for its Stories row: full size (so it lays out like a phone's)
        // but underneath everything, never seen or touched.
        tray = WebView(this).apply {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            isFocusable = false
            setOnTouchListener { _, _ -> true }
        }
        refresh = SwipeRefreshLayout(this).apply {
            addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            setColorSchemeColors(getColor(R.color.accent))
            setProgressBackgroundColorSchemeColor(getColor(R.color.bar))
            setOnChildScrollUpCallback { _, _ -> route != Route.PROFILE || web.scrollY > 0 }
            setOnRefreshListener {
                web.reload()
                postDelayed({ isRefreshing = false }, 1500)
            }
        }
        bar = TabBar(this, ::onTab, ::onTabLongPress)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(getColor(R.color.bg))
            isClickable = true
            addView(refresh, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        progress = LinearProgressIndicator(this).apply {
            isIndeterminate = false
            max = 100
            trackThickness = dp(2)
            setIndicatorColor(getColor(R.color.accent))
            trackColor = 0
            visibility = View.GONE
        }
        splash = FrameLayout(this).apply {
            setBackgroundColor(getColor(R.color.bg))
            addView(ImageView(context).apply { setImageResource(R.mipmap.ic_launcher) },
                FrameLayout.LayoutParams(dp(84), dp(84), Gravity.CENTER))
            isClickable = true
        }
        root = FrameLayout(this).apply {
            setBackgroundColor(getColor(R.color.bg))
            addView(tray, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(column)
            addView(progress, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
            addView(splash)
        }
        setContentView(root)

        // Edge to edge: content below the status bar, the tab bar above the navigation bar,
        // and the page lifting with the keyboard (the tab bar steps aside for it).
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val keyboard = ime.bottom > sys.bottom
            (progress.layoutParams as FrameLayout.LayoutParams).topMargin = sys.top
            bar.visibility = if (keyboard) View.GONE else View.VISIBLE
            bar.setBottomInset(sys.bottom)
            column.setPadding(sys.left, sys.top, sys.right, if (keyboard) ime.bottom else 0)
            WindowInsetsCompat.CONSUMED
        }
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = !night
            isAppearanceLightNavigationBars = !night
        }

        configure(web)
        configure(tray)
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)
        setUpMain()
        setUpTray()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    fullscreen != null -> web.webChromeClient?.onHideCustomView()
                    web.canGoBack() -> web.goBack()
                    else -> moveTaskToBack(true)
                }
            }
        })

        val link = intent?.data?.takeIf { Routes.isInstagram(it.host) }?.toString()
        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) {
            hideSplash()
        } else {
            web.loadUrl(link ?: Routes.ORIGIN + Routes.INBOX)
        }
    }

    /** Both views: a plain mobile Chrome to Instagram, its own dark theme, logged in alike. */
    @SuppressLint("SetJavaScriptEnabled")
    private fun configure(w: WebView) {
        val s = w.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.allowFileAccess = false
        s.allowContentAccess = true
        s.setSupportMultipleWindows(false)
        s.setGeolocationEnabled(false)
        s.textZoom = 100
        s.userAgentString = WebSettings.getDefaultUserAgent(this)
            .replace("; wv", "")
            .replace(Regex(" Version/\\d+(\\.\\d+)*"), "")
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false)
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(w, true)
        }
        w.overScrollMode = View.OVER_SCROLL_NEVER
        w.isVerticalScrollBarEnabled = false
        w.isHorizontalScrollBarEnabled = false
        w.setBackgroundColor(getColor(R.color.bg))
    }

    private fun setUpMain() {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            val origins = setOf(Routes.ORIGIN, "https://instagram.com")
            WebViewCompat.addDocumentStartJavaScript(web, pageScript, origins)
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                return handleLink(request.url)
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                loadStarted = SystemClock.elapsedRealtime()
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    view.evaluateJavascript(pageScript, null)
                }
                onAddress(url)
            }

            override fun onPageCommitVisible(view: WebView, url: String?) {
                // The page has painted: lift the splash a moment later, once it's settled.
                view.postDelayed({ hideSplash() }, 250)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                refresh.isRefreshing = false
                progress.visibility = View.GONE
                hideSplash()
                learnProfile()
                pushStories()
                if (trayLoaded == 0L) view.postDelayed({ loadTray() }, 700)
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                onAddress(url)   // also Instagram's in-page navigations (history.pushState)
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                // Only for loads that take a while: quick ones shouldn't flicker a bar.
                val slow = SystemClock.elapsedRealtime() - loadStarted > 450
                progress.visibility = if (newProgress in 1..95 && slow) View.VISIBLE else View.GONE
                if (progress.visibility == View.VISIBLE) progress.setProgressCompat(newProgress, true)
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFiles.launch(params.createIntent().apply {
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                    })
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                val needed = request.resources.mapNotNull {
                    when (it) {
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                        else -> null
                    }
                }
                if (needed.isEmpty()) { request.deny(); return }
                runOnUiThread {
                    pendingPermission?.deny()
                    pendingPermission = request
                    askPermissions.launch(needed.toTypedArray())
                }
            }

            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                fullscreen?.let { onHideCustomView() }
                fullscreen = view
                fullscreenCallback = callback
                root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                WindowCompat.getInsetsController(window, root).hide(WindowInsetsCompat.Type.systemBars())
            }

            override fun onHideCustomView() {
                fullscreen?.let { root.removeView(it) }
                fullscreen = null
                fullscreenCallback?.onCustomViewHidden()
                fullscreenCallback = null
                WindowCompat.getInsetsController(window, root).show(WindowInsetsCompat.Type.systemBars())
            }
        }

        web.setDownloadListener { url, userAgent, disposition, mime, _ ->
            if (!url.startsWith("http")) return@setDownloadListener
            runCatching {
                val name = URLUtil.guessFileName(url, disposition, mime)
                val req = DownloadManager.Request(Uri.parse(url))
                    .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                    .addRequestHeader("User-Agent", userAgent)
                    .setMimeType(mime)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "Cleangram/$name")
                getSystemService(DownloadManager::class.java).enqueue(req)
                toast("Downloading $name")
            }
        }
    }

    // --- the Stories row ---------------------------------------------------------------------

    private fun setUpTray() {
        stories = prefs.getString("stories", null)   // last time's row, shown until it's fresh
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(tray, pageScript, setOf(Routes.ORIGIN, "https://instagram.com"))
        }
        tray.webViewClient = object : WebViewClient() {
            // Only ever Instagram's Home page here: it goes nowhere else (nobody taps this view).
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame || Routes.classify(request.url.toString()) == Route.HOME) return false
                trayBlocked = request.url.path
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    view.evaluateJavascript(pageScript, null)
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                readStories(trayGen, 0)
            }
        }
    }

    private fun loadTray() {
        trayLoaded = SystemClock.elapsedRealtime()
        trayGen++
        tray.onResume()
        tray.loadUrl(Routes.ORIGIN + Routes.HOME)
    }

    /** Freshen the row now and then, when you're on your messages. */
    private fun freshenTray() {
        if (trayLoaded != 0L && SystemClock.elapsedRealtime() - trayLoaded > 3 * 60_000) loadTray()
    }

    /** Read the Stories row off the Home page: soon after it loads, then every half minute. */
    private fun readStories(gen: Int, attempt: Int) {
        if (isFinishing || gen != trayGen) return
        tray.evaluateJavascript(readStoriesJs) { value ->
            trayReads++
            val json = runCatching { JSONTokener(value).nextValue() as? String }.getOrNull()
            if (!json.isNullOrEmpty()) {
                storiesFound = runCatching { org.json.JSONArray(json).length() }.getOrDefault(0)
                if (json != stories) {
                    stories = json
                    prefs.edit().putString("stories", json).apply()
                    pushStories()
                }
                tray.postDelayed({ readStories(gen, attempt + 1) }, 30_000)
            } else if (attempt < 30) {
                tray.postDelayed({ readStories(gen, attempt + 1) }, 800)
            }
        }
    }

    /** The row's data, to the inbox page (it draws the row itself). */
    private fun pushStories() {
        val json = stories ?: return
        web.evaluateJavascript("document.documentElement.setAttribute('data-cg-stories',${JSONObject.quote(json)})", null)
    }

    // --- pages -------------------------------------------------------------------------------

    /** Every address change, full loads and in-page ones alike. */
    private fun onAddress(url: String?) {
        val r = Routes.classify(url)
        if (r == Route.OUTSIDE || url?.startsWith("about:") == true) return
        val redirect = Routes.redirectFor(r)
        if (redirect != null && allowRedirect()) {
            go(redirect)
            if (r == Route.REELS) toast("Reels are off")
            return
        }
        route = r
        path = url?.let { Uri.parse(it).path } ?: "/"
        web.evaluateJavascript("document.documentElement.setAttribute('data-cg-route','${r.css}')", null)
        prefs.getString("me", null)?.let { me ->
            web.evaluateJavascript("document.documentElement.setAttribute('data-cg-me',${JSONObject.quote(me)})", null)
        }
        if (prefs.getString("me", null) == null) web.postDelayed({ learnProfile() }, 1200)
        if (prefs.getBoolean("noflow", false)) {
            web.evaluateJavascript("document.documentElement.setAttribute('data-cg-noflow','1')", null)
        }
        if (r == Route.INBOX) { pushStories(); freshenTray() }
        bar.select(
            when (r) {
                Route.INBOX -> Tab.MESSAGES
                Route.PROFILE -> if (Routes.profileName(path) == prefs.getString("me", null)) Tab.PROFILE else null
                else -> null
            },
        )
    }

    /** Never bounce between two pages forever: at most 4 redirects in 3 seconds. */
    private fun allowRedirect(): Boolean {
        val now = SystemClock.elapsedRealtime()
        if (now - lastRedirect > 3000) redirects = 0
        lastRedirect = now
        return ++redirects <= 4
    }

    /** Links: Instagram's pages stay here; "open the app" links go nowhere; the rest open in the browser. */
    private fun handleLink(uri: Uri): Boolean {
        val scheme = uri.scheme ?: return true
        if (scheme != "http" && scheme != "https") return true      // intent://, instagram://: never the app
        val host = uri.host ?: return true
        if (host == "l.instagram.com") {
            uri.getQueryParameter("u")?.let { openOutside(Uri.parse(it)) }
            return true
        }
        if (Routes.isInstagram(host) || host.endsWith("facebook.com") || host.endsWith("fbcdn.net")
            || host.endsWith("cdninstagram.com")) return false
        openOutside(uri)
        return true
    }

    private fun openOutside(uri: Uri) {
        runCatching { CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, uri) }
            .onFailure { runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) } }
    }

    /**
     * Go to a page the way a tap would: by clicking Instagram's own link to it if the page has
     * one (instant, no reload), otherwise by loading it.
     */
    private fun go(target: String) {
        val js = """
            (function(h){
              var a = Array.prototype.find.call(document.querySelectorAll('a[href]'), function(x){ return x.getAttribute('href') === h; });
              if (a) { a.click(); return "1"; }
              return "0";
            })(${JSONObject.quote(target)})
        """.trimIndent()
        web.evaluateJavascript(js) { clicked ->
            if (clicked != "\"1\"") web.loadUrl(Routes.ORIGIN + target)
        }
    }

    /** Remember which profile is yours, from Instagram's own tab bar (never anyone else's picture). */
    private fun learnProfile() {
        val js = """
            (function(){
              var imgs = document.querySelectorAll('a[href] img[alt]');
              for (var i = 0; i < imgs.length; i++) {
                if (!/profile picture/i.test(imgs[i].getAttribute('alt'))) continue;
                var a = imgs[i].closest('a');
                for (var el = a; el && el !== document.body; el = el.parentElement) {
                  if (el.classList.contains('cg-hide') || getComputedStyle(el).position === 'fixed') {
                    return a.getAttribute('href');
                  }
                }
              }
              return "";
            })()
        """.trimIndent()
        web.evaluateJavascript(js) { value ->
            val href = runCatching { JSONTokener(value).nextValue() as String }.getOrNull()
            val name = Routes.profileName(href) ?: return@evaluateJavascript
            if (prefs.getString("me", null) == null) prefs.edit().putString("me", name).apply()
        }
    }

    // --- the tab bar -------------------------------------------------------------------------

    private fun onTab(tab: Tab) {
        when (tab) {
            Tab.MESSAGES -> go(Routes.INBOX)
            Tab.PROFILE -> {
                val me = prefs.getString("me", null)
                if (me != null) go("/$me/") else {
                    learnProfile()
                    web.postDelayed({
                        prefs.getString("me", null)?.let { go("/$it/") } ?: toast("Open Messages first, then Profile")
                    }, 500)
                }
            }
        }
    }

    private fun onTabLongPress(tab: Tab): Boolean {
        if (tab != Tab.PROFILE) return false
        val noflow = prefs.getBoolean("noflow", false)
        val items = arrayOf(
            "Status (screenshot this for Claude)",
            "Save page map (for tuning)",
            "Save Home page map (Stories)",
            if (noflow) "Scroll the whole inbox together" else "Scroll only the message list (Instagram's way)",
            "Reload",
            "Open this page in the browser",
            "Forget my profile name",
        )
        AlertDialog.Builder(this)
            .setTitle("Cleangram")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> showStatus()
                    1 -> savePageMap(web, route.css)
                    2 -> savePageMap(tray, "home")
                    3 -> {
                        prefs.edit().putBoolean("noflow", !noflow).apply()
                        web.evaluateJavascript(
                            if (noflow) "document.documentElement.removeAttribute('data-cg-noflow')"
                            else "document.documentElement.setAttribute('data-cg-noflow','1')", null)
                    }
                    4 -> { web.reload(); loadTray() }
                    5 -> web.url?.let { openOutside(Uri.parse(it)) }
                    6 -> { prefs.edit().remove("me").apply(); toast("Forgotten") }
                }
            }
            .show()
        return true
    }

    /** What the inbox layout and the Stories reader are doing, in a few lines (no message text). */
    private fun showStatus() {
        val mainJs = "(function(){var h=document.documentElement;return JSON.stringify({route:h.getAttribute('data-cg-route')," +
            "flow:h.getAttribute('data-cg-flow'),info:h.getAttribute('data-cg-flowinfo'),noflow:h.hasAttribute('data-cg-noflow')," +
            "row:!!document.getElementById('cg-stories'),search:!!document.querySelector('input[placeholder*=\"Search\" i],input[aria-label*=\"Search\" i],input[type=\"search\"]')," +
            "compose:!!document.querySelector('svg[aria-label=\"New message\"]'),inputs:Array.prototype.map.call(document.querySelectorAll('input'),function(i){return i.type+':'+(i.placeholder||i.getAttribute('aria-label')||'')}).join('|')," +
            "w:innerWidth,h:innerHeight})})()"
        val trayJs = "(function(){return JSON.stringify({path:location.pathname,title:document.title," +
            "pics:document.querySelectorAll('img[alt*=\"profile picture\"]').length,imgs:document.images.length," +
            "canvases:document.querySelectorAll('canvas').length,login:!!document.querySelector('input[name=\"username\"]')," +
            "text:document.body?document.body.innerText.length:0})})()"
        web.evaluateJavascript(mainJs) { m ->
            tray.evaluateJavascript(trayJs) { t ->
                val text = buildString {
                    append("Cleangram ").append(packageManager.getPackageInfo(packageName, 0).versionName).append("\n\n")
                    append("INBOX\n").append(runCatching { JSONTokener(m).nextValue() as String }.getOrDefault(m)).append("\n\n")
                    append("STORIES\nloaded ").append(if (trayLoaded == 0L) "never" else "${(SystemClock.elapsedRealtime() - trayLoaded) / 1000}s ago")
                    append(", reads ").append(trayReads).append(", found ").append(storiesFound)
                    append(", saved ").append(if (stories == null) "none" else "yes")
                    append(", blocked ").append(trayBlocked ?: "-").append("\nhome view ").append(tray.url ?: "-").append("\n")
                    append(runCatching { JSONTokener(t).nextValue() as String }.getOrDefault(t))
                }
                AlertDialog.Builder(this)
                    .setTitle("Status")
                    .setMessage(text)
                    .setPositiveButton("OK", null)
                    .show()
                    .findViewById<android.widget.TextView>(android.R.id.message)?.apply { setTextIsSelectable(true); textSize = 12f }
            }
        }
    }

    // --- page maps ---------------------------------------------------------------------------

    private fun savePageMap(view: WebView, name: String) {
        val script = assets.open("pagemap.js").bufferedReader().readText()
        val state = "Array.prototype.filter.call(document.documentElement.attributes,function(a){" +
            "return a.name.indexOf('data-cg')===0&&a.name!=='data-cg-stories'}).map(function(a){return a.name+'='+a.value}).join(' ')"
        view.evaluateJavascript(state) { flags ->
          view.evaluateJavascript(script) { value ->
            val text = runCatching { JSONTokener(value).nextValue() as String }.getOrNull()
            if (text.isNullOrEmpty()) { toast("Couldn't read the page"); return@evaluateJavascript }
            val dir = getExternalFilesDir("pagemaps") ?: filesDir
            dir.mkdirs()
            val stamp = SimpleDateFormat("HHmmss", Locale.US).format(Date())
            val file = File(dir, "$name-$stamp.txt")
            val cg = runCatching { JSONTokener(flags).nextValue() as String }.getOrDefault("")
            file.writeText("userAgent ${view.settings.userAgentString}\ncleangram $cg\n$text")
            toast("Saved ${file.name}")
          }
        }
    }

    // --- misc --------------------------------------------------------------------------------

    private fun hideSplash() {
        if (splash.visibility != View.VISIBLE || splash.alpha < 1f) return
        splash.animate().alpha(0f).setDuration(200).withEndAction { splash.visibility = View.GONE }.start()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val data = intent.data
        if (data != null && Routes.isInstagram(data.host)) web.loadUrl(data.toString())
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        tray.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onResume() {
        super.onResume()
        if (trayLoaded != 0L) tray.onResume()
        if (route == Route.INBOX) freshenTray()
    }

    private fun hasPermission(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
