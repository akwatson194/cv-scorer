// server.js
const express = require("express");
const dotenv = require("dotenv");
const OpenAI = require("openai").default;

dotenv.config();
const app = express();
app.use(express.json());

// Serve static front-end
app.use(express.static("public"));

// Setup OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /score endpoint
app.post("/score", async (req, res) => {
  const { cv, skills } = req.body;

  if (!cv || !Array.isArray(skills) || skills.length === 0) {
    return res.status(400).json({ error: "Please provide a CV and at least one skill." });
  }

  try {
    const messages = [
      {
        role: "system",
        content: "You are an assistant that evaluates CVs for specific skills."
      },
      {
        role: "user",
        content: `Given the CV: "${cv}"
Score the following skills: ${skills.join(", ")}.
Respond ONLY as a JSON array like:
[{ "skill": "Excel", "score": 1 }]
Use 1 if the skill is mentioned, 0 if not.`
      }
    ];

    // Call chat completions API
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
      temperature: 0,
      max_tokens: 200
    });

    const text = completion.choices[0].message.content.trim();
    let scores;

    try {
      scores = JSON.parse(text);
    } catch {
      console.error("Failed to parse OpenAI response:", text);
      scores = skills.map(skill => ({ skill, score: 0 }));
    }

    res.json({ scores });

  } catch (error) {
    console.error("OpenAI API error:", error.message);
    res.status(500).json({ error: "Unable to score CV at this time." });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CV Scorer running on port ${PORT}`));
