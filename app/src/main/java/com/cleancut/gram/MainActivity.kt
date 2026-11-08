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
import org.json.JSONTokener
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Cleangram: Instagram's own website, full screen, as an app. No feed, no Reels, no Explore.
 *
 * Every request is made by Instagram's website code, as in any browser; the app only watches
 * which page is showing (to keep you out of the feeds and light up its own tab bar) and adds a
 * stylesheet (assets/cleangram.js). Nothing is exposed to the page: no JavaScript bridge.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var refresh: SwipeRefreshLayout
    private lateinit var progress: LinearProgressIndicator
    private lateinit var splash: View
    private lateinit var bar: TabBar

    private var route = Route.OTHER
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var fullscreen: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var lastRedirect = 0L
    private var redirects = 0

    private val prefs by lazy { getSharedPreferences("cleangram", MODE_PRIVATE) }
    private val pageScript by lazy {
        val css = assets.open("cleangram.css").bufferedReader().readText()
        assets.open("cleangram.js").bufferedReader().readText()
            .replace("\"__CLEANGRAM_CSS__\"", org.json.JSONObject.quote(css))
    }

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

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        web = WebView(this)
        refresh = SwipeRefreshLayout(this).apply {
            addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            setColorSchemeColors(getColor(R.color.accent))
            setProgressBackgroundColorSchemeColor(getColor(R.color.bar))
            setOnChildScrollUpCallback { _, _ -> !refreshable() || web.scrollY > 0 }
            setOnRefreshListener {
                web.reload()
                postDelayed({ isRefreshing = false }, 1500)
            }
        }
        bar = TabBar(this, ::onTab, ::onTabLongPress)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
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
            addView(ImageView(context).apply {
                setImageResource(R.mipmap.ic_launcher)
            }, FrameLayout.LayoutParams(dp(88), dp(88), Gravity.CENTER))
            isClickable = true
        }
        root = FrameLayout(this).apply {
            setBackgroundColor(getColor(R.color.bg))
            addView(column)
            addView(progress, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
            addView(splash)
        }
        setContentView(root)

        // Edge to edge: the page sits under the status bar's height, the tab bar above the
        // navigation bar, and both lift with the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            column.setPadding(sys.left, sys.top, sys.right, 0)
            (progress.layoutParams as FrameLayout.LayoutParams).topMargin = sys.top
            val keyboard = ime.bottom > sys.bottom
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

        setUpWeb()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    fullscreen != null -> web.webChromeClient?.onHideCustomView()
                    web.canGoBack() -> web.goBack()
                    else -> moveTaskToBack(true)
                }
            }
        })

        val link = intent?.data?.toString()?.takeIf { Routes.isInstagram(intent?.data?.host) }
        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) {
            hideSplashSoon()
        } else {
            web.loadUrl(link ?: Routes.ORIGIN + Routes.INBOX)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWeb() {
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.allowFileAccess = false
        s.allowContentAccess = true
        s.setSupportMultipleWindows(false)
        s.setGeolocationEnabled(false)
        s.textZoom = 100
        // A plain mobile Chrome, not "an app's web view": Instagram serves its full mobile site.
        s.userAgentString = WebSettings.getDefaultUserAgent(this)
            .replace("; wv", "")
            .replace(Regex(" Version/\\d+(\\.\\d+)*"), "")
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            // Instagram has its own dark theme; it follows the phone (prefers-color-scheme).
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false)
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false
        web.setBackgroundColor(getColor(R.color.bg))

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, pageScript, setOf(Routes.ORIGIN, "https://instagram.com"))
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                return handleLink(request.url)
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    view.evaluateJavascript(pageScript, null)
                }
                onAddress(url)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                refresh.isRefreshing = false
                hideSplashSoon()
                learnProfile()
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                // Also called for Instagram's in-page navigations (history.pushState).
                onAddress(url)
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
                progress.setProgressCompat(newProgress, true)
                if (newProgress >= 70) hideSplashSoon()
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFiles.launch(params.createIntent().apply { putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) })
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

    // --- pages -------------------------------------------------------------------------------

    /** Every address change, full loads and in-page ones alike. */
    private fun onAddress(url: String?) {
        val r = Routes.classify(url)
        if (r == Route.OUTSIDE || r == Route.OTHER && url?.startsWith("about:") == true) return
        val redirect = Routes.redirectFor(r)
        if (redirect != null && allowRedirect()) {
            go(redirect)
            if (r == Route.REELS) toast("Reels are off in Cleangram")
            return
        }
        route = r
        web.evaluateJavascript("document.documentElement.setAttribute('data-cg-route','${r.css}')", null)
        if (prefs.getString("me", null) == null) web.postDelayed({ learnProfile() }, 1200)
        val path = url?.let { Uri.parse(it).path }
        bar.select(
            when (r) {
                Route.HOME, Route.ACTIVITY -> Tab.HOME
                Route.SEARCH -> Tab.SEARCH
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
            || host.endsWith("cdninstagram.com") || host.endsWith("accountscenter.instagram.com")) return false
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
    private fun go(path: String) {
        val js = """
            (function(h){
              var a = Array.prototype.find.call(document.querySelectorAll('a[href]'), function(x){ return x.getAttribute('href') === h; });
              if (a) { a.click(); return "1"; }
              return "0";
            })(${org.json.JSONObject.quote(path)})
        """.trimIndent()
        web.evaluateJavascript(js) { clicked ->
            if (clicked != "\"1\"") web.loadUrl(Routes.ORIGIN + path)
        }
    }

    /** Remember which profile is yours (from Instagram's own profile link), for the Profile tab. */
    private fun learnProfile() {
        val js = """
            (function(){
              // Only Instagram's own bottom bar (fixed to the bottom; Cleangram hides it), never
              // the Stories tray or a feed, where other people's pictures are.
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

    private fun refreshable(): Boolean =
        route == Route.HOME || route == Route.PROFILE || route == Route.ACTIVITY || route == Route.SEARCH

    // --- the tab bar -------------------------------------------------------------------------

    private fun onTab(tab: Tab) {
        when (tab) {
            Tab.HOME -> go(Routes.HOME)
            Tab.SEARCH -> go(Routes.SEARCH)
            Tab.MESSAGES -> go(Routes.INBOX)
            Tab.PROFILE -> {
                val me = prefs.getString("me", null)
                if (me != null) go("/$me/") else {
                    toast("Finding your profile…")
                    go(Routes.HOME)
                    web.postDelayed({ learnProfile(); web.postDelayed({ prefs.getString("me", null)?.let { go("/$it/") } }, 600) }, 1800)
                }
            }
            Tab.NEW -> newPost()
        }
    }

    /** Instagram's own "New post" button (it opens the photo picker). */
    private fun newPost() {
        val js = """
            (function(){
              var svg = document.querySelector('svg[aria-label="New post"], svg[aria-label="Create"]');
              if (!svg) return "0";
              var b = svg.closest('a, button, [role="button"]') || svg;
              b.click();
              return "1";
            })()
        """.trimIndent()
        web.evaluateJavascript(js) { ok ->
            if (ok != "\"1\"") {
                go(Routes.HOME)
                web.postDelayed({ web.evaluateJavascript(js) { again -> if (again != "\"1\"") toast("Couldn't find New post on this page") } }, 1500)
            }
        }
    }

    private fun onTabLongPress(tab: Tab): Boolean {
        if (tab != Tab.PROFILE) return false
        val items = arrayOf("Save page map (for tuning Cleangram)", "Reload page", "Open this page in the browser", "Forget my profile name")
        AlertDialog.Builder(this)
            .setTitle("Cleangram")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> savePageMap()
                    1 -> web.reload()
                    2 -> web.url?.let { openOutside(Uri.parse(it)) }
                    3 -> { prefs.edit().remove("me").apply(); toast("Forgotten") }
                }
            }
            .show()
        return true
    }

    // --- page maps ---------------------------------------------------------------------------

    private fun savePageMap() {
        val script = assets.open("pagemap.js").bufferedReader().readText()
        web.evaluateJavascript(script) { value ->
            val text = runCatching { JSONTokener(value).nextValue() as String }.getOrNull()
            if (text.isNullOrEmpty()) { toast("Couldn't read the page"); return@evaluateJavascript }
            val dir = getExternalFilesDir("pagemaps") ?: filesDir
            dir.mkdirs()
            val stamp = SimpleDateFormat("HHmmss", Locale.US).format(Date())
            val file = File(dir, "${route.css}-$stamp.txt")
            file.writeText("userAgent ${web.settings.userAgentString}\n$text")
            toast("Saved page map: ${file.name}")
        }
    }

    // --- misc --------------------------------------------------------------------------------

    private fun hideSplashSoon() {
        if (splash.visibility != View.VISIBLE || splash.alpha < 1f) return
        splash.animate().alpha(0f).setDuration(220).withEndAction { splash.visibility = View.GONE }.start()
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
        CookieManager.getInstance().flush()
    }

    private fun hasPermission(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
