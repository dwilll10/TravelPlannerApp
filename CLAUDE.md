# TravelPlannerApp — Claude Code Instructions

## Project Overview

A web app that generates personalized day-by-day travel itineraries using the Anthropic API. Users enter a destination, travel dates, lodging, and choose itinerary types (food, drinks, sightseeing, museums/culture, hiking/nature, shopping). Claude streams a complete guide back in real time.

Built with FastAPI (Python) on the backend and a single-page HTML/CSS/JS frontend — no framework.

---

## Project Structure

```
TravelPlannerApp/
├── main.py              # FastAPI app — endpoints, SSE streaming, rate limiting
├── prompts.py           # Dynamic prompt builder from form inputs
├── requirements.txt     # Python dependencies
├── .env                 # ANTHROPIC_API_KEY (gitignored, never commit)
├── .gitignore
└── static/
    ├── index.html       # Single-page UI
    ├── style.css        # Styling — two-panel layout, chips, tags
    └── app.js           # Form logic, SSE stream handler, PDF export, map, reset
```

---

## Running Locally

```bash
cd TravelPlannerApp
pip3 install -r requirements.txt
python3 -m uvicorn main:app --reload
```

Open `http://localhost:8000`.

The server auto-reloads on `.py` changes. For `.js`/`.html`/`.css` changes, hard refresh the browser (`Cmd+Shift+R`).

---

## Environment

- **Python:** 3.9.6 (system Python on macOS)
- **SDK:** `anthropic` via pip3 (user install at `~/Library/Python/3.9/`)
- **API key:** Set in `.env` as `ANTHROPIC_API_KEY` (also exported in `~/.zshrc`)
- **Model:** `claude-sonnet-4-6` for both `/generate` and `/refine`

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves `static/index.html` |
| `POST` | `/generate` | Streams a new itinerary (rate limited: 10/hour/IP) |
| `POST` | `/refine` | Streams an updated itinerary based on a change request (20/hour/IP) |

### `/generate` Request Body
```json
{
  "destination": "Funchal, Madeira, Portugal",
  "start_date": "2026-05-07",
  "end_date": "2026-05-11",
  "lodging": "Rua da Praia Formosa 002",
  "travelers": 2,
  "itinerary_types": ["food", "drinks", "sightseeing"],
  "food_preferences": { "style": "Local & authentic", "dietary": "", "budget_per_dinner": 100 },
  "trip_vibe": ["Foodie", "Cultural immersion"],
  "scheduled_events": [
    { "date": "2026-05-08", "time": "08:00", "description": "São Lourenço hike" }
  ],
  "custom_topic": "Wellness & spas",
  "notes": "Prefer walkable options",
  "api_key": null
}
```

### `/refine` Request Body
```json
{
  "current_itinerary": "[full markdown string]",
  "prompt": "Replace the Day 3 dinner with something closer to the hotel",
  "api_key": null
}
```

Both endpoints return `text/event-stream` SSE. Each event is `data: {"text": "..."}`. Stream ends with `data: [DONE]`. Errors are `data: {"error": "..."}`.

---

## Prompt System (`prompts.py`)

**`build_system_prompt(itinerary_types)`** — combines expertise descriptions for all selected types into a single system prompt.

**`build_user_prompt(params)`** — dynamically builds the planning request:
- If `lodging` is empty: inserts a "LODGING OPTIONS" section at the top asking for 3 real hotel recommendations
- Per-type instruction paragraphs for each selected itinerary type
- Scheduled events formatted as hard constraints
- Custom topic appended as an additional coverage section
- Output format instructions with day headers and reference sections
- Appends a `json:locations` fenced block instruction asking Claude to emit lat/lng coordinates for every venue (used by the frontend map)

**`_type_specific_instructions()`** — generates one focused paragraph per type:
- `food` — meals, budget, brunch, coffee spots
- `drinks` — bar timing, tastings, aperitivo shortlist
- `sightseeing` — landmarks, best timing, booking flags
- `museums_culture` — hours, skip-the-line tips
- `hiking_nature` — trails, difficulty, logistics
- `shopping` — markets, local products

---

## Frontend (`static/`)

### Key UI Elements
- **Type chips** — multi-select, toggle `.active` class on click; food chip shows/hides sub-options panel
- **Vibe tags** — multi-select pill toggles
- **Planned events** — dynamic add/remove rows (date + time + description); injected as hard constraints into the prompt
- **Interactive map** — Leaflet.js + OpenStreetMap; appears below itinerary after generation with color-coded pins per type (food=red, drinks=purple, sightseeing=green, museums=blue, hiking=dark green, shopping=orange); click pins for venue name, day, and type; toggle show/hide; updates on refine, clears on reset
- **Download Map** — exports a self-contained HTML file with the interactive Leaflet map (all markers, legend, full-screen); opens in any browser standalone
- **Refine box** — appears after generation completes; sends current markdown + a change request to `/refine`
- **Reset button** — clears all fields, chips, tags, events, output, and map; restores default dates
- **Download PDF** — uses `html2pdf.js` (CDN) to render the output panel to A4 PDF
- **Copy** — copies raw markdown to clipboard

### Location Data Flow
The prompt instructs Claude to append a `` ```json:locations `` fenced block at the end of every itinerary containing `{name, lat, lng, day, type, meal}` for each venue. After streaming completes, `extractLocations()` parses and strips this block from `rawMarkdown` (so it never appears in the rendered output), then `renderMap()` plots the markers. The same flow runs for `/refine` responses.

### SSE Streaming Pattern
```javascript
const res = await fetch('/generate', { method: 'POST', body: JSON.stringify(data) });
const reader = res.body.getReader();
// read chunks → split on '\n' → parse 'data: {...}' lines → accumulate rawMarkdown → re-render with marked.js
```

### `e.preventDefault()` on Chips/Tags
Type chips and vibe tags use `<label>` wrapping `<input type="checkbox">`. Without `preventDefault()`, the click fires twice (once on label, once bubbled from checkbox), canceling the toggle. All chip/tag click handlers call `e.preventDefault()`.

---

## Rate Limiting

Uses `slowapi`. Applied to both endpoints:
- `/generate` — 10 requests/hour per IP
- `/refine` — 20 requests/hour per IP

Users who provide their own Anthropic API key via the UI field bypass rate limits entirely. This is implemented via a custom `_rate_limit_key()` function that returns an empty string (which slowapi skips) when `api_key` is present in the request body. A `_CacheBodyMiddleware` caches the raw request body on `request.state` so the key function can read it before FastAPI consumes the stream.

---

## Deployment (Render)

- **Build command:** `pip install -r requirements.txt`
- **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Environment variable:** `ANTHROPIC_API_KEY` set in Render dashboard
- Auto-redeploys on every push to `main` branch

Static file paths use `Path(__file__).parent` (absolute) so they resolve correctly regardless of the working directory Render uses at startup.

---

## Key Design Decisions

- **Single Claude call** (not multi-agent): Sonnet handles the full itinerary in one streaming call. Faster and cheaper than the multi-agent approach used in MadeiraFoodPlan scripts; quality is sufficient for a general-purpose tool.
- **SSE over WebSockets**: Simpler for one-directional streaming; FastAPI's `StreamingResponse` handles it natively.
- **No JS framework**: The UI is plain HTML/CSS/JS. Simple enough that a framework would add complexity without benefit.
- **Absolute static paths**: `BASE_DIR = Path(__file__).parent` prevents path failures when the working directory differs between local dev and Render.
- **Refinement preserves context**: `/refine` receives the full current itinerary as context so Claude can make surgical edits without regenerating from scratch.
- **Prompt-based coordinates**: Rather than geocoding venue names via an external API (Nominatim, Google), the prompt asks Claude to include lat/lng in a JSON block. Simpler, no external API dependency, and accurate enough for a planning map.
- **Standalone map export**: The "Download Map" button generates a self-contained HTML file with Leaflet CDN references and inline marker data — no server needed to view it.
