const DEFAULT_MODEL = "gpt-4o";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export async function callOpenAI({ apiKey, model, system, user }) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    return { text: "", error: `OpenAI ${res.status}: ${err.slice(0, 200)}` };
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { text };
}
