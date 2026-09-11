(() => {
  const byId = (id) => document.getElementById(id);
  async function request(method = "GET", body) {
    const response = await fetch("/api/upstream", {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.message ?? "Tool configuration unavailable.");
    return result;
  }
  async function load() {
    try {
      const state = await request();
      byId("upstream-settings").hidden = false;
      byId("upstream-url").value = state.url;
      byId("upstream-policy").value = state.policy;
      byId("upstream-facts").value = JSON.stringify(state.facts, null, 2);
      byId("upstream-mapping").value = JSON.stringify(state.mapping, null, 2);
      byId("upstream-status").textContent = state.configured
        ? "Tool server configured. Changes apply to new sessions."
        : "No tool server connected.";
    } catch {}
  }
  byId("upstream-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = byId("upstream-status");
    status.textContent = "Validating MCP connection...";
    try {
      const body = {
        url: byId("upstream-url").value,
        token: byId("upstream-token").value,
        policy: byId("upstream-policy").value,
        facts: JSON.parse(byId("upstream-facts").value),
        mapping: JSON.parse(byId("upstream-mapping").value),
      };
      const result = await request("POST", body);
      status.textContent = `Connected. ${result.tools.length} tools available for new sessions.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      byId("upstream-token").value = "";
    }
  });
  byId("upstream-remove")?.addEventListener("click", async () => {
    try {
      await request("DELETE");
      await load();
    } catch (error) {
      byId("upstream-status").textContent = error.message;
    }
  });
  window.addEventListener("void-connected", load);
  void load();
})();
