import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const DIR_SKINS = './pwa/public/skins';
const HEROES_FILE = './data/processed/v1_heroes.json';

if (!fs.existsSync(DIR_SKINS)) fs.mkdirSync(DIR_SKINS, { recursive: true });

async function getHeroNames() {
  const data = JSON.parse(fs.readFileSync(HEROES_FILE, 'utf8'));
  return data.heroes.map(h => h.name);
}

async function run() {
  const heroes = await getHeroNames();
  const skinMap = {};
  
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');

  // Let's do the top 30 most popular heroes first to ensure we have the core meta covered
  for (const heroName of heroes.slice(0, 30)) {
    const formattedName = heroName.replace(/ /g, '_');
    const url = `https://mobile-legends.fandom.com/wiki/${formattedName}/Gallery`;
    
    console.log(`Processing ${heroName}...`);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      const images = await page.evaluate((name) => {
        const imgs = Array.from(document.querySelectorAll('img'));
        const nameToken = name.replace(/_/g, '').toLowerCase();
        
        return imgs
          .map(img => ({
            src: img.src.split('/revision/')[0],
            alt: img.alt.toLowerCase(),
            filename: img.src.split('/').pop().split('/revision/')[0].toLowerCase()
          }))
          .filter(img => {
            const isSkin = img.filename.includes('skin') || img.filename.includes('portrait') || img.alt.includes('skin');
            const isHero = img.filename.includes(nameToken);
            return isSkin && isHero && (img.src.endsWith('.png') || img.src.endsWith('.jpg'));
          })
          .map(img => img.src)
          .slice(0, 5); // Max 5 skins
      }, formattedName);

      if (images.length > 0) {
        const downloaded = [];
        for (let i = 0; i < images.length; i++) {
          const imgUrl = images[i];
          const ext = imgUrl.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
          const safeName = formattedName.toLowerCase().replace(/['.]/g, '');
          const filename = `${safeName}_skin_${i}.${ext}`;
          const targetPath = path.join(DIR_SKINS, filename);

          console.log(`  Downloading ${imgUrl}...`);
          try {
            const viewSource = await page.goto(imgUrl);
            fs.writeFileSync(targetPath, await viewSource.buffer());
            downloaded.push(`/skins/${filename}`);
          } catch (e) {
            console.error(`  [ERROR] Failed to download ${imgUrl}: ${e.message}`);
          }
        }
        skinMap[heroName.toLowerCase()] = downloaded;
        // Incremental save
        fs.writeFileSync('./data/processed/v1_skin_portraits.json', JSON.stringify(skinMap, null, 2));
      }
    } catch (err) {
      console.error(`  [ERROR] Failed to process ${heroName}: ${err.message}`);
    }
  }

  await browser.close();
  console.log('[SUCCESS] Skin signature harvesting complete.');
}

run();
