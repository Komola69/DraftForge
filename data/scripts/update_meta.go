package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"sync"
	"time"
)

// ==========================================
// 1. The Local Baseline Structs
// ==========================================
type BaselineMatchup struct {
	BaseScore   float64 `json:"base_score"`
	MinAllowed  float64 `json:"min_allowed"`
	MaxAllowed  float64 `json:"max_allowed"`
	RollingMean float64 `json:"rolling_mean"` // Historical average for Z-Score
	RollingStd  float64 `json:"rolling_std"`  // Standard Deviation for Z-Score
}

type BaselineData struct {
	Version  string                                `json:"version"`
	Matchups map[string]map[string]BaselineMatchup `json:"matchups"` // [HeroID][EnemyID]
}

type V1MatchupData struct {
	Matchups map[string]map[string]float64 `json:"matchups"`
}

// Struct for the volatile Community API Data
type APIMatchup struct {
	Score float64 `json:"score"`
}
type APIData struct {
	Matchups map[string]map[string]APIMatchup `json:"matchups"`
}

type HeroRaw struct {
	ID             int     `json:"id"`
	GoldReliance   float64 `json:"goldReliance"`
	BuffDependency string  `json:"buffDependency"`
}

type HeroData struct {
	Heroes []HeroRaw `json:"heroes"`
}

type HeroResourceProfile struct {
	GoldReliance   int    `json:"goldReliance"`
	BuffDependency string `json:"buffDependency"`
}

// Final output schema
type V2Schema struct {
	GeneratedAt string                       `json:"generated_at"`
	DataSource  string                       `json:"data_source"`
	Matchups    map[string]map[string]float64 `json:"matchups"`
	HeroProfiles map[string]HeroResourceProfile `json:"hero_profiles"`
}

const (
	communityAPIURL = "https://raw.githubusercontent.com/p3hndrx/MLBB-API/main/api_counters.json"
	baselinePath    = "./data/raw/baseline.json"
	heroesPath      = "./data/processed/v1_heroes.json"
	v1MatchupsPath  = "./data/processed/v1_matchups.json"
	outputPath      = "./data/processed/v2_schema.json"
	zScoreThreshold = 2.5 // Max standard deviations allowed before dropping
)

func clamp(value float64, min float64, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func bootstrapBaselineFromV1(path string) (BaselineData, error) {
	file, err := os.ReadFile(path)
	if err != nil {
		return BaselineData{}, err
	}

	var v1 V1MatchupData
	if err := json.Unmarshal(file, &v1); err != nil {
		return BaselineData{}, err
	}

	baseline := BaselineData{
		Version:  "bootstrap-v1",
		Matchups: make(map[string]map[string]BaselineMatchup),
	}

	for heroID, enemies := range v1.Matchups {
		baseline.Matchups[heroID] = make(map[string]BaselineMatchup)
		for enemyID, score := range enemies {
			baseline.Matchups[heroID][enemyID] = BaselineMatchup{
				BaseScore:   score,
				MinAllowed:  clamp(score-4.0, -10.0, 10.0),
				MaxAllowed:  clamp(score+4.0, -10.0, 10.0),
				RollingMean: score,
				RollingStd:  1.0,
			}
		}
	}

	return baseline, nil
}

func loadOrInitializeBaseline(path string) (BaselineData, error) {
	file, err := os.ReadFile(path)
	if err == nil {
		var baseline BaselineData
		if unmarshalErr := json.Unmarshal(file, &baseline); unmarshalErr != nil {
			return BaselineData{}, unmarshalErr
		}
		return baseline, nil
	}

	if !os.IsNotExist(err) {
		return BaselineData{}, err
	}

	log.Printf("[WARNING] baseline.json missing. Bootstrapping from %s", v1MatchupsPath)
	baseline, bootstrapErr := bootstrapBaselineFromV1(v1MatchupsPath)
	if bootstrapErr != nil {
		return BaselineData{}, bootstrapErr
	}

	baseBytes, marshalErr := json.MarshalIndent(baseline, "", "  ")
	if marshalErr == nil {
		_ = os.WriteFile(path, baseBytes, 0644)
	}

	log.Println("[INGEST] baseline.json bootstrapped successfully.")
	return baseline, nil
}

func normalizeGoldReliance(value float64) int {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 5
	}
	rounded := int(math.Round(value))
	if rounded < 1 {
		return 1
	}
	if rounded > 10 {
		return 10
	}
	return rounded
}

func normalizeBuffDependency(value string) string {
	switch value {
	case "Purple", "Red", "None":
		return value
	default:
		return "None"
	}
}

func loadHeroProfiles(path string) map[string]HeroResourceProfile {
	profiles := make(map[string]HeroResourceProfile)

	file, err := os.ReadFile(path)
	if err != nil {
		log.Printf("[WARNING] Could not read hero source (%v). Using empty hero_profiles.", err)
		return profiles
	}

	var heroesData HeroData
	if err := json.Unmarshal(file, &heroesData); err != nil {
		log.Printf("[WARNING] Could not parse hero source (%v). Using empty hero_profiles.", err)
		return profiles
	}

	for _, h := range heroesData.Heroes {
		if h.ID <= 0 {
			continue
		}
		key := fmt.Sprintf("%d", h.ID)
		profiles[key] = HeroResourceProfile{
			GoldReliance:   normalizeGoldReliance(h.GoldReliance),
			BuffDependency: normalizeBuffDependency(h.BuffDependency),
		}
	}

	return profiles
}

func main() {
	log.Println("[ENGINE] Booting Zero-Trust Aggregator Pipeline...")

	var wg sync.WaitGroup
	var baseline BaselineData
	var apiData APIData
	var baselineErr error
	var apiErr error

	// ==========================================
	// 2. Concurrent Ingestion (The Fetcher)
	// ==========================================
	wg.Add(2)

	// Goroutine 1: Load Local Ground Truth
	go func() {
		defer wg.Done()
		loadedBaseline, err := loadOrInitializeBaseline(baselinePath)
		if err != nil {
			baselineErr = err
			return
		}
		baseline = loadedBaseline
		log.Println("[INGEST] Local Baseline loaded successfully.")
	}()

	// Goroutine 2: Fetch Volatile Community Data
	go func() {
		defer wg.Done()
		
		// Strict 10-second timeout. We don't wait for lagging APIs.
		client := http.Client{Timeout: 10 * time.Second}
		resp, err := client.Get(communityAPIURL)
		
		if err != nil {
			apiErr = fmt.Errorf("HTTP Get failed: %v", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			apiErr = fmt.Errorf("API returned status %d", resp.StatusCode)
			return
		}

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			apiErr = fmt.Errorf("Failed to read body stream: %v", err)
			return
		}

		if err := json.Unmarshal(body, &apiData); err != nil {
			apiErr = fmt.Errorf("JSON decoding failed: %v", err)
		} else {
			log.Println("[INGEST] Community API data fetched successfully.")
		}
	}()

	// Block until both routines finish
	wg.Wait()

	if baselineErr != nil {
		log.Fatalf("[CRITICAL] Baseline load failed: %v. Pipeline halted.", baselineErr)
	}

	dataSource := "community_merged"
	if apiErr != nil {
		log.Printf("[WARNING] API Failure (%v). Defaulting entirely to local baseline.", apiErr)
		dataSource = "baseline_fallback"
	}

	// ==========================================
	// 3. The Math Refinery (Circuit Breaker & Sandbox)
	// ==========================================
	log.Println("[REFINERY] Entering Z-Score & Sanity Sandbox...")
	finalMatchups := make(map[string]map[string]float64)
	anomaliesDropped := 0
	scoresClamped := 0

	for heroID, enemies := range baseline.Matchups {
		finalMatchups[heroID] = make(map[string]float64)

		for enemyID, baseRules := range enemies {
			finalScore := baseRules.BaseScore

			// Process new data only if API was successful and data exists
			if apiErr == nil && apiData.Matchups[heroID] != nil {
				if apiMatch, exists := apiData.Matchups[heroID][enemyID]; exists {
					newScore := apiMatch.Score

					// A. The Circuit Breaker (Z-Score Anomaly Detection)
					// Prevent +Inf division-by-zero on highly stable stats
					std := baseRules.RollingStd
					if std < 0.25 {
						std = 0.25 // Epsilon threshold for minimum variance
					}

					zScore := math.Abs(newScore - baseRules.RollingMean) / std
					if zScore > zScoreThreshold {
						log.Printf("[CIRCUIT BREAKER] %s vs %s shifted by %.2f StdDevs! Dropping anomaly.", heroID, enemyID, zScore)
						newScore = baseRules.BaseScore // Fallback
						anomaliesDropped++
					} else {
						// B. Iterative State Update (Welford's Online EMA / EMV Approximation)
						// We only update the ledger if the data wasn't anomalous.
						// N = 7 days -> Alpha = 2 / (7 + 1) = 0.25
						alpha := 0.25
						diff := newScore - baseRules.RollingMean
						
						// Update Mean
						baseRules.RollingMean += alpha * diff
						
						// Update Variance and Std
						oldVar := baseRules.RollingStd * baseRules.RollingStd
						newVar := (1.0 - alpha) * (oldVar + alpha*diff*diff)
						baseRules.RollingStd = math.Sqrt(newVar)
					}

					// C. The Sandbox (Clamping to Absolute Limits)
					if newScore > baseRules.MaxAllowed {
						log.Printf("[SANDBOX] Clamping %s vs %s from %.2f down to %.2f limit.", heroID, enemyID, newScore, baseRules.MaxAllowed)
						newScore = baseRules.MaxAllowed
						scoresClamped++
					} else if newScore < baseRules.MinAllowed {
						log.Printf("[SANDBOX] Clamping %s vs %s from %.2f up to %.2f limit.", heroID, enemyID, newScore, baseRules.MinAllowed)
						newScore = baseRules.MinAllowed
						scoresClamped++
					}

					// Write the updated stats back into the baseline memory map
					enemies[enemyID] = baseRules
					finalScore = newScore
				}
			}

			finalMatchups[heroID][enemyID] = finalScore
		}
	}
	
	log.Printf("[REFINERY] Complete. Anomalies Dropped: %d | Scores Clamped: %d", anomaliesDropped, scoresClamped)

	// ==========================================
	// 4. Memory Persistence (The Ledger Update)
	// ==========================================
	if apiErr == nil {
		log.Println("[LEDGER] Saving updated Rolling Means & Stds back to baseline.json...")
		baseBytes, err := json.MarshalIndent(baseline, "", "  ")
		if err == nil {
			os.WriteFile(baselinePath, baseBytes, 0644)
		}
	}

	// ==========================================
	// 5. The Compiler (JSON Output)
	// ==========================================
	log.Println("[COMPILER] Generating final v2 schema...")
	output := V2Schema{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		DataSource:  dataSource,
		Matchups:    finalMatchups,
		HeroProfiles: loadHeroProfiles(heroesPath),
	}

	outBytes, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		log.Fatalf("[CRITICAL] Failed to marshal output: %v", err)
	}

	if err := os.WriteFile(outputPath, outBytes, 0644); err != nil {
		log.Fatalf("[CRITICAL] Failed to write v2_schema.json to disk: %v", err)
	}

	log.Println("[SUCCESS] Zero-Trust Aggregator Pipeline finished. v2_schema.json is ready for edge deployment.")
}
