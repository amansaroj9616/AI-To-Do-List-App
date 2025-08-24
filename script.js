
// Simple local AI parser + optional OpenAI client-side enhancement.
// Data model
const $ = (sel) => document.querySelector(sel);
const listEl = $("#list");
const inputEl = $("#taskInput");
const suggestEl = $("#suggestion");
const statusFilter = $("#statusFilter");
const priorityFilter = $("#priorityFilter");
const searchInput = $("#searchInput");

const settingsBtn = $("#settingsBtn");
const settingsDialog = $("#settingsDialog");
const apiKeyInput = $("#apiKey");
const saveSettingsBtn = $("#saveSettings");

let state = JSON.parse(localStorage.getItem("ai_todo_state") || '{"tasks":[], "settings":{}}');

function save() {
  localStorage.setItem("ai_todo_state", JSON.stringify(state));
}

// Heuristic AI parser when OpenAI key not provided
function localAIDraft(text) {
  // naive due date parsing for "today/tomorrow/5pm/HH:MM"
  const lower = text.toLowerCase();
  let priority = "medium";
  if (/(urgent|asap|immediately|deadline)/.test(lower)) priority = "high";
  if (/(someday|later|when free)/.test(lower)) priority = "low";

  let due = null;
  if (/tomorrow/.test(lower)) {
    due = new Date(Date.now() + 24*60*60*1000).toISOString().slice(0,16);
  } else if (/today/.test(lower)) {
    due = new Date().toISOString().slice(0,16);
  } else {
    const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\b/);
    if (timeMatch) {
      const now = new Date();
      let h = parseInt(timeMatch[1],10);
      let m = timeMatch[2] ? parseInt(timeMatch[2],10) : 0;
      const ap = timeMatch[3];
      if (ap) {
        if (ap === "pm" && h < 12) h += 12;
        if (ap === "am" && h === 12) h = 0;
      }
      const dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
      due = dueDate.toISOString().slice(0,16);
    }
  }
  // title cleaned
  const title = text.replace(/\b(today|tomorrow|asap|urgent|when free)\b/ig,"").trim();
  return { title: title || text.trim(), priority, due };
}

// Optional OpenAI-powered enhancement
async function gptSuggest(text, apiKey) {
  const sys = "Extract a JSON object with keys: title, priority(one of high, medium, low), due(ISO 8601 'YYYY-MM-DDTHH:MM'). Title should be brief. If no due, return null.";
  const user = `Text: "${text}"`;
  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ],
    temperature: 0.2,
    response_format: { type: "json_object" }
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type":"application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("OpenAI error");
  const data = await res.json();
  try {
    const text = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function render() {
  listEl.innerHTML = "";
  const q = searchInput.value.toLowerCase();
  const showStatus = statusFilter.value;
  const showPri = priorityFilter.value;

  const items = state.tasks.filter(t => {
    if (showStatus === "open" && t.done) return false;
    if (showStatus === "done" && !t.done) return false;
    if (showPri !== "all" && t.priority !== showPri) return false;
    if (q && !(t.title.toLowerCase().includes(q))) return false;
    return true;
  });

  for (const t of items) {
    const li = document.createElement("li");
    li.className = "item" + (t.done ? " done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!t.done;
    cb.addEventListener("change", () => {
      t.done = cb.checked;
      save(); render();
    });

    const main = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = t.title;
    const meta = document.createElement("div");
    meta.className = "meta";
    const pri = document.createElement("span");
    pri.className = "badge " + t.priority;
    pri.textContent = t.priority;
    const due = document.createElement("span");
    due.className = "badge";
    due.textContent = t.due ? ("Due " + new Date(t.due).toLocaleString()) : "No due";
    meta.appendChild(pri); meta.appendChild(due);
    main.appendChild(title); main.appendChild(meta);

    const controls = document.createElement("div");
    controls.className = "controls";
    const del = document.createElement("button");
    del.textContent = "🗑️";
    del.title = "Delete";
    del.addEventListener("click", () => {
      state.tasks = state.tasks.filter(x => x.id !== t.id);
      save(); render();
    });
    const edit = document.createElement("button");
    edit.textContent = "✏️";
    edit.title = "Edit";
    edit.addEventListener("click", () => {
      const newTitle = prompt("Edit title", t.title) ?? t.title;
      const newDue = prompt("Edit due (YYYY-MM-DDTHH:MM)", t.due ?? "") || null;
      const newPri = prompt("Edit priority (high|medium|low)", t.priority) ?? t.priority;
      t.title = newTitle.trim() || t.title;
      t.due = newDue;
      if (["high","medium","low"].includes(newPri)) t.priority = newPri;
      save(); render();
    });
    controls.appendChild(edit);
    controls.appendChild(del);

    li.appendChild(cb);
    li.appendChild(main);
    li.appendChild(controls);
    listEl.appendChild(li);
  }
}

function addTaskFromSuggestion(s) {
  const task = {
    id: crypto.randomUUID(),
    title: s.title || inputEl.value.trim(),
    priority: s.priority || "medium",
    due: s.due || null,
    done: false
  };
  state.tasks.unshift(task);
  save(); render();
  inputEl.value = "";
  suggestEl.classList.add("hidden");
}

$("#addBtn").addEventListener("click", () => {
  const text = inputEl.value.trim();
  if (!text) return;
  const s = localAIDraft(text);
  addTaskFromSuggestion(s);
});

$("#aiSuggestBtn").addEventListener("click", async () => {
  const text = inputEl.value.trim();
  if (!text) return;
  suggestEl.classList.remove("hidden");
  suggestEl.textContent = "Thinking…";
  const apiKey = state.settings?.apiKey;
  let s = null;
  try {
    if (apiKey) {
      s = await gptSuggest(text, apiKey);
    }
  } catch(e) {
    console.warn(e);
  }
  if (!s) s = localAIDraft(text);

  suggestEl.innerHTML = `
    <strong>Suggestion</strong>: ${s.title}
    <div class="hint">priority: <b>${s.priority}</b> | due: <b>${s.due || "none"}</b></div>
    <div style="margin-top:8px; display:flex; gap:8px;">
      <button id="useSuggestion">Use</button>
      <button id="dismissSuggestion">Dismiss</button>
    </div>
  `;
  $("#useSuggestion").addEventListener("click", () => addTaskFromSuggestion(s));
  $("#dismissSuggestion").addEventListener("click", () => suggestEl.classList.add("hidden"));
});

statusFilter.addEventListener("change", render);
priorityFilter.addEventListener("change", render);
searchInput.addEventListener("input", render);

$("#clearDoneBtn").addEventListener("click", () => {
  state.tasks = state.tasks.filter(t => !t.done);
  save(); render();
});

// Settings
settingsBtn.addEventListener("click", () => {
  apiKeyInput.value = state.settings?.apiKey || "";
  settingsDialog.showModal();
});
saveSettingsBtn.addEventListener("click", (e) => {
  e.preventDefault();
  state.settings = state.settings || {};
  state.settings.apiKey = apiKeyInput.value.trim();
  save();
  settingsDialog.close();
});

render();
