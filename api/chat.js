// Vercel serverless function. Holds ANTHROPIC_API_KEY server-side and proxies
// a single-turn completion to Anthropic. The client is responsible for the
// draft/critique two-call orchestration; this just forwards { system, messages }
// and returns the assistant's text. Pass { webSearch: true } to give this
// specific call access to Claude's native web search tool (capped at a few
// uses per call to bound cost) — used only for Conseiller IA's draft step,
// as a fallback when cached research doesn't cover the question.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    return;
  }

  const { system, messages, webSearch } = req.body || {};
  if (typeof system !== "string" || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Expected { system: string, messages: [{role, content}] }" });
    return;
  }

  try {
    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system,
      messages,
    };
    if (webSearch) {
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text();
      res.status(response.status).json({ error: `Anthropic API error: ${detail}` });
      return;
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    res.status(200).json({ text });
  } catch (e) {
    res.status(502).json({ error: "Failed to reach Anthropic API" });
  }
}
