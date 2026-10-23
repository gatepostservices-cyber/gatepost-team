# Gatepost Team

Phone-first web app (PWA) for Gatepost Property Services team members. No login, no pricing, no backend.
Questions: (505) 750-3019.

## Door-to-door route tracker
- Start screen: pick neighborhood, pick session (Red / Blue / Gold), Start. Dark map (OSM tiles with a CSS dark filter) with glowing animated route; done steps grey out. HUD shows a progress ring, doors, streets and miles; the nav card shows a big turn arrow, the next action, knock mode and distance left. Checklist, streets, parking and rules live in a bottom sheet. Session end shows a stats screen with badges (full route, GPS tracked, day streak, neighborhood cleared).
- Pulsing GPS dot with heading cone and accuracy circle; auto-follow keeps the dot centered in the visible map area above the panels. Step/street completion pops a toast and vibrates where supported.
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

## Home, clock in/out and shift data
- First run asks for the worker's name and an optional 4-digit PIN (stored as a SHA-256 hash with a generated worker id in localStorage `gpteam_worker_v1`). If a PIN is set it is required to clock in/out.
- Home: Clock In/Out with running timer, hours this week + total hours (computed only from this phone's own shifts, `gpteam_hours_v1`), and the route tracker button. Workers see no houses, pace, miles or other performance data.
- While clocked in the app silently records, per checked step: estimated homes (session homes x step length / knocking length), estimated minutes (20 min/mi + 0.75 min/home), miles; plus time actually spent in route sessions. On Clock Out one row goes to Supabase `public.team_shifts` (anon INSERT only; admins read via `is_admin()`), queued in `gpteam_outbox_v1` and retried every 60 s / when back online. `pace_ratio` = actual route minutes / estimated minutes (under 1.0 = faster).
- `config.js` holds the public Supabase URL + publishable key only.
