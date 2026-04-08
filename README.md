# dwill's Travel Planner

An AI-powered web app that generates personalized day-by-day travel itineraries. Enter your destination, dates, and preferences — Claude streams a complete guide back in real time.

## Features

- **Multi-type itineraries** — combine Food & Dining, Bars & Drinks, Sightseeing, Museums & Culture, Hiking & Nature, Shopping, or any custom topic
- **Planned events** — add hikes, tours, and reservations; the AI plans around them as hard constraints
- **Lodging suggestions** — leave lodging blank and get 3 curated hotel recommendations at the top of your itinerary
- **Live streaming** — output streams word-by-word as Claude generates it
- **Refine after generation** — ask for changes without regenerating from scratch ("swap the Day 3 dinner", "add a morning activity on Day 2")
- **PDF export** — download a clean A4 PDF of your itinerary
- **Reset** — clear everything and start fresh for a new trip
- **Bring your own API key** — paste your Anthropic key to bypass rate limits

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python · FastAPI · Server-Sent Events |
| AI | Anthropic API (`claude-sonnet-4-6`) |
| Frontend | HTML · CSS · Vanilla JS |
| PDF export | html2pdf.js |
| Markdown rendering | marked.js |
| Rate limiting | slowapi |
| Hosting | Render |

## Running Locally

**Prerequisites:** Python 3.9+, an [Anthropic API key](https://console.anthropic.com)

```bash
git clone https://github.com/dwilll10/TravelPlannerApp.git
cd TravelPlannerApp

pip3 install -r requirements.txt

# Create .env file
echo "ANTHROPIC_API_KEY=your_key_here" > .env

python3 -m uvicorn main:app --reload
```

Open `http://localhost:8000`.

## How It Works

1. **Fill in the form** — destination, dates, lodging (optional), traveler count
2. **Select itinerary types** — pick one or more categories
3. **Add planned events** — any hikes, tours, or reservations with date and time
4. **Generate** — Claude streams a complete day-by-day guide
5. **Refine** — use the prompt box at the bottom to adjust anything
6. **Export** — download as PDF or copy to clipboard

## Project Structure

```
TravelPlannerApp/
├── main.py          # FastAPI app, SSE streaming, rate limiting
├── prompts.py       # Dynamic prompt builder
├── requirements.txt
├── CLAUDE.md        # Developer/Claude Code instructions
└── static/
    ├── index.html   # UI
    ├── style.css
    └── app.js       # Streaming, form logic, PDF export
```

## Deploying to Render

1. Fork or push this repo to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Connect your GitHub repo
4. Set:
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Environment variable:** `ANTHROPIC_API_KEY`
5. Deploy — Render auto-redeploys on every push to `main`

## Rate Limits

- 10 itinerary generations per hour per IP (using the server key)
- 20 refinements per hour per IP
- No limit when using your own Anthropic API key (entered in the UI)
