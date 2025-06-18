// settings.js
// Handles theme toggle and endpoint list management.

function qs(sel) {
  return document.querySelector(sel);
}

function createEndpointRow(value = "") {
  const row = document.createElement("div");
  row.className = "endpoint-row";

  const input = document.createElement("input");
  input.type = "text";
  input.value = value;

  const delBtn = document.createElement("button");
  delBtn.textContent = "✕";
  delBtn.title = "Remove";
  delBtn.addEventListener("click", () => row.remove());

  row.appendChild(input);
  row.appendChild(delBtn);
  return row;
}

function renderEndpoints(list) {
  const container = qs("#endpoints-container");
  container.innerHTML = "";
  list.forEach(ep => container.appendChild(createEndpointRow(ep)));
}

function saveSettings() {
  const theme = qs("#theme-select").value;

  const endpoints = Array.from(
    document.querySelectorAll(".endpoint-row input")
  )
    .map(i => i.value.trim())
    .filter(Boolean);

  chrome.runtime.sendMessage({ type: "setTheme", theme });
  chrome.runtime.sendMessage({ type: "setEndpoints", endpoints }, () => {
    qs("#save-btn").textContent = "Saved!";
    setTimeout(() => (qs("#save-btn").textContent = "Save"), 1200);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // Load theme
  chrome.runtime.sendMessage({ type: "getTheme" }, theme => {
    qs("#theme-select").value = theme || "dark";
    document.documentElement.setAttribute("data-theme", theme || "dark");
  });

  // Load endpoints
  chrome.runtime.sendMessage({ type: "getEndpoints" }, list =>
    renderEndpoints(list)
  );

  // Theme change live preview
  qs("#theme-select").addEventListener("change", e => {
    document.documentElement.setAttribute("data-theme", e.target.value);
  });

  // Add endpoint button
  qs("#add-endpoint").addEventListener("click", () => {
    qs("#endpoints-container").appendChild(createEndpointRow());
  });

  // Save
  qs("#save-btn").addEventListener("click", saveSettings);
});
