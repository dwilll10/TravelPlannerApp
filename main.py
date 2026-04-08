import json
import os
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).parent

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from prompts import build_system_prompt, build_user_prompt

load_dotenv()

# Rate limit: 10 requests/hour per IP when using the server key.
# Users who supply their own API key bypass this limit.
limiter = Limiter(key_func=get_remote_address, default_limits=["10/hour"])

app = FastAPI(title="Travel Planner")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 8192


class FoodPreferences(BaseModel):
    style: str = ""
    dietary: str = ""
    budget_per_dinner: Optional[int] = None


class ScheduledEvent(BaseModel):
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    description: str


class GenerateRequest(BaseModel):
    destination: str
    start_date: str
    end_date: str
    lodging: str = ""
    travelers: int = 1
    itinerary_types: list[str]
    food_preferences: FoodPreferences = FoodPreferences()
    trip_vibe: list[str] = []
    scheduled_events: list[ScheduledEvent] = []
    custom_topic: str = ""
    notes: str = ""
    api_key: Optional[str] = None


@app.get("/", response_class=HTMLResponse)
async def root():
    return (BASE_DIR / "static" / "index.html").read_text()


class RefineRequest(BaseModel):
    current_itinerary: str
    prompt: str
    api_key: Optional[str] = None


@app.post("/generate")
@limiter.limit("10/hour")
async def generate(request: Request, req: GenerateRequest):
    if not req.itinerary_types:
        raise HTTPException(status_code=400, detail="Select at least one itinerary type.")

    api_key = req.api_key or os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="No API key configured.")

    # Build prompts
    params = req.model_dump()
    params["food_preferences"] = req.food_preferences.model_dump()
    params["scheduled_events"] = [e.model_dump() for e in req.scheduled_events]

    system_prompt = build_system_prompt(req.itinerary_types)
    user_prompt = build_user_prompt(params)

    async def stream_response():
        try:
            client = anthropic.Anthropic(api_key=api_key)
            with client.messages.stream(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield "data: [DONE]\n\n"
        except anthropic.AuthenticationError:
            yield f"data: {json.dumps({'error': 'Invalid API key.'})}\n\n"
        except anthropic.RateLimitError:
            yield f"data: {json.dumps({'error': 'Rate limit reached. Please try again in a moment.'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': f'Generation failed: {str(e)}'})}\n\n"

    return StreamingResponse(
        stream_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/refine")
@limiter.limit("20/hour")
async def refine(request: Request, req: RefineRequest):
    if not req.current_itinerary.strip():
        raise HTTPException(status_code=400, detail="No itinerary to refine.")
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Please enter a refinement request.")

    api_key = req.api_key or os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="No API key configured.")

    system = (
        "You are a travel itinerary editor. The user has an existing itinerary and wants to modify it. "
        "Apply their requested changes and return the complete updated itinerary in the same markdown format. "
        "Keep everything that isn't affected by the change intact. Be specific and practical."
    )

    messages = [
        {
            "role": "user",
            "content": (
                f"Here is my current itinerary:\n\n{req.current_itinerary}\n\n"
                f"Please make this change: {req.prompt}"
            ),
        }
    ]

    async def stream_response():
        try:
            client = anthropic.Anthropic(api_key=api_key)
            with client.messages.stream(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield "data: [DONE]\n\n"
        except anthropic.AuthenticationError:
            yield f"data: {json.dumps({'error': 'Invalid API key.'})}\n\n"
        except anthropic.RateLimitError:
            yield f"data: {json.dumps({'error': 'Rate limit reached. Please try again in a moment.'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': f'Refinement failed: {str(e)}'})}\n\n"

    return StreamingResponse(
        stream_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
