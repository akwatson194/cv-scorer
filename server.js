// server.js (multi-CV scoring version)
const express = require("express");
require("dotenv").config();
const OpenAI = require("openai").default;
const multer = require("multer");
const pdfParse = require("pdf-parse");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Multer setup for memory storage (works with Render)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ---------------------------
// POST /upload endpoint
// ---------------------------
app.post("/upload", upload.array("cvFiles", 10), async (req, res) => {
  try {
    // Get skills from request body
    const skills = req.body.skills
      ?.split(",")
      .map(s => s.trim())
      .filter(Boolean);

    if (!skills || !skills.length) {
      return res.status(400).json({ error: "Skills required" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No CV files uploaded" });
    }

    const results = [];

    // Loop over each uploaded CV
    for (const file of req.files) {
      // 1️⃣ Extract text from PDF
      const pdfData = await pdfParse(file.buffer);
      const cvText = pdfData.text;

      // 2️⃣ Call OpenAI to score skills + summary
      const prompt = `
You are a recruitment assistant.
Given this CV text:
"${cvText}"

Score the following skills as 1 if mentioned, 0 if not:
${skills.join(", ")}

Then give a 1–2 sentence professional summary.

Respond ONLY as JSON in this format:
{
  "skills": [{ "skill": "Excel", "score": 1 }],
  "summary": "Short summary here"
}
`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      });

      let parsed;
      try {
        parsed = JSON.parse(response.choices[0].message.content);
      } catch {
        parsed = {
          skills: skills.map(s => ({ skill: s, score: 0 })),
          summary: "Unable to generate summary"
        };
      }

      // Calculate total score
      const totalScore = parsed.skills.reduce(
        (sum, s) => sum + (s.score || 0),
        0
      );

      results.push({
        filename: file.originalname,
        totalScore,
        skills: parsed.skills,
        summary: parsed.summary
      });
    }

    // 3️⃣ Rank candidates by total score (highest first)
    results.sort((a, b) => b.totalScore - a.totalScore);

    // 4️⃣ Return JSON
    res.json({ results });

  } catch (err) {
    console.error("Multi-CV scoring error:", err);
    res.status(500).json({ error: "Failed to score CVs" });
  }
});

// Optional GET route to test server
app.get("/", (req, res) => {
  res.send("CV Scorer backend is live! Use POST /upload for multi-CV scoring.");
});

// Listen on Render port or 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
