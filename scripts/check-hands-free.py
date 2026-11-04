"""Browser acceptance for the Hands-free usability changes.

Run Vite first, then: python scripts/check-hands-free.py --url http://127.0.0.1:1420
Requires Python Playwright and Chromium. Add --timers with the real Windows
backend running against a disposable config. No AI requests or real camera needed.
Use --url http://127.0.0.1:1422 for the Android browser preview (without --timers).
"""
import argparse
import asyncio
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

from playwright.async_api import async_playwright, expect, TimeoutError as PlaywrightTimeout


async def visible(locator):
    for candidate in await locator.all():
        if await candidate.is_visible():
            return candidate
    raise AssertionError(f"No visible match: {locator}")


async def fit(locator, width):
    box = await locator.bounding_box()
    assert box and box["x"] >= -1 and box["x"] + box["width"] <= width + 1, box


async def enter(page, url):
    await page.goto(url)
    await expect(page.get_by_role("button", name="Hands-free", exact=True)).to_be_visible()
    # Startup may replace Boot with onboarding while the browser is clicking.
    # Follow the currently visible route; never alter credentials or app state.
    for _ in range(20):
        await page.wait_for_timeout(150)
        clicked = False
        for name in ["Explore without an AI key", "Continue with available features", "Continue with local features"]:
            for button in await page.get_by_role("button", name=name, exact=True).all():
                if await button.is_visible():
                    try:
                        await button.click(timeout=750)
                        clicked = True
                    except PlaywrightTimeout:
                        pass  # A real connection can replace this overlay.
        overlays = page.locator(".setup-overlay:visible, .onboard-overlay:visible, .ob:visible")
        if not clicked and not await overlays.count():
            break
    await expect(page.get_by_role("button", name="Hands-free", exact=True)).to_be_visible()


async def journey(browser, url, width, output):
    context = await browser.new_context(viewport={"width": width, "height": 900 if width > 640 else 844})
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await enter(page, url)
    await fit(page.locator(".home-hands-free"), width)
    await fit(page.locator(".ask"), width)
    await fit(page.locator(".hero-time"), width)
    menu = page.get_by_role("button", name="Menu", exact=True)
    if await menu.is_visible():
        await menu.click()
    await (await visible(page.locator("#header-actions").get_by_role("button", name="Settings", exact=True))).click()
    await page.keyboard.press("Escape")
    await (await visible(page.get_by_role("button", name="Chat", exact=True))).click()
    chat = page.locator(".chatov.open .chatov-panel")
    if await chat.count():
        await fit(chat, width)
        await page.screenshot(path=str(output / f"chat-{width}.png"))
    await page.keyboard.press("Escape")
    await page.get_by_role("button", name="Hands-free", exact=True).click()
    dialog = page.get_by_role("dialog", name="Hands-free", exact=True)
    await fit(dialog, width)
    await page.get_by_label("Activity", exact=True).select_option("reading")
    await page.get_by_label("Reading text", exact=True).fill("First page.\n\nSecond page.\n\nThird page.")
    await page.get_by_role("button", name="Next page", exact=True).click()
    await page.get_by_role("button", name="Save bookmark", exact=True).click()
    await page.get_by_role("button", name="Bookmarks (1)", exact=True).click()
    await page.get_by_label("Name for page 2", exact=True).fill("My saved place")
    await page.get_by_role("button", name="My saved place", exact=True).click()
    await expect(page.get_by_label("Reading page 2", exact=True)).to_be_focused()
    await page.get_by_role("button", name="Previous page", exact=True).click()
    await page.get_by_role("button", name="Bookmarks (1)", exact=True).click()
    await page.get_by_role("button", name="My saved place", exact=True).click()
    await expect(page.get_by_label("Reading page 2", exact=True)).to_have_text("Second page.")
    await page.wait_for_timeout(650)  # Wait for the real debounced storage write.
    await page.reload()
    await page.get_by_role("button", name="Hands-free", exact=True).click()
    await page.get_by_role("button", name="Bookmarks (1)", exact=True).click()
    await page.get_by_role("button", name="My saved place", exact=True).click()
    await expect(page.get_by_label("Reading page 2", exact=True)).to_be_focused()
    await page.screenshot(path=str(output / f"reader-{width}.png"))
    await page.get_by_role("button", name="Tune", exact=True).click()
    await page.get_by_role("button", name="Deliberate", exact=True).click()
    await expect(page.get_by_role("button", name="Deliberate", exact=True)).to_have_attribute("aria-pressed", "true")
    await page.get_by_role("button", name="Balanced", exact=True).click()
    await page.get_by_role("button", name="Learn", exact=True).click()
    await expect(page.get_by_role("button", name="Next gesture", exact=True)).to_be_disabled()
    practice = page.get_by_role("button", name="Start practice camera", exact=True)
    if width == 1280 and await practice.is_enabled():
        await practice.click()
        await expect(dialog.get_by_text("Camera on · practice only", exact=True)).to_be_visible(timeout=25000)
        await page.get_by_role("button", name="Stop camera", exact=True).click()
        await expect(dialog.get_by_text("Camera off", exact=True)).to_be_visible()
    await page.get_by_role("button", name="Control", exact=True).click()
    await page.get_by_label("Activity", exact=True).select_option("cooking")
    await page.get_by_label("One step per line", exact=True).fill("Prepare ingredients\nSimmer gently\nServe")
    await page.get_by_role("button", name="Next step", exact=True).click()
    await expect(dialog.get_by_text("Step 2 of 3", exact=True)).to_be_visible()
    await page.get_by_role("button", name="Close Hands-free", exact=True).focus()
    await page.keyboard.press("Shift+Tab")
    assert await page.evaluate("document.activeElement.closest('[aria-label=\"Hands-free\"]') !== null")
    await page.keyboard.press("Escape")
    await expect(page.get_by_role("button", name="Hands-free", exact=True)).to_be_focused()
    assert not errors, errors
    print(json.dumps({"url": url, "width": width, "journey": "passed", "console_errors": errors}), flush=True)
    await context.close()


async def timer_journey(browser, url, output):
    context = await browser.new_context(viewport={"width": 1280, "height": 900})
    page = await context.new_page()
    await enter(page, url)
    await page.get_by_role("button", name="Hands-free", exact=True).click()
    await page.get_by_label("Activity", exact=True).select_option("cooking")
    suffix = str(int(time.time() * 1000))[-6:]
    prepare, simmer = f"Prepare ingredients {suffix}", f"Simmer gently {suffix}"
    await page.get_by_label("One step per line", exact=True).fill(f"{prepare}\n{simmer}")
    duration = page.get_by_label("Timer duration (seconds)", exact=True)
    await duration.fill("60")
    await page.get_by_role("button", name="Start 1 min timer", exact=True).click()
    await expect(page.get_by_role("button", name="Timer running", exact=True)).to_be_disabled()
    await expect(page.locator(".activity-timer").filter(has_text=prepare)).to_have_count(1)
    await page.get_by_role("button", name="Next step", exact=True).click()
    await duration.fill("5")
    await page.get_by_role("button", name="Start another timer", exact=True).click()
    await expect(page.locator(".activity-timer").filter(has_text=simmer)).to_have_count(1)
    await page.get_by_role("button", name=f"Cancel timer for Step 1: {prepare}", exact=True).click()
    await expect(page.locator(".activity-timer").filter(has_text=prepare)).to_contain_text("Cancelled")
    await page.reload()
    await page.get_by_role("button", name="Hands-free", exact=True).click()
    await expect(page.locator(".activity-timer").filter(has_text=simmer).last).to_be_visible()
    await expect(page.locator(".activity-timer").filter(has_text=simmer).last).to_contain_text("Timer finished", timeout=12000)
    await page.screenshot(path=str(output / "timer-finished.png"))
    await page.get_by_role("button", name="Close Hands-free", exact=True).click()
    await (await visible(page.get_by_role("button", name="Chat", exact=True))).click()
    await expect(page.locator(".chatov.open")).to_contain_text("5 seconds timer finished for Step 2", timeout=10000)
    print(json.dumps({"timers": "start, deliberate additional start, exact cancellation, reload, expiry and Chat delivery passed"}), flush=True)
    await context.close()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:1420")
    parser.add_argument("--timers", action="store_true")
    parser.add_argument("--output", default=str(Path(tempfile.gettempdir()) / "jarvis-usability-evidence"))
    parser.add_argument("--chromium", default=os.environ.get("CHROMIUM_PATH") or shutil.which("chromium"))
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=args.chromium, args=["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
        try:
            for width in [1280, 390, 320]:
                await journey(browser, args.url, width, output)
            if args.timers:
                await timer_journey(browser, args.url, output)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
