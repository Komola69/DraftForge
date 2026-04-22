# DraftForge Handover Context - Session Release 4.0

## 🚀 Project Overview
**DraftForge** is a high-performance MLBB Counter-Picking Engine. 
- **Admin Panel**: `http://localhost:3001` (Controls data pipeline)
- **PWA Frontend**: `http://localhost:5174` (Vite-based logic engine)

---

## ✅ Completed in Last Session

### 1. Data Pipeline Automation (The "Real" Admin Panel)
- **Problem**: The Admin Panel was a fake simulation using `setTimeout`. It never actually updated the game data.
- **Fix**: Rewrote `admin/server.js` to use `child_process.spawn`. Clicking "Run Full Data Pipeline" now executes `compile_db.mjs` and `merge_counters.mjs` in sequence.
- **Path Resolution**: Fixed a critical bug where scripts were looking for `data/raw` in the wrong folder when spawned from the server.

### 2. Strategic Win Conditions (Draft Denial)
- **Implemented**: A high-priority boost for "Synergy Steals".
- **Example**: If the enemy picks **Carmilla**, the engine now gives **Cecilion** a massive score boost to prevent the enemy from completing the world's strongest duo.
- **Multiplier Fix**: Increased `DENIAL_WEIGHT` from `0.5` to `2.5` in `draft-engine.ts`. This ensures that strategic denials outweigh early-draft "safety" penalties.

### 3. Macro-Mechanic Validation
- Updated `team-builder.ts` to penalize team comps that lack **Frontline (Tanks)** or **Wave-clear (Mages/Marksmen)**. The AI now drafts for teamfight anatomy, not just 1v1 counter-picks.

---

## 🛠 Current System State

### Services
- **Admin Server**: Running via `node admin/server.js` (PID managed in background).
- **Vite PWA**: Running via `npm run dev` on **Port 5174**. (Port 5173 was busy).

### Data Integrity
- **Carmilla Matchups**: Verified. The JSON now contains 15 directional matchups for Carmilla (previously 0).
- **Cecilion Combo**: Verified. Cecilion now scores `+7.5` against an enemy Carmilla (math: `22.5` denial bonus - `15.0` safety penalty).

---

## ⚠️ Outstanding Issues (Priority for Next Session)

### 1. BanAdvisor Logic Stuck in "Meta Phase"
- **User Report**: "In draft mode the ban always suggest meta."
- **Investigation Needed**: 
    - `BanAdvisor.ts` is configured with `PHASE2_ALLY_LOCK_COUNT = 1`. 
    - It should switch to "Protective Bans" as soon as one ally is picked. 
    - Need to check why `app.ts` is still rendering "Meta" labels or why the engine falls back to meta scores (likely because `totalThreat` is calculating as 0 for certain allies).

### 2. v2 Schema Fallback
- The PWA console shows `v2_schema.json missing or invalid`. 
- It successfully falls back to the local `v1` JSON files, but the "Data Sync" button in the Admin panel should ideally be updated to generate a `v2_schema.json` if we want to move past the fallback.

### 3. UI Memory Leak
- The `ui/state.ts` pub/sub system lacks teardown. Frequent re-renders in the Overlay view (Android) will eventually cause a memory crash.

---

## 🔑 Key Files to Watch
- `pwa/src/engine/draft-engine.ts`: Core scoring logic and denial multipliers.
- `pwa/src/engine/ban-advisor.ts`: Logic for Meta vs. Protective bans.
- `pwa/src/ui/app.ts`: Main UI orchestrator and data fetching.
- `data/processed/v1_matchups.json`: The source of truth for all counter scores.
