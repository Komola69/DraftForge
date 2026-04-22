import os
import requests
from bs4 import BeautifulSoup
import json
import time
import re

DIR_SKINS = './pwa/public/skins'
HEROES_FILE = './data/processed/v1_heroes.json'

os.makedirs(DIR_SKINS, exist_ok=True)

def get_hero_names():
    with open(HEROES_FILE, 'r') as f:
        data = json.load(f)
        return [h['name'] for h in data['heroes']]

def download_skin_portraits(hero_name):
    # Try multiple URL patterns if needed, but the /Gallery is standard
    formatted_name = hero_name.replace(' ', '_')
    url = f"https://mobile-legends.fandom.com/wiki/{formatted_name}/Gallery"
    
    print(f"Fetching skins for {hero_name} from {url}...")
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, headers=headers, timeout=15)
        if response.status_code != 200:
            print(f"  [ERROR] Status {response.status_code} for {hero_name}")
            return []
        
        soup = BeautifulSoup(response.text, 'html.parser')
        skin_images = []
        
        # Method 2: Look for gallery items specifically
        gallery_items = soup.select('.wikia-gallery-item img')
        if not gallery_items:
            # Try generic images if gallery selection fails
            gallery_items = soup.find_all('img')

        for img in gallery_items:
            src = img.get('data-src') or img.get('src')
            if not src: continue
            
            clean_url = src.split('/revision/')[0]
            filename = clean_url.split('/')[-1]
            alt = img.get('alt', '').lower()
            
            # Professional Skins heuristic:
            # We want files that look like "HeroName_SkinName.png" or have "Skin" in alt text
            is_match = False
            
            # Match if hero name is in filename and it's a skin/portrait
            name_token = formatted_name.replace('_', '')
            clean_filename = filename.replace('_', '').replace('-', '').lower()
            
            if name_token.lower() in clean_filename:
                if 'skin' in clean_filename or 'portrait' in clean_filename or 'skin' in alt:
                    is_match = True
            
            if is_match and (".png" in filename or ".jpg" in filename):
                if clean_url not in skin_images:
                    skin_images.append(clean_url)
        
        downloaded = []
        # Limit to 10 skins per hero
        for i, img_url in enumerate(skin_images[:10]):
            ext = 'png' if '.png' in img_url.lower() else 'jpg'
            safe_hero_name = formatted_name.lower().replace('\'', '').replace('.', '')
            target_filename = f"{safe_hero_name}_skin_{i}.{ext}"
            target_path = os.path.join(DIR_SKINS, target_filename)
            
            print(f"  Downloading skin {i}: {img_url}")
            try:
                img_data = requests.get(img_url, headers=headers, timeout=15).content
                with open(target_path, 'wb') as f:
                    f.write(img_data)
                downloaded.append(f"/skins/{target_filename}")
                time.sleep(1) # Be gentle
            except Exception as e:
                print(f"    [ERROR] Download failed: {e}")
                
        return downloaded

    except Exception as e:
        print(f"  [ERROR] Scraping failed for {hero_name}: {e}")
        return []

def main():
    heroes = get_hero_names()
    skin_map = {}
    
    # Process all heroes
    for hero in heroes:
        paths = download_skin_portraits(hero)
        if paths:
            skin_map[hero.lower()] = paths
            # Save progress incrementally
            with open('./data/processed/v1_skin_portraits.json', 'w') as f:
                json.dump(skin_map, f, indent=2)
        
    print(f"\n[SUCCESS] Completed download and generated v1_skin_portraits.json")

if __name__ == "__main__":
    main()
