// Vercel serverless function. Two-step pipeline: a researcher call (Claude +
// native web search, capped uses) investigates the specific holdings passed
// in, then a writer call (no tools) turns the raw findings into a readable
// French report. This file's control flow is the "orchestrator" — there's no
// third model call for orchestration since the sequence never branches (it's
// always research, then write).
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

  const { context } = req.body || {};
  if (typeof context !== "string" || !context.trim()) {
    res.status(400).json({ error: "Expected { context: string }" });
    return;
  }

  const callClaude = async ({ system, messages, tools }) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system,
        messages,
        ...(tools ? { tools } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`Anthropic API error (${response.status}): ${await response.text()}`);
    }
    const data = await response.json();
    return (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  };

  try {
    const researcherSystem = `Tu es un chercheur financier. On te donne la liste des placements réels d'une personne. Pour chacun, cherche l'information la plus récente disponible sur le web:
- Pour chaque SCPI nommée, cherche son taux de distribution le plus récent (année en cours si disponible, sinon dernière année connue) et compare-le au taux actuellement enregistré.
- Pour le Livret A, cherche le taux réglementé officiel actuel en France et compare-le au taux enregistré.
- Cherche une ou deux tendances générales pertinentes pour ce type de portefeuille (épargne réglementée, SCPI, marchés).
- Si un projet immobilier futur est mentionné, cherche les tendances actuelles du marché immobilier et des taux de crédit pertinents.
Pour chaque recherche, note la source (nom du site) et ce que tu as trouvé, avec la date si elle est disponible. Ne fais pas plus de recherches que nécessaire. Si tu ne trouves rien de fiable sur un point, dis-le clairement plutôt que d'inventer un chiffre.`;

    const researchFindings = await callClaude({
      system: researcherSystem,
      messages: [{ role: "user", content: context }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
    });

    const writerSystem = `Tu es un rédacteur financier. On te donne (1) les résultats bruts d'une recherche web sur les placements réels d'une personne, et (2) le contexte de son patrimoine. Rédige un rapport court et clair en français:
- Un court résumé en tête (2-3 phrases).
- Pour chaque point vérifié: le chiffre trouvé, le chiffre actuellement enregistré dans l'app, et si ça a changé de façon notable.
- Cite tes sources sous forme de liens markdown [nom du site](url) quand une URL est disponible.
- Reste factuel, ne donne pas de conseil d'investissement, précise l'incertitude quand la recherche n'a rien donné de fiable.
- Utilise du markdown (titres ##, gras, listes) pour que ce soit lisible.`;

    const report = await callClaude({
      system: writerSystem,
      messages: [{
        role: "user",
        content: `Contexte patrimoine:\n${context}\n\nRésultats de recherche bruts:\n${researchFindings}`,
      }],
    });

    res.status(200).json({ report, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: "Échec de la recherche: " + (e.message || "erreur inconnue") });
  }
}
