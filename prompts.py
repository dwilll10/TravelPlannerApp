"""
Dynamic prompt builder for the Travel Planner app.
Constructs system + user prompts based on form inputs.
"""

from datetime import datetime, date, timedelta
from typing import Optional


TYPE_EXPERTISE = {
    "food": "local food scenes, restaurant culture, cuisine traditions, market food, coffee culture",
    "drinks": "bar culture, wine regions and tastings, craft spirits, cocktail bars, local drinking traditions",
    "sightseeing": "landmarks, viewpoints, scenic drives, photography spots, iconic sites",
    "museums_culture": "museums, galleries, historic sites, cultural institutions, local history",
    "hiking_nature": "hiking trails, nature reserves, beaches, waterfalls, scenic walks",
    "shopping": "local markets, artisan crafts, specialty food shops, souvenirs, shopping neighborhoods",
}

TYPE_LABELS = {
    "food": "Food & Dining",
    "drinks": "Bars & Drinks",
    "sightseeing": "Sightseeing & Landmarks",
    "museums_culture": "Museums & Culture",
    "hiking_nature": "Hiking & Nature",
    "shopping": "Shopping & Markets",
}


def build_system_prompt(itinerary_types: list[str]) -> str:
    expertise_areas = [TYPE_EXPERTISE[t] for t in itinerary_types if t in TYPE_EXPERTISE]
    expertise_str = ", ".join(expertise_areas)

    return f"""You are an expert travel itinerary planner specializing in authentic, deeply researched travel guides. \
You have deep expertise in: {expertise_str}.

Your guiding principles:
- Use REAL venue names that actually exist at the destination — never invent or guess names
- Structure output as a clear day-by-day guide using ## DAY X — [Weekday, Date] headers
- For every recommendation include: venue name, why it's the right pick, approximate distance/travel time from lodging, and best timing
- Tailor every suggestion to the traveler's specific lodging location and any scheduled events they have
- Be logistics-aware: cluster geographically, adjust meals around early departures, suggest area-specific options when travelers are far from their lodging
- Balance variety: no venue repeated, diverse cuisine/experience types across days
- Be opinionated — pick the best option, explain why, and flag what makes it unmissable
- When specific events are scheduled (hikes, tours, reservations), treat them as hard constraints and plan around them explicitly"""


def _format_events(events: list[dict], start_date: date) -> str:
    if not events:
        return "None — fully flexible schedule."

    lines = []
    for ev in sorted(events, key=lambda e: (e.get("date", ""), e.get("time", ""))):
        ev_date_str = ev.get("date", "")
        ev_time = ev.get("time", "")
        ev_desc = ev.get("description", "")

        # Human-readable date
        try:
            ev_date = datetime.strptime(ev_date_str, "%Y-%m-%d").date()
            day_num = (ev_date - start_date).days + 1
            weekday = ev_date.strftime("%A, %b %-d")
            date_label = f"Day {day_num} ({weekday})"
        except (ValueError, TypeError):
            date_label = ev_date_str

        time_label = f" @ {ev_time}" if ev_time else ""
        lines.append(f"  - {date_label}{time_label}: {ev_desc}")

    return "\n".join(lines)


def _type_specific_instructions(itinerary_types: list[str], food_prefs: dict, custom_topic: str = "") -> str:
    sections = []

    if "food" in itinerary_types:
        budget = food_prefs.get("budget_per_dinner", 0)
        budget_note = f" Hard cap: no dinner over ${budget}/person (all-in)." if budget else ""
        cuisine_style = food_prefs.get("style", "")
        cuisine_note = f" Cuisine preference: {cuisine_style}." if cuisine_style else ""
        dietary = food_prefs.get("dietary", "")
        dietary_note = f" Dietary restrictions: {dietary}." if dietary else ""

        sections.append(
            f"FOOD & DINING: Plan breakfast, lunch, and dinner for each day.{budget_note}{cuisine_note}{dietary_note} "
            "On days with free mornings consider proposing a brunch instead of separate breakfast + lunch when it improves the day's flow. "
            "Include a COFFEE SPOTS section at the end listing the 3-5 best cafés within 20-minute walk of the lodging. "
            "For each dinner include an estimated cost per person."
        )

    if "drinks" in itinerary_types:
        sections.append(
            "BARS & DRINKS: Suggest 1-3 drink experiences per day timed around meals and activities — "
            "pre-dinner aperitivo, post-dinner bar, afternoon tasting, or standalone experience. "
            "Cover the destination's signature drinks (local wines, spirits, cocktails). "
            "Include one standout tasting experience (wine lodge, distillery, brewery) as a dedicated half-day activity. "
            "Include a PRE-DINNER APERITIVO SPOTS shortlist at the end."
        )

    if "sightseeing" in itinerary_types:
        sections.append(
            "SIGHTSEEING: Recommend specific landmarks, viewpoints, and iconic sites for each day. "
            "Note best time of day to visit (avoid crowds, best light for photos). "
            "Flag which sites need advance booking."
        )

    if "museums_culture" in itinerary_types:
        sections.append(
            "MUSEUMS & CULTURE: Recommend the most worthwhile cultural institutions — be selective, not exhaustive. "
            "Include opening hours context, expected time needed, and whether skip-the-line booking is worthwhile. "
            "Pair with nearby lunch spots."
        )

    if "hiking_nature" in itinerary_types:
        sections.append(
            "HIKING & NATURE: Recommend specific trails or natural sites with difficulty level, distance/duration, "
            "trailhead logistics, and what makes each one unmissable. Flag any that require early starts or permits."
        )

    if "shopping" in itinerary_types:
        sections.append(
            "SHOPPING: Highlight the best markets, artisan shops, and local specialty stores. "
            "Note which days markets operate and the best time to visit. "
            "Focus on authentic local products rather than tourist shops."
        )

    if custom_topic:
        sections.append(
            f"{custom_topic.upper()}: Include specific recommendations for {custom_topic} at this destination. "
            "Use real, verifiable venues or locations. Note timing, logistics, and what makes each pick unmissable."
        )

    return "\n\n".join(sections)


def build_user_prompt(params: dict) -> str:
    destination = params.get("destination", "")
    start_date_str = params.get("start_date", "")
    end_date_str = params.get("end_date", "")
    lodging = params.get("lodging", "")
    travelers = params.get("travelers", 1)
    itinerary_types = params.get("itinerary_types", [])
    food_prefs = params.get("food_preferences", {})
    trip_vibe = params.get("trip_vibe", [])
    scheduled_events = params.get("scheduled_events", [])
    notes = params.get("notes", "")
    custom_topic = params.get("custom_topic", "").strip()

    # Parse dates
    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
        num_days = (end_date - start_date).days + 1
        date_range = f"{start_date.strftime('%B %-d')}–{end_date.strftime('%-d, %Y')}"
    except (ValueError, TypeError):
        start_date = date.today()
        num_days = 1
        date_range = f"{start_date_str} to {end_date_str}"

    # Build day list
    day_list = []
    for i in range(num_days):
        d = start_date + timedelta(days=i)
        day_list.append(f"Day {i+1}: {d.strftime('%A, %B %-d, %Y')}")
    days_str = "\n".join(f"  {d}" for d in day_list)

    # Format vibe
    vibe_str = ", ".join(trip_vibe) if trip_vibe else "No specific preference"

    # Format types
    type_labels = [TYPE_LABELS.get(t, t) for t in itinerary_types]
    if custom_topic:
        type_labels.append(custom_topic)
    types_str = ", ".join(type_labels)

    # Format events
    events_str = _format_events(scheduled_events, start_date)

    # Type-specific instructions
    type_instructions = _type_specific_instructions(itinerary_types, food_prefs, custom_topic)

    # Notes
    notes_section = f"\nADDITIONAL NOTES FROM TRAVELER:\n{notes}" if notes.strip() else ""

    # Lodging
    if lodging.strip():
        lodging_line = f"  Lodging: {lodging}"
        lodging_instruction = ""
    else:
        lodging_line = "  Lodging: Not specified"
        lodging_instruction = """
LODGING RECOMMENDATIONS:
The traveler has not chosen lodging yet. Before the day-by-day itinerary, recommend exactly 3 hotels or accommodations at this destination. For each include:
- Name (must be a real, bookable property)
- Neighborhood and why the location is strategic for this trip
- 1-2 sentences on what makes it stand out (vibe, amenities, value, views, etc.)
- Approximate price range per night

Format as:
## LODGING OPTIONS
### Option 1: [Name]
[neighborhood] | [price range/night]
[Why it's a great base for this trip]

### Option 2: [Name]
...

### Option 3: [Name]
...

---

Then proceed with the day-by-day itinerary, using a central/well-located area of the destination as the reference point for distance estimates.
"""

    prompt = f"""Plan a {num_days}-day trip to {destination}.

TRIP DETAILS:
  Destination: {destination}
  Dates: {date_range} ({num_days} days)
{lodging_line}
  Travelers: {travelers}
  Trip vibe: {vibe_str}

DAYS:
{days_str}

SCHEDULED EVENTS (hard constraints — plan everything around these):
{events_str}

ITINERARY COVERAGE REQUESTED: {types_str}

{type_instructions}{notes_section}
{lodging_instruction}
OUTPUT FORMAT:

For each day use this structure:
## DAY [N] — [Weekday, Month Day, Year][any scheduled event for that day]

Then include a section for each requested coverage type, with specific recommendations.
Every recommendation must include:
- Venue/location name (real, verifiable)
- Why this specific pick is right for this day and moment
- Distance or travel time from lodging (walk/taxi/drive)
- Best timing

After all daily sections, include:
## KEY DECISIONS
[5-7 bullets explaining the most important choices and trade-offs]

## DON'T MISS
[3-5 experiences that are truly unmissable — the ones that define this trip]

{_reference_sections(itinerary_types)}"""

    return prompt


def _reference_sections(itinerary_types: list[str]) -> str:
    sections = []
    if "food" in itinerary_types:
        sections.append("## COFFEE SPOTS\n[Top cafés near the lodging with name, specialty, vibe, walk time]")
    if "drinks" in itinerary_types:
        sections.append("## PRE-DINNER APERITIVO SPOTS\n[Top 4-5 spots ideal for 6–8 PM drinks, with description and walk time]")
    return "\n\n".join(sections) if sections else ""
