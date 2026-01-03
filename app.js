// server.js
const express = require("express");
const dotenv = require("dotenv");
const OpenAI = require("openai").default;

dotenv.config();

const app = express();
app.use(express.json());

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// POST /score - evaluates CV against provided skills
app.post("/score", async (req, res) => {
  const { cv, skills } = req.body;

  if (!cv || !Array.isArray(skills) || skills.length === 0) {
    return res.status(400).json({ error: "Please provide a CV and at least one skill." });
  }

  try {
    // Build prompt for OpenAI
    const prompt = `
You are evaluating a CV.
CV content: "${cv}"
Score the following skills: ${skills.join(", ")}.
Respond ONLY as a JSON array like:
[{ "skill": "Excel", "score": 1 }]
Use 1 if the skill is mentioned, 0 if not.
`;

    // Call OpenAI API
    const completion = await openai.completions.create({
      model: "text-davinci-003",
      prompt,
      max_tokens: 150,
      temperature: 0
    });

    const resultText = completion.choices[0].text.trim();
    let scores;

    try {
      scores = JSON.parse(resultText);
    } catch (parseError) {
      console.error("Failed to parse OpenAI response:", resultText);
      scores = skills.map(skill => ({ skill, score: 0 })); // fallback
    }

    console.log("Scoring result:", scores);
    res.json({ scores });

  } catch (error) {
    console.error("OpenAI API call failed:", error.message);
    res.status(500).json({ error: "Unable to score CV at this time." });
  }
});

// Simple GET route for testing in browser
app.get("/", (req, res) => {
  res.send("CV Scorer is live! Submit a POST request to /score with CV and skills.");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CV Scorer running on port ${PORT}`);
});
