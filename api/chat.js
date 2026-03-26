export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const userMessage = req.body?.message?.trim();

    if (!userMessage) {
      return res.status(400).json({ error: "No message provided" });
    }

    const SITE_ORIGIN = "https://familychurch.app";

    // Start with core pages. You can add more over time.
    const seedUrls = [
      `${SITE_ORIGIN}/`,
      `${SITE_ORIGIN}/new-here`,
      `${SITE_ORIGIN}/family-kids`,
      `${SITE_ORIGIN}/family-students`,
      `${SITE_ORIGIN}/events`,
      `${SITE_ORIGIN}/redwood-campus`,
      `${SITE_ORIGIN}/grace-campus`,
      `${SITE_ORIGIN}/haven-campus`,
      `${SITE_ORIGIN}/ebenezer-campus`,
      `${SITE_ORIGIN}/media`,
      `${SITE_ORIGIN}/watch`,
      `${SITE_ORIGIN}/sermons`
    ];

    // Try common sitemap locations first.
    const sitemapCandidates = [
      `${SITE_ORIGIN}/sitemap.xml`,
      `${SITE_ORIGIN}/sitemap_index.xml`
    ];

    function stripHtml(html) {
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    }

    function chunkText(text, maxLen = 6000) {
      if (text.length <= maxLen) return text;
      return text.slice(0, maxLen);
    }

    function scorePage(query, title, text, url) {
  const q = query.toLowerCase();
  const haystack = `${title} ${text} ${url}`.toLowerCase();

  const keywords = q.split(/\s+/).filter(Boolean);
  let score = 0;

  for (const word of keywords) {
    if (haystack.includes(word)) score += 3;
    if (title.toLowerCase().includes(word)) score += 4;
    if (url.toLowerCase().includes(word)) score += 5;
  }

  const isHomepage = url === "https://familychurch.app/" || url === "https://familychurch.app";
  const isCampusPage =
    url.includes("redwood-campus") ||
    url.includes("grace-campus") ||
    url.includes("haven-campus") ||
    url.includes("ebenezer-campus");

  const lowerText = text.toLowerCase();
  const lowerTitle = title.toLowerCase();

  if (q.includes("youth") || q.includes("student") || q.includes("teen")) {
    if (url.includes("family-students")) score += 20;
  }

  if (q.includes("kids") || q.includes("children")) {
    if (url.includes("family-kids")) score += 20;
  }

  if (
    q.includes("sermon") ||
    q.includes("message") ||
    q.includes("preach") ||
    q.includes("preached") ||
    q.includes("latest") ||
    q.includes("recent") ||
    q.includes("last sermon")
  ) {
    if (isCampusPage) score += 35;
    if (url.includes("/media")) score += 20;
    if (url.includes("/watch")) score += 15;
    if (url.includes("/sermons")) score += 15;

    if (isHomepage) score -= 40;

    if (lowerTitle.includes("daily encouragement") || lowerText.includes("daily encouragement")) {
      score -= 50;
    }

    if (lowerText.includes("previously recorded services")) score += 20;
    if (lowerText.includes("watch redwood on-demand")) score += 25;
  }

  if (q.includes("service") || q.includes("times") || q.includes("location") || q.includes("campus")) {
    if (url.includes("campus")) score += 15;
  }

  return score;
}

    async function fetchText(url) {
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "FamilyChurchBot/1.0"
          }
        });

        if (!response.ok) return null;

        const html = await response.text();
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : url;
        const text = stripHtml(html);

        return { url, title, text };
      } catch {
        return null;
      }
    }

    async function fetchSitemapUrls() {
      for (const sitemapUrl of sitemapCandidates) {
        try {
          const response = await fetch(sitemapUrl, {
            headers: { "User-Agent": "FamilyChurchBot/1.0" }
          });

          if (!response.ok) continue;

          const xml = await response.text();

          const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)]
            .map((m) => m[1].trim())
            .filter((u) => u.startsWith(SITE_ORIGIN));

          if (urls.length) {
            return urls;
          }
        } catch {
          // ignore and continue
        }
      }

      return [];
    }

    // 1) Build candidate URL list
    const sitemapUrls = await fetchSitemapUrls();
    const candidateUrls = [...new Set([...seedUrls, ...sitemapUrls])].slice(0, 80);

    // 2) Fetch candidate pages
    const fetchedPages = (await Promise.all(candidateUrls.map(fetchText))).filter(Boolean);

    // 3) Score pages against the user query
    const rankedPages = fetchedPages
      .map((page) => ({
        ...page,
        score: scorePage(userMessage, page.title, page.text.slice(0, 4000), page.url)
      }))
      .filter((page) => page.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 4) Build context for OpenAI
    const contextBlock = rankedPages.length
      ? rankedPages
          .map((page, index) => {
            return `SOURCE ${index + 1}
URL: ${page.url}
TITLE: ${page.title}
CONTENT:
${chunkText(page.text, 5000)}`;
          })
          .join("\n\n------------------------\n\n")
      : "No relevant Family Church website pages were found.";

    // 5) Ask OpenAI to answer from the website context only
    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `
You are a helpful, warm assistant for Family Church.

Your priorities:
1. If the question is about Family Church (services, ministries, events, sermons, locations, etc.), use the provided website content and include direct links.
2. If the question is general (Bible, life, theology, etc.), answer normally using your knowledge.

Rules:
- Always prefer Family Church website content when relevant.
- Do not invent church details.
- If unsure about church info, say so and provide the closest relevant link.
- Keep answers clear and welcoming.
If the user asks for the most recent sermon or latest content:
- When you mention a Family Church page, always include the full direct URL on its own line.
- For sermon questions, prefer campus pages and on-demand service sections over the homepage.
- Do not treat "Daily Encouragement" as a sermon unless the page explicitly says it is a sermon.
- Prefer media/watch/sermon pages from the provided context.
- If a latest item is visible in the supplied content, name it and link it.
            `.trim()
          },
          {
            role: "system",
            content: `Family Church website context:\n\n${contextBlock}`
          },
          {
            role: "user",
            content: userMessage
          }
        ]
      })
    });

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      return res.status(500).json({
        error: "OpenAI API error",
        details: data
      });
    }

    const reply = data.choices?.[0]?.message?.content?.trim();

    return res.status(200).json({
      reply: reply || "Sorry, I couldn't generate a response."
    });
  } catch (error) {
    console.error("Website-grounded chat error:", error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
