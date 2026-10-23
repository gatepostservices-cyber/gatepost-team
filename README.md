# Gatepost Team

Phone-first web app (PWA) for Gatepost Property Services team members. No login, no pricing, no backend.
Questions: (505) 750-3019.

## Door-to-door route tracker
- Pick a neighborhood and session (Red / Blue / Gold). The map draws the route; the Parking button (P) opens Google Maps directions.
- Live GPS blue dot with accuracy circle. Floating glass directions panel shows the current step (instruction, street, knock mode/side/pass, distance left) and the next 2 steps. Tap the handle to cycle: normal → expanded (all steps, streets, parking, rules) → slim bar.
- Auto-check: the position is projected onto the current step's segment (only forward of the progress already made, so out-and-back cul-de-sac legs are not confused). When progress reaches within 20 m of the segment end (and the walker is near the end point), the step is checked and the next one starts. Readings with accuracy worse than 50 m are ignored. A street is checked once all its knocking steps are done. Steps can also be checked/unchecked by hand.
- Progress is saved in localStorage per neighborhood + round + session (`gpteam_progress_v1:<slug>:r<round>:s<n>`).
- If location is blocked, the app says so and manual checking still works.

## Route data (no code changes needed for new routes)
`data/` holds `index.json` + one `<slug>.geojson` per neighborhood, format described in `data/SCHEMA.md`. The app loads every
neighborhood listed in `index.json` (round > 1 shows as "(round N)").

To add a neighborhood or round-2 routes:
```
cd /workspace/d2d/v2
python3 d2d.py --geojson-only --name "..." --lat .. --lon .. --radius .. --park-name "..." --park-lat .. --park-lon .. [--round 2] --geojson-out ../app_data
cp /workspace/d2d/app_data/index.json /workspace/d2d/app_data/*.geojson /workspace/d2d/app_data/SCHEMA.md data/
```
Then bump `VERSION` in `sw.js`, commit, push (GitHub Pages redeploys).

## Test
```
python3 -m http.server 47613 --bind 127.0.0.1 &
python3 tools/test_playwright.py   # Chromium + WebKit at 390x844, mocked GPS walk along Red steps 1-6, screenshots to /workspace/team-preview
```
Logo/icons in `img/` are copied from the official Gatepost assets.
