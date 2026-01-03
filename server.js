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
// POST /upload endpoint (CVs + Job Description)
// ---------------------------
app.post("/upload", upload.fields([
  { name: "cvFiles", maxCount: 10 },
  { name: "jdFile", maxCount: 1 }
]), async (req, res) => {
  try {
    const skills = req.body.skills
      ?.split(",")
      .map(s => s.trim())
      .filter(Boolean);

    if (!skills || !skills.length)
      return res.status(400).json({ error: "Skills required" });

    if (!req.files || !req.files.cvFiles)
      return res.status(400).json({ error: "No CV files uploaded" });

    if (!req.files.jdFile || req.files.jdFile.length === 0)
      return res.status(400).json({ error: "No Job Description file uploaded" });

    // Extract Job Description text
    let jdFile = req.files.jdFile[0];
    let jdText = "";

    if (jdFile.mimetype === "application/pdf") {
      const pdfData = await pdfParse(jdFile.buffer);
      jdText = pdfData.text || "";
    } else if (
      jdFile.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      jdFile.mimetype === "application/msword"
    ) {
      const docData = await mammoth.extractRawText({ buffer: jdFile.buffer });
      jdText = docData.value || "";
    } else {
      return res.status(400).json({ error: "Unsupported Job Description file type" });
    }

    jdText = jdText.replace(/[\r\n]+/g, " ").trim();
    if (!jdText) return res.status(400).json({ error: "Could not extract text from JD file" });

    const results = [];

    // Process each CV
    for (const file of req.files.cvFiles) {
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
          results.push({
            filename: file.originalname,
            totalScore: 0,
            skills: skills.map(s => ({ skill: s, score: 0 })),
            jdMatchScore: 0,
            summary: "Unsupported file type"
          });
          continue;
        }

        cvText = cvText.replace(/[\r\n]+/g, " ").trim();
        if (!cvText) {
          results.push({
            filename: file.originalname,
            totalScore: 0,
            skills: skills.map(s => ({ skill: s, score: 0 })),
            jdMatchScore: 0,
            summary: "Could not extract text from CV"
          });
          continue;
        }
      } catch (err) {
        console.error("Error parsing file", file.originalname, err);
        results.push({
          filename: file.originalname,
          totalScore: 0,
          skills: skills.map(s => ({ skill: s, score: 0 })),
          jdMatchScore: 0,
          summary: "Error reading file"
        });
        continue;
      }

      // OpenAI scoring
      const prompt = `
You are a recruitment assistant.

Job description:
"${jdText}"

Candidate CV:
"${cvText}"

1. Score each skill from the provided list as 1 if clearly mentioned, 0 if not.
2. Score overall CV relevance to the job description on a scale of 0–5.
3. Give a 1–2 sentence professional summary of the candidate.
4. Respond ONLY in valid JSON with NO extra text.
Example format:
{
  "skills": [{ "skill": "Excel", "score": 1 }],
  "jdMatchScore": 3,
  "summary": "Short professional summary"
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
          skills: skills.map(s => ({ skill: s, score: 0 })),
          jdMatchScore: 0,
          summary: "Could not generate summary"
        };
      }

      const skillTotal = parsed.skills.reduce((sum, s) => sum + (s.score || 0), 0);
      const combinedScore = skillTotal + (parsed.jdMatchScore || 0);

      results.push({
        filename: file.originalname,
        combinedScore,
        totalSkillScore: skillTotal,
        jdMatchScore: parsed.jdMatchScore || 0,
        skills: parsed.skills,
        summary: parsed.summary
      });
    }

    // Rank CVs by combinedScore
    results.sort((a, b) => b.combinedScore - a.combinedScore);

    res.json({ results });

  } catch (err) {
    console.error("Multi-CV + JD scoring error:", err);
    res.status(500).json({ error: "Failed to score CVs" });
  }
});

// Optional GET
app.get("/", (req, res) => {
  res.send("CV Scorer backend live! Use POST /upload for multi-CV + Job Description scoring.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

