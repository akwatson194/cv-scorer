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

// POST /upload endpoint
app.post("/upload", upload.fields([
  { name: "cvFiles", maxCount: 10 },
  { name: "jdFile", maxCount: 1 }
]), async (req, res) => {
  try {
    let skills = req.body.skills
      ?.split(",")
      .map(s => s.trim())
      .filter(Boolean);

    if (!skills || !skills.length)
      return res.status(400).json({ error: "Skills required" });

    // Normalize skills for AI
    skills = skills.map(s => s.toLowerCase());

    if (!req.files || !req.files.cvFiles)
      return res.status(400).json({ error: "No CV files uploaded" });

    if (!req.files.jdFile || req.files.jdFile.length === 0)
      return res.status(400).json({ error: "No Job Description file uploaded" });

    // Extract JD text
    const jdFile = req.files.jdFile[0];
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
      return res.status(400).json({ error: "Unsupported JD file type" });
    }
    jdText = jdText.replace(/[\r\n]+/g, " ").trim();

    const results = [];

    for (const file of req.files.cvFiles) {
      let cvText = "";

      // Extract CV text
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
            combinedScore: 0,
            skills: skills.map(s => ({ skill: s, score: 0 })),
            jdMatchScore: 0,
            summary: "Unsupported file type"
          });
          continue;
        }
        cvText = cvText.replace(/[\r\n]+/g, " ").trim();
      } catch (err) {
        console.error("Error parsing CV:", file.originalname, err);
        results.push({
          filename: file.originalname,
          combinedScore: 0,
          skills: skills.map(s => ({ skill: s, score: 0 })),
          jdMatchScore: 0,
          summary: "Error reading CV"
        });
        continue;
      }

      // GPT prompt — lenient skill matching
      const prompt = `
You are a recruitment assistant.

Job description:
"${jdText}"

Candidate CV:
"${cvText}"

Skills to check (case-insensitive): ${skills.join(", ")}

Instructions:
- Score each skill as 1 if mentioned directly or implied in the CV, otherwise 0.
- Score overall CV relevance to the job description on a scale of 0–5.
- Provide a 1–2 sentence professional summary.
- Respond ONLY in valid JSON like:
{
  "skills": [{ "skill": "excel", "score": 1 }],
  "jdMatchScore": 4,
  "summary": "Short professional summary"
}
`;

      let parsed;
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: prompt }],
          temperature: 0
        });

        // Parse JSON safely
        parsed = JSON.parse(response.choices[0].message.content.trim());

        // Normalize returned skills to match input
        parsed.skills = skills.map(skillName => {
          const match = parsed.skills.find(s => s.skill.toLowerCase() === skillName);
          return { skill: skillName, score: match ? match.score : 0 };
        });

      } catch (err) {
        console.warn("GPT returned invalid JSON, using fallback:", err);
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

    results.sort((a, b) => b.combinedScore - a.combinedScore);
    res.json({ results });

  } catch (err) {
    console.error("Multi-CV + JD scoring error:", err);
    res.status(500).json({ error: "Failed to score CVs" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


