// app.js
const express = require("express");
require("dotenv").config();
const OpenAI = require("openai").default;

const app = express();
app.use(express.json());

// Setup OpenAI (v4+)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// POST /score endpoint
app.post("/score", async (req, res) => {
  const { skills, cv } = req.body;
  if (!skills || !cv) {
    return res.status(400).json({ error: "Skills and CV required" });
  }

  try {
    const prompt = `
Given the CV: "${cv}"
Score the following skills as 1 if mentioned, 0 if not: ${skills.join(", ")}
Respond ONLY as a JSON array like [{ "skill": "Excel", "score": 1 }]
`;

    // Call OpenAI completions API (v4 syntax)
    const response = await openai.completions.create({
      model: "text-davinci-003",
      prompt: prompt,
      max_tokens: 150,
      temperature: 0
    });

    const text = response.choices[0].text.trim();
    let scores;

    try {
      scores = JSON.parse(text);
    } catch {
      // fallback if parsing fails
      scores = skills.map(skill => ({ skill, score: 0 }));
    }

    console.log("OpenAI scoring results:", scores);
    res.json({ scores });

  } catch (err) {
    console.error("OpenAI API error:", err.message);
    res.status(500).json({ error: "Failed to score CV" });
  }
});

// Optional GET route to test in browser
app.get("/", (req, res) => {
  res.send("CV Scorer with OpenAI v4 is live! Use POST /score to test.");
});

// Listen on host-provided port or 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CV Scorer running on port ${PORT}`));

