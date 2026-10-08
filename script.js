"use strict";

/* ============================================================
   Config
   ============================================================ */
const API_BASE = "https://mental-health-score-cfrn.onrender.com";
const PREDICT_URL = `${API_BASE}/predict`;
const TIMEOUT_MS = 15000;
const SCORE_MAX = 10; // gauge scale; adjust if your model's range differs

const COUNTRIES = [
  "India", "USA", "Canada", "Australia", "UK", "Germany", "Mexico", "Turkey", "France",
  "Argentina", "Austria", "Bangladesh", "Belgium", "Brazil", "China", "Denmark", "Egypt",
  "Finland", "Greece", "Indonesia", "Ireland", "Israel", "Italy", "Japan", "Kenya",
  "Malaysia", "Nepal", "Netherlands", "New Zealand", "Nigeria", "Norway", "Pakistan",
  "Philippines", "Poland", "Portugal", "Russia", "Saudi Arabia", "Singapore",
  "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland",
  "Thailand", "UAE", "Vietnam", "Other"
];

/* Mirrors the Pydantic constraints in the backend */
const NUMERIC_RULES = {
  age:                     { label: "Age",                  int: true,  min: 10, max: 100 },
  avg_daily_usage_hours:   { label: "Daily usage",          int: false, min: 0,  max: 24 },
  daily_unlocks:           { label: "Phone unlocks",        int: true,  min: 0 },
  study_hours:             { label: "Study time",           int: false, min: 0,  max: 24 },
  physical_activity_hours: { label: "Physical activity",    int: false, min: 0,  max: 24 },
  sleep_hours_per_night:   { label: "Sleep",                int: false, min: 0,  max: 24 }
};

const REQUIRED_CHOICES = {
  gender:             "Select a gender.",
  academic_level:     "Select an academic level.",
  most_used_platform: "Select a platform.",
  purpose_of_use:     "Select a main purpose.",
  stress_level:       "Select a stress level.",
  country:            "Enter a country."
};

const BANDS = [
  { min: 7.5, key: "good", label: "Strong",          text: "The model estimates a healthy score for this profile." },
  { min: 6,   key: "mid",  label: "Moderate",        text: "The model estimates a middle-range score for this profile." },
  { min: -Infinity, key: "low", label: "Needs attention", text: "The model estimates a lower score for this profile." }
];

/* ============================================================
   DOM
   ============================================================ */
const form        = document.getElementById("predict-form");
const submitBtn   = document.getElementById("submit-btn");
const panel       = document.getElementById("result-panel");
const states = {
  idle:    document.getElementById("state-idle"),
  loading: document.getElementById("state-loading"),
  result:  document.getElementById("state-result"),
  error:   document.getElementById("state-error")
};
const gaugeFill   = document.getElementById("gauge-fill");
const scoreValue  = document.getElementById("score-value");
const bandLabel   = document.getElementById("band-label");
const bandText    = document.getElementById("band-text");
const errorTitle  = document.getElementById("error-title");
const errorMsg    = document.getElementById("error-message");
const errorList   = document.getElementById("error-list");

/* ============================================================
   Helpers
   ============================================================ */
function showState(name) {
  Object.entries(states).forEach(([key, el]) => { el.hidden = key !== name; });
  panel.setAttribute("aria-busy", String(name === "loading"));

  // On stacked (mobile) layout, bring the result into view
  if (name !== "idle" && window.matchMedia("(max-width: 960px)").matches) {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function fieldEl(name) {
  return form.querySelector(`.field[data-field="${name}"]`);
}

function setFieldError(name, message) {
  const field = fieldEl(name);
  if (!field) return false;
  field.classList.add("invalid");
  field.querySelector(".error").textContent = message;
  return true;
}

function clearFieldError(name) {
  const field = fieldEl(name);
  if (!field) return;
  field.classList.remove("invalid");
  field.querySelector(".error").textContent = "";
}

function clearAllErrors() {
  form.querySelectorAll(".field.invalid").forEach((f) => {
    f.classList.remove("invalid");
    f.querySelector(".error").textContent = "";
  });
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle("loading", isLoading);
  submitBtn.querySelector(".btn-label").textContent = isLoading ? "Predicting…" : "Predict score";
}

function showError(title, message, details = []) {
  errorTitle.textContent = title;
  errorMsg.textContent = message;
  errorList.innerHTML = "";
  details.forEach((d) => {
    const li = document.createElement("li");
    li.textContent = d;
    errorList.appendChild(li);
  });
  errorList.hidden = details.length === 0;
  showState("error");
}

/* ============================================================
   Validation + payload
   ============================================================ */
function collectAndValidate() {
  const fd = new FormData(form);
  const payload = {};
  const problems = [];

  // Choice / text fields
  for (const [name, message] of Object.entries(REQUIRED_CHOICES)) {
    const value = (fd.get(name) || "").toString().trim();
    if (!value) {
      problems.push({ name, message });
    } else {
      payload[name] = value;
    }
  }

  // Numeric fields
  for (const [name, rule] of Object.entries(NUMERIC_RULES)) {
    const raw = (fd.get(name) || "").toString().trim();
    if (raw === "") {
      problems.push({ name, message: `Enter ${rule.label.toLowerCase()}.` });
      continue;
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      problems.push({ name, message: "Enter a valid number." });
    } else if (rule.int && !Number.isInteger(num)) {
      problems.push({ name, message: "Use a whole number." });
    } else if (num < rule.min) {
      problems.push({ name, message: `Must be at least ${rule.min}.` });
    } else if (rule.max !== undefined && num > rule.max) {
      problems.push({ name, message: `Must be ${rule.max} or less.` });
    } else {
      payload[name] = num;
    }
  }

  return { payload, problems };
}

/* ============================================================
   API call
   ============================================================ */
async function requestPrediction(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(PREDICT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    let body = null;
    try { body = await response.json(); } catch (_) { /* non-JSON response */ }

    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* Convert FastAPI's 422 `detail` array into field messages */
function handleValidationError(body) {
  const detail = body && body.detail;
  const unmapped = [];

  if (Array.isArray(detail)) {
    detail.forEach((item) => {
      const name = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
      const message = item.msg || "Invalid value.";
      if (!name || !setFieldError(name, message)) {
        unmapped.push(`${name ? name + ": " : ""}${message}`);
      }
    });
  } else if (typeof detail === "string") {
    unmapped.push(detail);
  }

  showError(
    "Some inputs were rejected",
    "The API couldn't accept this data. Fix the highlighted fields and try again.",
    unmapped
  );

  const firstInvalid = form.querySelector(".field.invalid");
  if (firstInvalid) firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ============================================================
   Result rendering
   ============================================================ */
function renderResult(score) {
  const band = BANDS.find((b) => score >= b.min);
  const pct = Math.max(0, Math.min(100, (score / SCORE_MAX) * 100));

  states.result.dataset.band = band.key;
  bandLabel.textContent = band.label;
  bandText.textContent = band.text;

  showState("result");

  // Reset, then animate the gauge and count up the number
  gaugeFill.style.strokeDasharray = "0 100";
  scoreValue.textContent = "0.00";

  requestAnimationFrame(() => requestAnimationFrame(() => {
    gaugeFill.style.strokeDasharray = `${pct} 100`;
  }));

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    scoreValue.textContent = score.toFixed(2);
    return;
  }

  const duration = 1000;
  const start = performance.now();
  (function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    scoreValue.textContent = (score * eased).toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

/* ============================================================
   Events
   ============================================================ */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAllErrors();

  const { payload, problems } = collectAndValidate();

  if (problems.length) {
    problems.forEach(({ name, message }) => setFieldError(name, message));
    const first = form.querySelector(".field.invalid");
    if (first) {
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      const focusable = first.querySelector("input, select");
      if (focusable) focusable.focus({ preventScroll: true });
    }
    return;
  }

  setLoading(true);
  showState("loading");

  try {
    const data = await requestPrediction(payload);
    const score = Number(data && data.predicted_mental_health_score);

    if (!Number.isFinite(score)) {
      throw Object.assign(new Error("Bad response shape"), { badShape: true });
    }
    renderResult(score);
  } catch (err) {
    if (err.name === "AbortError") {
      showError(
        "The request timed out",
        `The API didn't respond within ${TIMEOUT_MS / 1000} seconds. Check that the server is running and try again.`
      );
    } else if (err.status === 422) {
      handleValidationError(err.body);
    } else if (err.status) {
      const detail = err.body && typeof err.body.detail === "string" ? err.body.detail : null;
      showError(
        err.status >= 500 ? "The server hit an error" : "The request failed",
        detail || `The API returned status ${err.status}. Check the Uvicorn terminal for details.`
      );
    } else if (err.badShape) {
      showError("Unexpected response", "The API replied, but the response had no predicted_mental_health_score value.");
    } else {
      showError(
        "Can't reach the API",
        `No response from ${API_BASE}. Make sure Uvicorn is running and the address is correct.`
      );
    }
  } finally {
    setLoading(false);
  }
});

form.addEventListener("reset", () => {
  clearAllErrors();
  showState("idle");
});

// Clear a field's error as soon as the user edits it
form.addEventListener("input", (event) => {
  const field = event.target.closest(".field");
  if (field) clearFieldError(field.dataset.field);
});

document.getElementById("again-btn").addEventListener("click", () => {
  showState("idle");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("retry-btn").addEventListener("click", () => {
  showState("idle");
});

/* ============================================================
   Init
   ============================================================ */
(function init() {
  const list = document.getElementById("country-list");
  COUNTRIES.forEach((c) => {
    const option = document.createElement("option");
    option.value = c;
    list.appendChild(option);
  });
})();
