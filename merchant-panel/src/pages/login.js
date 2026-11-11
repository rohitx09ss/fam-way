import { api, setSession, getToken } from "../api.js";

if (getToken()) location.href = "/index.html";

const $ = (id) => document.getElementById(id);
const container = $("mainContainer");
const clearFeedback = () => { $("loginFeedback").className = "temp-feedback"; $("signupFeedback").className = "temp-feedback"; };

function toggleForm() { container.classList.toggle("flipped"); clearFeedback(); }
document.querySelectorAll("[data-switch]").forEach((a) => a.addEventListener("click", toggleForm));

document.querySelectorAll("[data-toggle]").forEach((btn) => btn.addEventListener("click", () => {
  const input = $(btn.dataset.toggle), icon = btn.querySelector("i");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  icon.className = show ? "fas fa-eye-slash" : "far fa-eye";
}));

function show(feedbackId, text, kind) { const f = $(feedbackId); f.textContent = text; f.className = "temp-feedback " + kind; }

$("forgotLink").addEventListener("click", (e) => {
  e.preventDefault();
  show("loginFeedback", "Password reset: please contact your admin to reset it for you.", "error");
});

async function submit(btnId, label, work) {
  const btn = $(btnId), original = btn.innerHTML;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${label}`;
  btn.disabled = true;
  try { await work(); }
  finally { btn.innerHTML = original; btn.disabled = false; }
}

$("loginForm").addEventListener("submit", (e) => {
  e.preventDefault(); clearFeedback();
  submit("loginBtn", "Signing in...", async () => {
    try {
      const r = await api("/auth/merchant/login", { method: "POST", auth: false,
        body: { email: $("loginEmail").value.trim(), password: $("loginPassword").value } });
      setSession(r.access_token, { email: r.email }, $("keepSigned").checked);
      show("loginFeedback", "Signed in. Redirecting…", "success");
      location.href = "/index.html";
    } catch (ex) { show("loginFeedback", ex.message, "error"); }
  });
});

$("signupForm").addEventListener("submit", (e) => {
  e.preventDefault(); clearFeedback();
  submit("signupBtn", "Creating...", async () => {
    try {
      const name = $("signupName").value.trim();
      const r = await api("/auth/merchant/register", { method: "POST", auth: false,
        body: { name, store_name: name, email: $("signupEmail").value.trim(), password: $("signupPassword").value } });
      setSession(r.access_token, { email: r.email, name }, true);
      show("signupFeedback", "Account created. Let's set up your payments…", "success");
      location.href = "/integrations.html";
    } catch (ex) { show("signupFeedback", ex.message, "error"); }
  });
});
