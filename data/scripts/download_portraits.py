"""
Extract hero portrait URLs from the MLBB-API dataset and download them.
Also extracts counter/synergy relationships for data enrichment.

Run: python download_portraits.py
"""

import json
import os
import urllib.request
import time
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'raw')
OUTPUT_DIR = os.path.join(SCRIPT_DIR, '..', '..', 'pwa', 'public', 'heroes')
API_URL = 'https://raw.githubusercontent.com/p3hndrx/MLBB-API/main/v1/hero-meta-final.json'

def download_api_data():
    """Download the hero metadata JSON from GitHub."""
    cache_path = os.path.join(DATA_DIR, 'hero-meta-final.json')
    if os.path.exists(cache_path):
        print(f'[CACHE] Using cached data: {cache_path}')
        with open(cache_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    print(f'[DOWNLOAD] Fetching hero metadata from GitHub...')
    req = urllib.request.Request(API_URL, headers={'User-Agent': 'DraftForge/1.0'})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(cache_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print(f'[SAVED] Cached to {cache_path}')
    return data

def download_portraits(heroes):
    """Download hero portrait images."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    downloaded = 0
    skipped = 0
    failed = 0
    
    for hero in heroes:
        name = hero.get('hero_name', '')
        portrait_url = hero.get('portrait', '')
        uid = hero.get('uid', '')
        
        if not portrait_url or not uid or name == 'None':
            continue
        
        filename = f'{uid}.png'
        filepath = os.path.join(OUTPUT_DIR, filename)
        
        if os.path.exists(filepath):
            skipped += 1
            continue
        
        try:
            print(f'  [{downloaded+1}] Downloading {name}...', end=' ')
            req = urllib.request.Request(portrait_url, headers={'User-Agent': 'DraftForge/1.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                img_data = resp.read()
            
            with open(filepath, 'wb') as f:
                f.write(img_data)
            
            print(f'OK ({len(img_data)//1024}KB)')
            downloaded += 1
            time.sleep(0.3)  # Be polite
        except Exception as e:
            print(f'FAILED: {e}')
            failed += 1
    
    print(f'\n[DONE] Downloaded: {downloaded}, Skipped: {skipped}, Failed: {failed}')

def extract_portrait_map(heroes):
    """Create a hero_name -> portrait_filename mapping for the app."""
    mapping = {}
    for hero in heroes:
        uid = hero.get('uid', '')
        name = hero.get('hero_name', '')
        if uid and name and name != 'None':
            mapping[name.lower()] = f'/heroes/{uid}.png'
    
    output_path = os.path.join(SCRIPT_DIR, '..', 'processed', 'v1_portraits.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, indent=2)
    print(f'[SAVED] Portrait map ({len(mapping)} heroes) -> {output_path}')

def extract_counters_synergies(heroes):
    """Extract counter and synergy data from the API for comparison/enrichment."""
    counters = {}
    synergies = {}
    
    for hero in heroes:
        name = hero.get('hero_name', '')
        mlid = hero.get('mlid', '')
        if not mlid or name == 'None':
            continue
        
        hero_counters = hero.get('counters', [])
        hero_synergies = hero.get('synergies', [])
        
        if hero_counters:
            counters[name] = [c['heroname'] for c in hero_counters]
        if hero_synergies:
            synergies[name] = [s['heroname'] for s in hero_synergies]
    
    output_path = os.path.join(SCRIPT_DIR, '..', 'raw', 'api_counters.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({'counters': counters, 'synergies': synergies}, f, indent=2)
    print(f'[SAVED] API counter/synergy data ({len(counters)} heroes) -> {output_path}')

def main():
    print('=== DraftForge Portrait Downloader ===\n')
    
    data = download_api_data()
    heroes = data.get('data', [])
    print(f'[INFO] Found {len(heroes)} heroes in API data\n')
    
    print('[STEP 1] Extracting portrait map...')
    extract_portrait_map(heroes)
    
    print('\n[STEP 2] Extracting counter/synergy data...')
    extract_counters_synergies(heroes)
    
    print(f'\n[STEP 3] Downloading portrait images to {OUTPUT_DIR}...')
    download_portraits(heroes)
    
    print('\n=== All done! ===')

if __name__ == '__main__':
    main()
