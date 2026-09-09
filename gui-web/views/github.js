// GitHub integration. Token paste is the real path today: stored ONLY
// in localStorage void.github, masked everywhere, never in URLs.
window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.github = function (root) {
  root.innerHTML = "";
  var wrap = document.createElement("div");
  wrap.className = "section";
  var LS = "void.github";

  function token() {
    try { return localStorage.getItem(LS) || ""; } catch (e) { return ""; }
  }
  function api(path) {
    return fetch("https://api.github.com" + path, {
      headers: { "Authorization": "Bearer " + token(), "Accept": "application/vnd.github+json" }
    }).then(function (r) {
      var left = r.headers.get("x-ratelimit-remaining");
      if (left !== null) {
        var el = wrap.querySelector("#gh-rate");
        if (el) el.textContent = "rate limit left: " + left;
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function paintSetup() {
    wrap.innerHTML = "<h2>GitHub</h2><p class='muted'>Connect with a personal access token. Device Flow needs a registered OAuth App, so token paste is the working path.</p>" +
      "<div class='card'><h3>Sign in</h3><div class='toolbar'>" +
      "<input id='gh-token' type='password' placeholder='ghp_... (stored in this browser)' style='min-width:260px' aria-label='Token'>" +
      "<button class='btn-primary btn-small' id='gh-save'>Save</button></div>" +
      "<p class='muted small'>Scopes needed: repo for private repos and PRs, read:user for profile. Token never leaves this browser except to api.github.com.</p></div>";
    wrap.querySelector("#gh-save").onclick = function () {
      var v = wrap.querySelector("#gh-token").value.trim();
      if (!v) { if (window.VOID_TOAST) window.VOID_TOAST("Paste a token first."); return; }
      try { localStorage.setItem(LS, v); } catch (e) { /* storage blocked */ }
      paintMain();
    };
  }

  function paintMain() {
    wrap.innerHTML = "<h2>GitHub</h2><p class='muted small' id='gh-rate'></p>" +
      "<div class='skel' id='gh-load'><span style='width:40%'></span><span style='width:70%'></span><span style='width:55%'></span></div>" +
      "<div id='gh-body'></div>";
    api("/user").then(function (u) {
      api("/user/repos?per_page=20&sort=updated").then(function (repos) {
        var body = "<div class='card'><h3><img src='" + esc(u.avatar_url) + "' width='44' height='44' alt=''> " + esc(u.login) + "</h3>" +
          "<p class='muted small'>public repos " + u.public_repos + " <span class='key-badge'>token: ends " + esc(token().slice(-4)) + "</span></p>" +
          "<div class='toolbar'><button class='btn-pearl btn-small' id='gh-out'>Sign out</button></div></div>" +
          "<div class='card section'><h3>Repos</h3><div class='table-wrap'><table class='table'><thead><tr><th>Repo</th><th>Stars</th><th>Updated</th><th></th></tr></thead><tbody>" +
          repos.map(function (r, i) {
            return "<tr><td class='mono'>" + esc(r.full_name) + "</td><td class='mono'>" + r.stargazers_count + "</td>" +
              "<td class='mono'>" + esc((r.updated_at || "").slice(0, 10)) + "</td>" +
              "<td><button class='btn-pearl btn-small' data-repo='" + i + "'>PRs</button></td></tr>";
          }).join("") + "</tbody></table></div></div><div id='gh-prs'></div>";
        wrap.querySelector("#gh-body").innerHTML = body;
        wrap.querySelector("#gh-out").onclick = function () {
          try { localStorage.removeItem(LS); } catch (e) { /* ignore */ }
          paintSetup();
        };
        wrap.querySelectorAll("button[data-repo]").forEach(function (b) {
          b.onclick = function () {
            var r = repos[parseInt(b.getAttribute("data-repo"), 10)];
            var box = wrap.querySelector("#gh-prs");
            box.innerHTML = "<div class='skel'><span style='width:60%'></span><span style='width:45%'></span></div>";
            api("/repos/" + r.full_name + "/pulls?state=open").then(function (prs) {
              box.innerHTML = "<div class='card section'><h3>Open PRs: " + esc(r.full_name) + "</h3>" +
                (prs.length === 0 ? "<p class='muted'>No open pull requests.</p>" :
                  "<div class='table-wrap'><table class='table'><thead><tr><th>#</th><th>Title</th><th>State</th></tr></thead><tbody>" +
                  prs.map(function (p) {
                    return "<tr><td class='mono'>" + p.number + "</td><td><a href='" + esc(p.html_url) + "' target='_blank' rel='noopener'>" + esc(p.title) + "</a></td><td>" + esc(p.state) + "</td></tr>";
                  }).join("") + "</tbody></table></div>") + "</div>";
            }).catch(function (e) {
              box.innerHTML = "<div class='card'><p>PRs failed: " + esc(e.message) + ".</p></div>";
            });
          };
        });
      }).catch(function (e) {
        wrap.querySelector("#gh-body").innerHTML = "<div class='card'><p>Repos failed: " + esc(e.message) + ".</p></div>";
      });
    }).catch(function () {
      try { localStorage.removeItem(LS); } catch (e) { /* ignore */ }
      paintSetup();
      if (window.VOID_TOAST) window.VOID_TOAST("Token rejected, paste a valid one.");
    });
  }

  if (token()) paintMain(); else paintSetup();
  root.appendChild(wrap);
};
