# Cleangram

Instagram's own website, full screen, as an Android app — with no feed, no Reels and no Explore.

- **Home** shows only the Stories tray; the feed is hidden.
- **Reels** and the **Explore** grid are off: going there takes you to Messages or Search.
- A post or reel someone sends you in a DM still opens.
- Its own bottom bar: Home, Search, New post, Messages, Profile.
- Photo/video uploads, downloads, dark mode, the back button: like an app.

Nothing about your account changes: every request is made by Instagram's website code, as in
any browser. The app only watches which page is open and adds a stylesheet
(`app/src/main/assets/cleangram.js`, `cleangram.css`). No JavaScript bridge, no requests of its own.

Long-press **Profile** for tools, including *Save page map*, which writes the structure of the
current page to `Android/data/com.cleancut.gram/files/pagemaps/` (message text is never saved,
only its length) to tune what's hidden.

Builds on GitHub Actions (`.github/workflows/build.yml`), signed with the `KEYSTORE_BASE64` /
`KEYSTORE_PASS` secrets.
