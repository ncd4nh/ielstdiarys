// Vercel Serverless Function: một cổng AI chung cho IELSTDIARYS.
// Hỗ trợ: anthropic (Claude), gemini (Google), openai (ChatGPT), openrouter.
// API key lấy theo thứ tự: key người dùng nhập trong "Cài đặt AI" → biến môi trường trên Vercel.
//   ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY
//   APP_PASSWORD: bắt buộc nhập mã này khi dùng key đặt trên server (để người lạ không dùng ké).
const ENV_KEYS = {
  anthropic: () => process.env.ANTHROPIC_API_KEY,
  gemini: () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  openai: () => process.env.OPENAI_API_KEY,
  openrouter: () => process.env.OPENROUTER_API_KEY
};
const DEFAULTS = {
  anthropic: { model: "claude-sonnet-4-5", quick: "claude-haiku-4-5" },
  gemini: { model: "gemini-3.8-flash", quick: "gemini-3.8-flash" },
  openai: { model: "gpt-4.1", quick: "gpt-4.1-mini" },
  openrouter: { model: "google/gemini-2.5-flash", quick: "google/gemini-2.5-flash-lite" }
};

function fail(res, status, code, error) { return res.status(status).json({ code, error }); }
function classify(status, msg) {
  msg = String(msg || "");
  if (status === 401 || status === 403 || /api key|api_key|unauthori[sz]ed|permission|invalid.*key/i.test(msg)) return ["bad_key", "API key không hợp lệ, hết hạn hoặc chưa được cấp quyền."];
  if (status === 404 || /not found|does not exist|unknown model|invalid model|model_not_found/i.test(msg)) return ["model_not_found", "Không tìm thấy model này. Kiểm tra lại tên model trong Cài đặt AI."];
  if (status === 429 || /quota|rate limit|resource_exhausted|overloaded/i.test(msg)) return ["rate_limited", "Hết lượt hoặc vượt giới hạn của nhà cung cấp. Thử lại sau hoặc dùng AI dự phòng."];
  if (status === 402 || /credit|billing|balance|insufficient/i.test(msg)) return ["no_credit", "Tài khoản API chưa nạp tiền / hết hạn mức."];
  return ["upstream_error", msg || "Lỗi từ nhà cung cấp AI."];
}

function toMessages(input) {
  const out = [];
  const push = (role, text) => { if (!text) return; const last = out[out.length - 1]; if (last && last.role === role) last.text += "\n\n" + text; else out.push({ role, text }); };
  if (typeof input === "string") push("user", input);
  else if (Array.isArray(input)) input.forEach((m) => push(m && m.role === "assistant" ? "assistant" : "user", String((m && m.content) || "")));
  return out;
}

async function callAnthropic({ key, model, msgs, images, maxTokens }) {
  const messages = msgs.map((m, i) => ({ role: m.role, content: i === msgs.length - 1 && images.length ? [...images.map((d) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: d } })), { type: "text", text: m.text }] : m.text }));
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: maxTokens, messages }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: r.status, error: j.error && j.error.message };
  return { text: (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join(""), truncated: j.stop_reason === "max_tokens" };
}
async function callGemini({ key, model, msgs, images, maxTokens }) {
  const contents = msgs.map((m, i) => ({ role: m.role === "assistant" ? "model" : "user", parts: [...(i === msgs.length - 1 ? images.map((d) => ({ inline_data: { mime_type: "image/jpeg", data: d } })) : []), { text: m.text }] }));
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
  const r = await fetch(url, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: Math.max(maxTokens, 16000) } }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: r.status, error: j.error && j.error.message };
  const c = (j.candidates || [])[0] || {};
  const text = ((c.content && c.content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  if (!text && (c.finishReason === "SAFETY" || (j.promptFeedback && j.promptFeedback.blockReason))) return { status: 400, error: "Gemini từ chối nội dung này (bộ lọc an toàn)." };
  return { text, truncated: c.finishReason === "MAX_TOKENS" };
}
async function callOpenAICompat({ key, model, msgs, images, maxTokens, base, extraHeaders, tokenField }) {
  const messages = msgs.map((m, i) => ({ role: m.role, content: i === msgs.length - 1 && images.length ? [{ type: "text", text: m.text }, ...images.map((d) => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + d } }))] : m.text }));
  const r = await fetch(base + "/chat/completions", { method: "POST", headers: Object.assign({ authorization: "Bearer " + key, "content-type": "application/json" }, extraHeaders || {}), body: JSON.stringify({ model, messages, [tokenField]: maxTokens }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: r.status, error: (j.error && (j.error.message || j.error)) || r.statusText };
  const ch = (j.choices || [])[0] || {};
  let text = ch.message && ch.message.content;
  if (Array.isArray(text)) text = text.map((p) => p.text || "").join("");
  return { text: text || "", truncated: ch.finish_reason === "length" };
}

module.exports = async (req, res) => {
  const pass = process.env.APP_PASSWORD || "";
  if (req.method === "GET") {
    const env = {}; Object.keys(ENV_KEYS).forEach((p) => (env[p] = !!ENV_KEYS[p]()));
    return res.status(200).json({ env, needsPassword: !!pass, defaults: DEFAULTS });
  }
  if (req.method !== "POST") return fail(res, 405, "bad_request", "Method not allowed");
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { provider = "anthropic", input, images = [], tier = "default" } = body || {};
  if (!ENV_KEYS[provider]) return fail(res, 400, "bad_request", "Nhà cung cấp AI không hợp lệ.");
  let key = String((body && body.key) || "").trim();
  if (!key) {
    key = ENV_KEYS[provider]() || "";
    if (!key) return fail(res, 400, "not_configured", "Chưa có API key cho nhà cung cấp này.");
    if (pass && req.headers["x-app-pass"] !== pass) return fail(res, 401, "bad_pass", "Sai mã truy cập AI.");
  }
  const model = String((body && body.model) || "").trim() || DEFAULTS[provider][tier === "quick" ? "quick" : "model"];
  const msgs = toMessages(input);
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return fail(res, 400, "bad_request", "Yêu cầu không hợp lệ.");
  if (JSON.stringify(msgs).length > 400000) return fail(res, 413, "prompt_too_large", "Nội dung quá dài.");
  const imgs = Array.isArray(images) ? images.slice(0, 6).map(String) : [];
  const maxTokens = tier === "quick" ? 3000 : 8000;
  const args = { key, model, msgs, images: imgs, maxTokens };
  let out;
  try {
    if (provider === "anthropic") out = await callAnthropic(args);
    else if (provider === "gemini") out = await callGemini(args);
    else if (provider === "openai") out = await callOpenAICompat(Object.assign({ base: "https://api.openai.com/v1", tokenField: "max_completion_tokens" }, args));
    else out = await callOpenAICompat(Object.assign({ base: "https://openrouter.ai/api/v1", tokenField: "max_tokens", extraHeaders: { "X-Title": "IELSTDIARYS" } }, args));
  } catch (e) {
    console.error("[ai] fetch failed", provider, model, e && e.message);
    return res.status(502).json({ code: "upstream_error", error: "Không kết nối được tới nhà cung cấp AI. [" + provider + " · " + model + "]", retry: true, model });
  }
  if (out.error || out.status) console.error("[ai] upstream error", provider, model, out.status, String(out.error || "").slice(0, 500));
  if (out.error || out.status) {
    const [code, msg] = classify(out.status, out.error);
    // retry: lỗi tạm thời phía nhà cung cấp (quá tải, hết lượt theo phút, 5xx) — trình duyệt sẽ tự thử lại
    const retry = code === "rate_limited" || (code === "upstream_error" && (!out.status || out.status >= 500 || out.status === 408));
    const detail = (out.error && code !== "upstream_error" ? " (" + String(out.error).slice(0, 160) + ")" : "") + " [" + provider + " · " + model + "]";
    return res.status(code === "bad_key" ? 400 : code === "rate_limited" ? 429 : 502).json({ code, error: msg + detail, retry, model });
  }
  return res.status(200).json({ text: out.text || "", truncated: !!out.truncated, provider, model });
};
