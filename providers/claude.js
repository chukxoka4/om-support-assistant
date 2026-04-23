const DEFAULT_MODEL = "claude-sonnet-4-6";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export async function callClaude({ apiKey, model, system, user }) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    return { text: "", error: `Claude ${res.status}: ${err.slice(0, 200)}` };
  }
  const data = await res.json();
  const text = data?.content?.map((c) => c.text || "").join("") || "";
  return { text };
}
