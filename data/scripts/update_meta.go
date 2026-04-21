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

// Struct for the volatile Community API Data
type APIMatchup struct {
	Score float64 `json:"score"`
}
type APIData struct {
	Matchups map[string]map[string]APIMatchup `json:"matchups"`
}

// Final output schema
type V2Schema struct {
	GeneratedAt string                       `json:"generated_at"`
	DataSource  string                       `json:"data_source"`
	Matchups    map[string]map[string]float64 `json:"matchups"`
}

const (
	communityAPIURL = "https://raw.githubusercontent.com/p3hndrx/MLBB-API/main/api_counters.json"
	baselinePath    = "./data/raw/baseline.json"
	outputPath      = "./data/processed/v2_schema.json"
	zScoreThreshold = 2.5 // Max standard deviations allowed before dropping
)

func main() {
	log.Println("[ENGINE] Booting Zero-Trust Aggregator Pipeline...")

	var wg sync.WaitGroup
	var baseline BaselineData
	var apiData APIData
	var apiErr error

	// ==========================================
	// 2. Concurrent Ingestion (The Fetcher)
	// ==========================================
	wg.Add(2)

	// Goroutine 1: Load Local Ground Truth
	go func() {
		defer wg.Done()
		file, err := os.ReadFile(baselinePath)
		if err != nil {
			log.Fatalf("[CRITICAL] Baseline file unreadable: %v. Pipeline halted.", err)
		}
		if err := json.Unmarshal(file, &baseline); err != nil {
			log.Fatalf("[CRITICAL] Baseline JSON corrupt: %v. Pipeline halted.", err)
		}
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
					// Formula: Z = |X - Mean| / StdDev
					if baseRules.RollingStd > 0 {
						zScore := math.Abs(newScore - baseRules.RollingMean) / baseRules.RollingStd
						if zScore > zScoreThreshold {
							log.Printf("[CIRCUIT BREAKER] %s vs %s shifted by %.2f StdDevs! Dropping anomaly.", heroID, enemyID, zScore)
							newScore = baseRules.BaseScore // Fallback to safe known value
							anomaliesDropped++
						}
					}

					// B. The Sandbox (Clamping to Absolute Limits)
					if newScore > baseRules.MaxAllowed {
						log.Printf("[SANDBOX] Clamping %s vs %s from %.2f down to %.2f limit.", heroID, enemyID, newScore, baseRules.MaxAllowed)
						newScore = baseRules.MaxAllowed
						scoresClamped++
					} else if newScore < baseRules.MinAllowed {
						log.Printf("[SANDBOX] Clamping %s vs %s from %.2f up to %.2f limit.", heroID, enemyID, newScore, baseRules.MinAllowed)
						newScore = baseRules.MinAllowed
						scoresClamped++
					}

					finalScore = newScore
				}
			}

			finalMatchups[heroID][enemyID] = finalScore
		}
	}
	
	log.Printf("[REFINERY] Complete. Anomalies Dropped: %d | Scores Clamped: %d", anomaliesDropped, scoresClamped)

	// ==========================================
	// 4. The Compiler (JSON Output)
	// ==========================================
	log.Println("[COMPILER] Generating final v2 schema...")
	output := V2Schema{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		DataSource:  dataSource,
		Matchups:    finalMatchups,
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
