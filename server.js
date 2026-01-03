const express = require("express");
require("dotenv").config();
const OpenAI = require("openai").default;
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Multer setup (memory storage)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ---------------------------
// POST /upload endpoint (PDF + Word)
// ---------------------------
app.post("/upload", upload.array("cvFiles", 10), async (req, res) => {
  try {
    const skills = req.body.skills
      ?.split(",")
      .map(s => s.trim())
      .filter(Boolean);

    if (!skills || !skills.length)
      return res.status(400).json({ error: "Skills required" });

    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: "No CV files uploaded" });

    const results = [];

    for (const file of req.files) {
      let cvText = "";

      try {
        if (file.mimetype === "application/pdf") {
          const pdfData = await pdfParse(file.buffer);
          cvText = pdfData.text || "";
        } else if (
          file.mimetype ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          file.mimetype === "application/msword"
        ) {
          const docData = await mammoth.extractRawText({ buffer: file.buffer });
          cvText = docData.value || "";
        } else {
          // unsupported file
          results.push({
            filename: file.originalname,
            totalScore: 0,
            skills: skills.map((s) => ({ skill: s, score: 0 })),
            summary: "Unsupported file type"
          });
          continue;
        }

        // Sanitize text
        cvText = cvText.replace(/[\r\n]+/g, " ").trim();
        if (!cvText) {
          results.push({
            filename: file.originalname,
            totalScore: 0,
            skills: skills.map((s) => ({ skill: s, score: 0 })),
            summary: "Could not extract text from CV"
          });
          continue;
        }
      } catch (err) {
        console.error("Error parsing file", file.originalname, err);
        results.push({
          filename: file.originalname,
          totalScore: 0,
          skills: skills.map((s) => ({ skill: s, score: 0 })),
          summary: "Error reading file"
        });
        continue;
      }

      // OpenAI scoring
      const prompt = `
You are a recruitment assistant.
Given this CV text:
"${cvText}"

Score the following skills as 1 if clearly mentioned, 0 if not:
${skills.join(", ")}

Then give a 1–2 sentence professional summary.

Respond ONLY as valid JSON with NO extra text.
Example format:
{
  "skills": [{ "skill": "Excel", "score": 1 }],
  "summary": "Short summary here"
}
`;

      let parsed;
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0
        });

        parsed = JSON.parse(response.choices[0].message.content.trim());
      } catch {
        console.warn("OpenAI returned invalid JSON, using fallback");
        parsed = {
          skills: skills.map((s) => ({ skill: s, score: 0 })),
          summary: "Could not generate summary"
        };
      }

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

    // Rank by score
    results.sort((a, b) => b.totalScore - a.totalScore);

    res.json({ results });
  } catch (err) {
    console.error("Multi-CV scoring error:", err);
    res.status(500).json({ error: "Failed to score CVs" });
  }
});

// Optional GET
app.get("/", (req, res) => {
  res.send("CV Scorer backend live! Use POST /upload for multi-CV scoring.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

