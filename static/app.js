'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let isGenerating = false;
let rawMarkdown = '';
let mapInstance = null;
let currentLocations = [];

// ── DOM refs ───────────────────────────────────────────────────────────────
const form            = document.getElementById('planner-form');
const generateBtn     = document.getElementById('btn-generate');
const outputPanel     = document.getElementById('output-panel');
const placeholder     = document.getElementById('output-placeholder');
const outputHeader    = document.getElementById('output-header');
const outputEl        = document.getElementById('itinerary-output');
const statusBar       = document.getElementById('status-bar');
const statusText      = document.getElementById('status-text');
const spinnerEl       = document.getElementById('spinner');
const btnDownload     = document.getElementById('btn-download');
const btnDownloadMap  = document.getElementById('btn-download-map');
const btnCopy         = document.getElementById('btn-copy');
const btnReset        = document.getElementById('btn-reset');
const refineBox       = document.getElementById('refine-box');
const refinePrompt    = document.getElementById('refine-prompt');
const btnRefine       = document.getElementById('btn-refine');
const eventsList      = document.getElementById('events-list');
const addEventBtn     = document.getElementById('btn-add-event');
const foodOptions     = document.getElementById('food-options');
const foodChip        = document.getElementById('chip-food');
const mapSection      = document.getElementById('map-section');
const mapContainer    = document.getElementById('map-container');
const btnToggleMap    = document.getElementById('btn-toggle-map');

// ── Type chips ─────────────────────────────────────────────────────────────
document.querySelectorAll('.type-chip').forEach(chip => {
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    chip.classList.toggle('active');
    const cb = chip.querySelector('input[type="checkbox"]');
    cb.checked = chip.classList.contains('active');

    // Show/hide food options
    if (chip.id === 'chip-food') {
      foodOptions.classList.toggle('visible', chip.classList.contains('active'));
    }
  });
});

// ── Vibe tags ──────────────────────────────────────────────────────────────
document.querySelectorAll('.vibe-tag').forEach(tag => {
  tag.addEventListener('click', (e) => {
    e.preventDefault();
    tag.classList.toggle('active');
    const cb = tag.querySelector('input[type="checkbox"]');
    cb.checked = tag.classList.contains('active');
  });
});

// ── Planned events ─────────────────────────────────────────────────────────
function createEventRow(dateVal = '', timeVal = '', descVal = '') {
  const row = document.createElement('div');
  row.className = 'event-row';
  row.innerHTML = `
    <input type="date" class="ev-date" value="${dateVal}" placeholder="Date">
    <input type="time" class="ev-time" value="${timeVal}" placeholder="Time">
    <input type="text"  class="ev-desc" value="${descVal}" placeholder="e.g. São Lourenço hike">
    <button type="button" class="btn-remove-event" title="Remove">✕</button>
  `;
  row.querySelector('.btn-remove-event').addEventListener('click', () => row.remove());
  return row;
}

addEventBtn.addEventListener('click', () => {
  // Default date to start_date value if available
  const startDate = document.getElementById('start-date').value;
  eventsList.appendChild(createEventRow(startDate));
});

// ── Form serialization ─────────────────────────────────────────────────────
function serializeForm() {
  const get  = id => document.getElementById(id)?.value?.trim() || '';
  const getN = id => parseInt(document.getElementById(id)?.value, 10) || 1;

  const itineraryTypes = [...document.querySelectorAll('.type-chip.active')]
    .map(c => c.dataset.type);

  const tripVibe = [...document.querySelectorAll('.vibe-tag.active')]
    .map(t => t.dataset.vibe);

  const scheduledEvents = [...eventsList.querySelectorAll('.event-row')]
    .map(row => ({
      date:        row.querySelector('.ev-date')?.value || '',
      time:        row.querySelector('.ev-time')?.value || '',
      description: row.querySelector('.ev-desc')?.value?.trim() || '',
    }))
    .filter(e => e.description);

  const budgetRaw = get('food-budget');
  const budget = budgetRaw ? parseInt(budgetRaw, 10) : null;

  return {
    destination:    get('destination'),
    start_date:     get('start-date'),
    end_date:       get('end-date'),
    lodging:        get('lodging'),
    travelers:      getN('travelers'),
    itinerary_types: itineraryTypes,
    food_preferences: {
      style:            get('food-style'),
      dietary:          get('food-dietary'),
      budget_per_dinner: budget,
    },
    trip_vibe:        tripVibe,
    scheduled_events: scheduledEvents,
    custom_topic:     get('custom-topic'),
    notes:            get('notes'),
    api_key:          get('api-key') || null,
  };
}

// ── Validation ─────────────────────────────────────────────────────────────
function validate(data) {
  if (!data.destination) return 'Please enter a destination.';
  if (!data.start_date)  return 'Please select a start date.';
  if (!data.end_date)    return 'Please select an end date.';
  if (data.start_date > data.end_date) return 'End date must be after start date.';
  if (!data.itinerary_types.length) return 'Select at least one itinerary type.';
  return null;
}

// ── Streaming generation ───────────────────────────────────────────────────
generateBtn.addEventListener('click', async () => {
  if (isGenerating) return;

  clearError();
  const data = serializeForm();
  const err = validate(data);
  if (err) { showError(err); return; }

  isGenerating = true;
  rawMarkdown = '';
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating…';
  btnDownload.disabled = true;
  btnCopy.disabled = true;

  placeholder.style.display = 'none';
  outputHeader.style.display = 'flex';
  outputEl.innerHTML = '';
  setStatus('Generating your itinerary…', true);

  try {
    const res = await fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Server error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // incomplete line stays in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;

        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.text) {
            rawMarkdown += parsed.text;
            renderMarkdown();
          }
        } catch (parseErr) {
          if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
        }
      }
    }

    setStatus('Done!', false);
    btnDownload.disabled = false;
    btnCopy.disabled = false;
    refineBox.style.display = 'block';

    // Extract locations and render map
    const { cleanMarkdown, locations } = extractLocations(rawMarkdown);
    rawMarkdown = cleanMarkdown;
    renderMarkdown();
    renderMap(locations);

  } catch (e) {
    showError(e.message || 'Something went wrong.');
    setStatus('', false);
  } finally {
    isGenerating = false;
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Itinerary';
  }
});

// ── Markdown rendering ─────────────────────────────────────────────────────
function renderMarkdown() {
  if (typeof marked !== 'undefined') {
    outputEl.innerHTML = marked.parse(rawMarkdown);
  } else {
    // Fallback: plain text with basic line breaks
    outputEl.textContent = rawMarkdown;
  }
}

// ── Map helpers ───────────────────────────────────────────────────────────
const TYPE_COLORS = {
  food:            '#e63946',
  drinks:          '#9b5de5',
  sightseeing:     '#06d6a0',
  museums_culture: '#118ab2',
  hiking_nature:   '#2d6a4f',
  shopping:        '#f4a261',
};

function extractLocations(markdown) {
  const regex = /```json:locations\s*\n(\[[\s\S]*?\])\s*\n```\s*$/;
  const match = markdown.match(regex);
  if (!match) return { cleanMarkdown: markdown, locations: [] };
  try {
    const locations = JSON.parse(match[1]);
    const cleanMarkdown = markdown.replace(regex, '').trimEnd();
    return { cleanMarkdown, locations };
  } catch (e) {
    console.warn('Failed to parse locations JSON:', e);
    return { cleanMarkdown: markdown, locations: [] };
  }
}

function renderMap(locations) {
  currentLocations = locations;
  if (!locations.length) {
    mapSection.style.display = 'none';
    btnDownloadMap.style.display = 'none';
    btnDownloadMap.disabled = true;
    return;
  }

  mapSection.style.display = 'block';
  mapContainer.style.display = 'block';
  btnToggleMap.textContent = 'Hide Map';
  btnDownloadMap.style.display = '';
  btnDownloadMap.disabled = false;

  if (mapInstance) { mapInstance.remove(); mapInstance = null; }

  const lats = locations.map(l => l.lat);
  const lngs = locations.map(l => l.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  mapInstance = L.map('map-container').setView([centerLat, centerLng], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(mapInstance);

  const bounds = L.latLngBounds();
  locations.forEach(loc => {
    const color = TYPE_COLORS[loc.type] || '#333';
    const marker = L.circleMarker([loc.lat, loc.lng], {
      radius: 8,
      fillColor: color,
      color: '#fff',
      weight: 2,
      fillOpacity: 0.9,
    }).addTo(mapInstance);

    const typeLabel = (loc.type || '').replace('_', ' & ');
    const mealInfo = loc.meal ? ` (${loc.meal})` : '';
    marker.bindPopup(
      `<strong>${loc.name}</strong><br>Day ${loc.day} · ${typeLabel}${mealInfo}`
    );
    bounds.extend([loc.lat, loc.lng]);
  });

  if (locations.length > 1) {
    mapInstance.fitBounds(bounds, { padding: [40, 40] });
  }
}

btnToggleMap.addEventListener('click', () => {
  const isVisible = mapContainer.style.display !== 'none';
  mapContainer.style.display = isVisible ? 'none' : 'block';
  btnToggleMap.textContent = isVisible ? 'Show Map' : 'Hide Map';
  if (!isVisible && mapInstance) {
    setTimeout(() => mapInstance.invalidateSize(), 100);
  }
});

function buildMapHTML(locations, destination) {
  const lats = locations.map(l => l.lat);
  const lngs = locations.map(l => l.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const markersJS = locations.map(loc => {
    const color = TYPE_COLORS[loc.type] || '#333';
    const typeLabel = (loc.type || '').replace('_', ' & ');
    const mealInfo = loc.meal ? ` (${loc.meal})` : '';
    const popup = `<strong>${loc.name.replace(/'/g, "\\'")}</strong><br>Day ${loc.day} &middot; ${typeLabel}${mealInfo}`;
    return `  L.circleMarker([${loc.lat}, ${loc.lng}], {radius:8, fillColor:'${color}', color:'#fff', weight:2, fillOpacity:0.9}).addTo(map).bindPopup('${popup}');`;
  }).join('\n');

  const boundsJS = locations.length > 1
    ? `map.fitBounds([${locations.map(l => `[${l.lat},${l.lng}]`).join(',')}], {padding:[40,40]});`
    : '';

  const title = destination ? `${destination} — Trip Map` : 'Trip Map';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; }
  #map { width: 100vw; height: 100vh; }
  .legend { position: absolute; bottom: 20px; left: 20px; background: white; padding: 12px 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 1000; font-size: 13px; line-height: 1.8; }
  .legend-dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
</style>
</head>
<body>
<div id="map"></div>
<div class="legend">
  <strong>${title}</strong><br>
  <span class="legend-dot" style="background:#e63946"></span>Food
  <span class="legend-dot" style="background:#9b5de5;margin-left:8px"></span>Drinks
  <span class="legend-dot" style="background:#06d6a0;margin-left:8px"></span>Sightseeing<br>
  <span class="legend-dot" style="background:#118ab2"></span>Museums & Culture
  <span class="legend-dot" style="background:#2d6a4f;margin-left:8px"></span>Hiking & Nature
  <span class="legend-dot" style="background:#f4a261;margin-left:8px"></span>Shopping
</div>
<script>
var map = L.map('map').setView([${centerLat}, ${centerLng}], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
}).addTo(map);
${markersJS}
${boundsJS}
</script>
</body>
</html>`;
}

btnDownloadMap.addEventListener('click', () => {
  if (!currentLocations.length) return;
  const destination = document.getElementById('destination').value.trim();
  const html = buildMapHTML(currentLocations, destination);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = destination ? destination.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '') : 'trip';
  a.href = url;
  a.download = `${slug}-map.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ── Refine ─────────────────────────────────────────────────────────────────
btnRefine.addEventListener('click', async () => {
  const prompt = refinePrompt.value.trim();
  if (!prompt || isGenerating) return;

  clearError();
  isGenerating = true;
  btnRefine.disabled = true;
  btnRefine.textContent = 'Updating…';
  btnDownload.disabled = true;
  btnCopy.disabled = true;
  setStatus('Updating your itinerary…', true);

  const apiKey = document.getElementById('api-key')?.value?.trim() || null;
  const previousMarkdown = rawMarkdown;
  rawMarkdown = '';
  outputEl.innerHTML = '';

  try {
    const res = await fetch('/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_itinerary: previousMarkdown,
        prompt,
        api_key: apiKey,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Server error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.text) { rawMarkdown += parsed.text; renderMarkdown(); }
        } catch (parseErr) {
          if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
        }
      }
    }

    refinePrompt.value = '';
    setStatus('Updated!', false);
    btnDownload.disabled = false;
    btnCopy.disabled = false;

    // Extract locations and render map
    const { cleanMarkdown: refinedClean, locations: refinedLocs } = extractLocations(rawMarkdown);
    rawMarkdown = refinedClean;
    renderMarkdown();
    renderMap(refinedLocs);

  } catch (e) {
    rawMarkdown = previousMarkdown;
    renderMarkdown();
    showError(e.message || 'Refinement failed.');
    setStatus('', false);
  } finally {
    isGenerating = false;
    btnRefine.disabled = false;
    btnRefine.textContent = 'Update';
  }
});

// ── Reset ──────────────────────────────────────────────────────────────────
btnReset.addEventListener('click', () => {
  if (isGenerating) return;

  // Clear text inputs and textareas
  form.querySelectorAll('input[type="text"], input[type="number"], input[type="date"], input[type="time"], input[type="password"], textarea').forEach(el => {
    el.value = '';
  });

  // Reset travelers
  document.getElementById('travelers').value = 2;

  // Deselect all type chips
  document.querySelectorAll('.type-chip').forEach(chip => {
    chip.classList.remove('active');
    chip.querySelector('input[type="checkbox"]').checked = false;
  });
  foodOptions.classList.remove('visible');

  // Deselect all vibe tags
  document.querySelectorAll('.vibe-tag').forEach(tag => {
    tag.classList.remove('active');
    tag.querySelector('input[type="checkbox"]').checked = false;
  });

  // Clear events
  eventsList.innerHTML = '';

  // Reset output
  rawMarkdown = '';
  outputEl.innerHTML = '';
  clearError();
  placeholder.style.display = 'flex';
  outputHeader.style.display = 'none';
  refineBox.style.display = 'none';
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  mapSection.style.display = 'none';
  currentLocations = [];
  btnDownloadMap.style.display = 'none';
  btnDownloadMap.disabled = true;
  refinePrompt.value = '';
  setStatus('', false);
  btnDownload.disabled = true;
  btnCopy.disabled = true;

  // Reset dates to defaults
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setDate(end.getDate() + 4);
  document.getElementById('start-date').value = fmt(today);
  document.getElementById('end-date').value = fmt(end);
});

// ── Download PDF ───────────────────────────────────────────────────────────
btnDownload.addEventListener('click', () => {
  if (!rawMarkdown) return;
  const destination = document.getElementById('destination').value.trim() || 'itinerary';
  const filename = `${destination.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-itinerary.pdf`;

  const opt = {
    margin:     [12, 14],
    filename,
    image:      { type: 'jpeg', quality: 0.97 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF:      { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  btnDownload.disabled = true;
  btnDownload.textContent = 'Generating PDF…';

  html2pdf().set(opt).from(outputEl).save().then(() => {
    btnDownload.disabled = false;
    btnDownload.textContent = 'Download PDF';
  });
});

// ── Copy ───────────────────────────────────────────────────────────────────
btnCopy.addEventListener('click', async () => {
  if (!rawMarkdown) return;
  try {
    await navigator.clipboard.writeText(rawMarkdown);
    const orig = btnCopy.textContent;
    btnCopy.textContent = 'Copied!';
    setTimeout(() => { btnCopy.textContent = orig; }, 1800);
  } catch {
    btnCopy.textContent = 'Failed';
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
function setStatus(msg, spinning) {
  statusText.textContent = msg;
  spinnerEl.style.display = spinning ? 'block' : 'none';
  statusBar.style.display = msg ? 'flex' : 'none';
}

function showError(msg) {
  let el = document.getElementById('error-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'error-msg';
    el.className = 'error-msg';
    outputEl.before(el);
  }
  el.textContent = msg;
  placeholder.style.display = 'none';
  outputHeader.style.display = 'flex';
}

function clearError() {
  document.getElementById('error-msg')?.remove();
}

// ── Init ───────────────────────────────────────────────────────────────────
// Set default dates to today + 4 days
(function setDefaultDates() {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setDate(end.getDate() + 4);
  document.getElementById('start-date').value = fmt(today);
  document.getElementById('end-date').value   = fmt(end);
})();
