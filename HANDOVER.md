# DraftForge - Project Handover

## 1. System Architecture State (v2.2)

DraftForge has transitioned from a browser-based PWA into a highly-performant **Native Android Overlay** powered by Capacitor, with a Zero-Trust data pipeline backend.

### **The Engine (TypeScript / JavaScript)**
*   **Draft Engine:** Upgraded to an exponential penalty scoring system ($minScore^2$) to strictly eliminate hard-counters from recommendations. Added Synergy loops to account for ally interactions.
*   **Team Builder:** Utilizes a Bounded Beam Search (Width=3, Depth=5, 243 max operations). Solves 5-man composition locally in `<5ms` without freezing the UI. Implemented graceful degradation for heavily restricted lanes.
*   **Data Loader:** Switched from static JSON bundling to a dynamic, cache-busting fetch (`v2_schema.json?bust=xyz`) to guarantee fresh meta on every boot.

### **The Eyes (Android Native Vision)**
*   **DraftForgeVisionPlugin.kt:** Screen-reading logic is fully native. It isolates the "Safe Zones" (Top-Center 40% of hero slots) to bypass Moonton's "BANNED" overlays.
*   **Difference Hashing (dHash):** Replaced slow MSE image-matching with 64-bit BigInt dHash generation natively, sending only a 100-byte array over the Capacitor bridge.

### **The Body (Capacitor Overlay)**
*   **FloatingService.java:** Binds a transparent WebView to a `SYSTEM_ALERT_WINDOW`.
*   **Doze Freeze Patch:** Elevated the background service to a `Foreground Service` using an un-dismissible high-priority Notification (`startForeground(1)`), preventing Android's battery manager from killing the WebView during heavy GPU load.

### **The Backend (Go Data Pipeline)**
*   **update_meta.go:** A Zero-Cost, local Go CLI aggregator.
*   **Zero-Trust:** Fetches unstable community APIs and sanitizes them against `baseline.json` using Z-Score anomaly detection and absolute min/max Sandbox clamping.
*   **Welford's EMA:** Updates the statistical ledger ($O(1)$ space complexity) dynamically before compiling the final `v2_schema.json` to be hosted on GitHub Pages.

***

## 2. Admin Workflows

You are running a **"Laptop-to-Edge"** pipeline. 

### To Update Matchup Winrates (Daily/Weekly):
1. Navigate to the root directory.
2. Run the Go pipeline: `go run data/scripts/update_meta.go`
3. The script will automatically fetch community data, refine it, generate `v2_schema.json`, and update the `baseline.json` ledger.
4. Commit and push the changes to GitHub. The app will pull the fresh schema automatically on its next boot.

### To Add a New Hero:
1. Manually add the hero's raw stats to `data/raw/hero-meta-final.json`.
2. Compile the core database: `node data/scripts/compile_db.mjs`
3. Add the hero's portrait to the assets folder.
4. Run `npm run build` & `npx cap sync android` if the app needs re-bundling.

***

## 3. Deployment Instructions

To build the final production APK:
1. `cd pwa`
2. `npm run build`
3. `npx cap sync android`
4. Open the Android project in Android Studio: `npx cap open android`
5. Click **Build > Generate Signed Bundle / APK**.

***

## 4. Known Edge-Cases / Future Roadmap
1. **Web Worker Threading:** If the 132-hero pool expands significantly, the Beam Search may require an actual Web Worker split. `app.ts` is already patched to safely serialize `Set` states via `Array.from()` for this eventual transition.
2. **Dynamic UI Resolution Scaling:** The floating overlay uses a hardcoded 350x400dp window. Future updates should include a resize-handle or pinch-to-zoom for tablet devices.
3. **Screen Capture Intent:** Depending on the Android version (specifically Android 14+), the MediaProjection API requires explicit user consent every time it boots. Ensure the UI prompts clearly when draft mode begins.
