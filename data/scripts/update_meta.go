package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"
)

// ==========================================
// 1. Data Structures & Schemas
// ==========================================

type BaselineMatchup struct {
	BaseScore   float64 `json:"base_score"`
	MinAllowed  float64 `json:"min_allowed"`
	MaxAllowed  float64 `json:"max_allowed"`
	RollingMean float64 `json:"rolling_mean"`
	RollingStd  float64 `json:"rolling_std"`
}

type BaselineData struct {
	Version  string                                `json:"version"`
	Matchups map[string]map[string]BaselineMatchup `json:"matchups"`
}

type NormalizedMatchups map[string]map[string]float64

type MAPILegendHero struct {
	HeroID   string `json:"heroid"`
	Name     string `json:"name"`
	WinRate  string `json:"win_rate"`
	PickRate string `json:"pick_rate"`
	BanRate  string `json:"ban_rate"`
}
type MAPIResponse struct {
	Data []MAPILegendHero `json:"data"`
}

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

type V2Schema struct {
	GeneratedAt  string                       `json:"generated_at"`
	DataSource   string                       `json:"data_source"`
	Matchups     map[string]map[string]float64 `json:"matchups"`
	HeroProfiles map[string]HeroResourceProfile `json:"hero_profiles"`
}

const (
	urlCommunity = "https://raw.githubusercontent.com/p3hndrx/MLBB-API/main/api_counters.json"
	urlOfficial  = "https://mapi.mobilelegends.com/legends/area?dateType=week&area=all&module=2&moduleType=3&language=en"
	
	baselinePath    = "./data/raw/baseline.json"
	heroesPath      = "./data/processed/v1_heroes.json"
	outputPath      = "./data/processed/v2_schema.json"
	zScoreThreshold = 2.5
)

// ==========================================
// 2. Helpers
// ==========================================

func normalizeGoldReliance(value float64) int {
	if math.IsNaN(value) || math.IsInf(value, 0) { return 5 }
	rounded := int(math.Round(value))
	if rounded < 1 { return 1 }
	if rounded > 10 { return 10 }
	return rounded
}

func normalizeBuffDependency(value string) string {
	switch value {
	case "Purple", "Red", "None": return value
	default: return "None"
	}
}

func loadHeroProfiles(path string) map[string]HeroResourceProfile {
	profiles := make(map[string]HeroResourceProfile)
	file, err := os.ReadFile(path)
	if err != nil { return profiles }
	var heroesData HeroData
	if err := json.Unmarshal(file, &heroesData); err != nil { return profiles }
	for _, h := range heroesData.Heroes {
		if h.ID <= 0 { continue }
		key := fmt.Sprintf("%d", h.ID)
		profiles[key] = HeroResourceProfile{
			GoldReliance:   normalizeGoldReliance(h.GoldReliance),
			BuffDependency: normalizeBuffDependency(h.BuffDependency),
		}
	}
	return profiles
}

func calculateMedian(values []float64) float64 {
	if len(values) == 0 { return 0 }
	sort.Float64s(values)
	mNumber := len(values) / 2
	if len(values)%2 == 0 {
		return (values[mNumber-1] + values[mNumber]) / 2
	}
	return values[mNumber]
}

// ==========================================
// 3. Fetchers
// ==========================================

func fetchCommunity(client *http.Client) (NormalizedMatchups, error) {
	resp, err := client.Get(urlCommunity)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	var raw APIData
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil { return nil, err }
	norm := make(NormalizedMatchups)
	for hId, enemies := range raw.Matchups {
		norm[hId] = make(map[string]float64)
		for eId, data := range enemies {
			norm[hId][eId] = data.Score
		}
	}
	return norm, nil
}

func fetchOfficial(client *http.Client) (map[string]float64, error) {
	resp, err := client.Get(urlOfficial)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	var raw MAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil { return nil, err }
	wrMap := make(map[string]float64)
	for _, h := range raw.Data {
		var wr float64
		fmt.Sscanf(h.WinRate, "%f%%", &wr)
		wrMap[h.HeroID] = wr
	}
	return wrMap, nil
}

// ==========================================
// 4. Main
// ==========================================

func main() {
	log.Println("[ENGINE] Booting Multi-Source Zero-Trust Pipeline...")
	start := time.Now()

	client := &http.Client{Timeout: 15 * time.Second}
	var wg sync.WaitGroup
	var baseline BaselineData
	var communityData NormalizedMatchups
	var officialWR map[string]float64
	var errBase, errComm, errOff error

	wg.Add(3)
	go func() {
		defer wg.Done()
		file, err := os.ReadFile(baselinePath)
		if err == nil { errBase = json.Unmarshal(file, &baseline) } else { errBase = err }
	}()
	go func() {
		defer wg.Done()
		communityData, errComm = fetchCommunity(client)
	}()
	go func() {
		defer wg.Done()
		officialWR, errOff = fetchOfficial(client)
	}()
	wg.Wait()

	if errBase != nil { log.Fatalf("[CRITICAL] Could not load baseline: %v", errBase) }

	finalMatchups := make(map[string]map[string]float64)
	anomaliesDropped := 0
	
	for heroID, enemies := range baseline.Matchups {
		finalMatchups[heroID] = make(map[string]float64)
		for enemyID, rules := range enemies {
			candidates := []float64{rules.BaseScore}
			if errComm == nil && communityData[heroID] != nil {
				if val, ok := communityData[heroID][enemyID]; ok { candidates = append(candidates, val) }
			}
			if errOff == nil {
				wrA, okA := officialWR[heroID]
				wrB, okB := officialWR[enemyID]
				if okA && okB {
					drift := (wrA - wrB) * 0.15
					candidates = append(candidates, rules.BaseScore + drift)
				}
			}
			consensusScore := calculateMedian(candidates)
			std := rules.RollingStd
			if std < 0.25 { std = 0.25 }
			z := math.Abs(consensusScore - rules.RollingMean) / std
			if z > zScoreThreshold {
				consensusScore = rules.RollingMean
				rules.RollingStd *= 1.1 
				anomaliesDropped++
			} else {
				alpha := 0.2
				diff := consensusScore - rules.RollingMean
				rules.RollingMean += alpha * diff
				oldVar := rules.RollingStd * rules.RollingStd
				newVar := (1.0 - alpha) * (oldVar + alpha*diff*diff)
				rules.RollingStd = math.Sqrt(newVar)
			}
			finalMatchups[heroID][enemyID] = math.Round(consensusScore*100)/100
			enemies[enemyID] = rules
		}
	}

	baseBytes, _ := json.MarshalIndent(baseline, "", "  ")
	os.WriteFile(baselinePath, baseBytes, 0644)

	output := V2Schema{
		GeneratedAt:  time.Now().Format(time.RFC3339),
		DataSource:   "multi_source_consensus",
		Matchups:     finalMatchups,
		HeroProfiles: loadHeroProfiles(heroesPath),
	}
	outBytes, _ := json.MarshalIndent(output, "", "  ")
	os.WriteFile(outputPath, outBytes, 0644)

	log.Printf("[REFINERY] Complete. %d anomalies dropped. Aggregation done in %v.", anomaliesDropped, time.Since(start))
}
