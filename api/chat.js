export default async function handler(req, res) {
  const userMessage = req.body.message;

  // 1. Create a thread
  const threadRes = await fetch("https://api.openai.com/v1/threads", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2"
    }
  });

  const thread = await threadRes.json();

  // 2. Add the user message to the thread
  await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2"
    },
    body: JSON.stringify({
      role: "user",
      content: userMessage
    })
  });

  // 3. Run the assistant on the thread
  const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2"
    },
    body: JSON.stringify({
      assistant_id: "asst_tVhvF5aiyrobJfXEuuYwaUew"  // 👈 YOUR assistant id
    })
  });

  const run = await runRes.json();

  // 4. Wait for the run to finish
  let runStatus = run;
  while (runStatus.status !== "completed") {
    await new Promise((r) => setTimeout(r, 800)); // wait 0.8 sec

    const checkRes = await fetch(
      `https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`,
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2"
        }
      }
    );
    runStatus = await checkRes.json();

    if (runStatus.status === "failed" || runStatus.status === "cancelled") {
      return res.status(500).json({ error: "Run failed", details: runStatus });
    }
  }

  // 5. Get the assistant's reply
  const messagesRes = await fetch(
    `https://api.openai.com/v1/threads/${thread.id}/messages`,
    {
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "assistants=v2"
      }
    }
  );

  const messages = await messagesRes.json();
  const assistantReply = messages.data[0].content[0].text.value;

  res.status(200).json({ reply: assistantReply });
}
