# ⚔️ DraftForge — MLBB Strategic Intelligence System

DraftForge is a production-ready, AI-driven draft companion for Mobile Legends: Bang Bang (MLBB). It uses a sophisticated **Matchup Matrix Engine** and **Experimental Computer Vision (OCR)** to provide real-time strategic advantages during live competitive play.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![PWA](https://img.shields.io/badge/PWA-Supported-green)
![Capacitor](https://img.shields.io/badge/Native-Android%20Overlay-orange)

## 🚀 Key Features
- **Intelligent Ban Advisor:** A two-phase engine that suggests meta bans based on "Counter Accessibility" and protective bans based on your team's specific vulnerabilities.
- **Multi-Set Team Builder:** Uses a weighted bipartite matching heuristic to suggest full 5-man compositions (Balanced vs. Max Counter).
- **Floating In-Game Overlay:** Powered by Capacitor and a custom Android `SYSTEM_ALERT_WINDOW` plugin, allowing you to use DraftForge without leaving MLBB.
- **Experimental Auto-Draft (OCR):** Template-matching engine (dHash) that identifies enemy picks directly from screen captures.
- **Dynamic 132-Hero Brain:** Compiled directly from community-maintained meta APIs, including the latest heroes like **Zetian** and **Kalea**.

## 🧠 System Architecture
- **Front-end:** Vite + TypeScript + Vanilla CSS (High Performance).
- **Engine:** Offloaded to **Web Workers** to prevent UI stuttering during complex 5-man combinatorial evaluations.
- **Data Pipeline:** Custom NodeJS scripts merge raw community JSONs into a directional (+/-) scoring matrix.
- **Native Bridge:** Capacitor Android wrapper with a custom Background Service for the floating bubble UI.

## 🛠️ Getting Started

### Prerequisites
- Node.js (v18+)
- Android Studio (for native overlay)

### Installation
1. Clone the repo:
   ```bash
   git clone https://github.com/Komola69/DraftForge.git
   ```
2. Install dependencies:
   ```bash
   cd pwa
   npm install
   ```
3. Run dev server:
   ```bash
   npm run dev
   ```

### Compile Android Overlay
```bash
npx cap run android
```

## 📊 Data Ingestion
To update the hero database with the latest patch data:
```bash
node ./data/scripts/compile_db.mjs
```

## 🤝 Contributing
This is an open-source project aimed at improving the competitive MLBB ecosystem. Pull requests are welcome!

## 📜 License
MIT License - Copyright (c) 2026 Komola69
