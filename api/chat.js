export default async function handler(req, res) {
  try {
    const userMessage = req.body.message;

    if (!userMessage) {
      return res.status(400).json({ error: "No message provided" });
    }

    const headers = {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2"
    };

    // 1. Create a thread
    const threadRes = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers
    });

    const thread = await threadRes.json();

    if (!threadRes.ok || !thread.id) {
      return res.status(500).json({
        error: "Thread creation failed",
        details: thread
      });
    }

    // 2. Add the user message to the thread
    const messageRes = await fetch(
      `https://api.openai.com/v1/threads/${thread.id}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          role: "user",
          content: userMessage
        })
      }
    );

    const messageData = await messageRes.json();

    if (!messageRes.ok) {
      return res.status(500).json({
        error: "Message creation failed",
        details: messageData
      });
    }

    // 3. Run the assistant on the thread
    const runRes = await fetch(
      `https://api.openai.com/v1/threads/${thread.id}/runs`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          assistant_id: process.env.ASSISTANT_ID
        })
      }
    );

    const run = await runRes.json();

    if (!runRes.ok || !run.id) {
      return res.status(500).json({
        error: "Run creation failed",
        details: run
      });
    }

    // 4. Wait for the run to finish
    let runStatus = run;
    const startedAt = Date.now();
    const timeoutMs = 25000;

    while (true) {
      if (runStatus.status === "completed") {
        break;
      }

      if (
        runStatus.status === "failed" ||
        runStatus.status === "cancelled" ||
        runStatus.status === "expired" ||
        runStatus.status === "incomplete" ||
        runStatus.status === "requires_action"
      ) {
        return res.status(500).json({
          error: `Run ended with status: ${runStatus.status}`,
          details: runStatus
        });
      }

      if (Date.now() - startedAt > timeoutMs) {
        return res.status(504).json({
          error: "Run timed out",
          details: runStatus
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const checkRes = await fetch(
        `https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v2"
          }
        }
      );

      runStatus = await checkRes.json();

      if (!checkRes.ok) {
        return res.status(500).json({
          error: "Run status check failed",
          details: runStatus
        });
      }
    }

    // 5. Get the assistant's reply
    const messagesRes = await fetch(
      `https://api.openai.com/v1/threads/${thread.id}/messages`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2"
        }
      }
    );

    const messages = await messagesRes.json();

    if (!messagesRes.ok) {
      return res.status(500).json({
        error: "Failed to fetch messages",
        details: messages
      });
    }

    const assistantMessage = messages.data.find(
      (message) => message.role === "assistant"
    );

    const assistantReply = assistantMessage?.content?.[0]?.text?.value;

    if (!assistantReply) {
      return res.status(500).json({
        error: "No assistant reply found",
        details: messages
      });
    }

    return res.status(200).json({ reply: assistantReply });
  } catch (error) {
    console.error("API route error:", error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
