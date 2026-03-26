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

    function chunkText(text, maxLen = 5000) {
      if (!text) return "";
      return text.length <= maxLen ? text : text.slice(0, maxLen);
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

      const isHomepage =
        url === "https://familychurch.app/" ||
        url === "https://familychurch.app";

      const isCampusPage =
        url.includes("redwood-campus") ||
        url.includes("grace-campus") ||
        url.includes("haven-campus") ||
        url.includes("ebenezer-campus");

      const lowerText = text.toLowerCase();
      const lowerTitle = title.toLowerCase();

      if (q.includes("youth") || q.includes("student") || q.includes("teen")) {
        if (url.includes("family-students")) score += 25;
      }

      if (q.includes("kids") || q.includes("children")) {
        if (url.includes("family-kids")) score += 25;
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

        if (
          lowerTitle.includes("daily encouragement") ||
          lowerText.includes("daily encouragement")
        ) {
          score -= 50;
        }

        if (lowerText.includes("previously recorded services")) score += 20;
        if (lowerText.includes("watch redwood on-demand")) score += 25;
        if (lowerText.includes("watch grace on-demand")) score += 25;
        if (lowerText.includes("watch haven on-demand")) score += 25;
        if (lowerText.includes("watch ebenezer on-demand")) score += 25;
      }

      if (
        q.includes("service") ||
        q.includes("times") ||
        q.includes("location") ||
        q.includes("campus")
      ) {
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
            headers: {
              "User-Agent": "FamilyChurchBot/1.0"
            }
          });

          if (!response.ok) continue;

          const xml = await response.text();

          const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)]
            .map((match) => match[1].trim())
            .filter((url) => url.startsWith(SITE_ORIGIN));

          if (urls.length) {
            return urls;
          }
        } catch {
          // ignore
        }
      }

      return [];
    }

    const sitemapUrls = await fetchSitemapUrls();
    const candidateUrls = [...new Set([...seedUrls, ...sitemapUrls])].slice(0, 80);

    const fetchedPages = (await Promise.all(candidateUrls.map(fetchText))).filter(Boolean);

    const rankedPages = fetchedPages
      .map((page) => ({
        ...page,
        score: scorePage(userMessage, page.title, page.text.slice(0, 4000), page.url)
      }))
      .filter((page) => page.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

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
            content: `You are a warm, helpful assistant for Family Church.

Priorities:
1. If the question is about Family Church, its campuses, service times, ministries, events, kids, students, sermons, or church details, use the Family Church website content provided below first.
2. If the question is general and not specifically about Family Church, answer normally using your own knowledge.

Rules:
- Do not invent Family Church facts.
- If church information is uncertain or not found in the provided website content, say so clearly.
- Include direct links only once.
- Do not repeat the same URL in both the answer body and a separate "Direct links" section.
- If the links are already included naturally in the response, do not add a "Direct links" section.
- Do not format links as Markdown.
- Output plain URLs only.
- For sermon questions, prefer campus pages and on-demand service sections over the homepage.
- Do not treat "Daily Encouragement" as a sermon unless the page explicitly says it is a sermon.
- Keep answers concise, clear, and friendly.`
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
