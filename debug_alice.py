
import asyncio
import random
from playwright.async_api import async_playwright

async def debug_alice():
    async with async_playwright() as p:
        # Using a persistent context folder
        user_data_dir = "./hero_scrape_context"
        browser_context = await p.chromium.launch_persistent_context(
            user_data_dir,
            headless=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9",
            }
        )
        
        page = await browser_context.new_page()
        
        # Sneaky webdriver hide
        await page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        
        print("Navigating to Alice...")
        try:
            await page.goto("https://mobile-legends.fandom.com/wiki/Alice", wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(random.uniform(5, 10)) # Very long wait
            
            # Check for block
            content = await page.content()
            if "<title>Just a moment...</title>" in content:
                print("STILL BLOCKED")
            else:
                print("SUCCESS! Alice is accessible.")
                with open("alice_success.html", "w", encoding="utf-8") as f:
                    f.write(content)
        except Exception as e:
            print(f"Error: {e}")
        
        await browser_context.close()

if __name__ == "__main__":
    asyncio.run(debug_alice())
