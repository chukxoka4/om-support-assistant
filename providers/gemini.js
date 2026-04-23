const DEFAULT_MODEL = "gemini-2.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export async function callGemini({ apiKey, model, system, user }) {
  const m = model || DEFAULT_MODEL;
  const url = `${ENDPOINT}/${m}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }]
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    return { text: "", error: `Gemini ${res.status}: ${err.slice(0, 200)}` };
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return { text };
}
