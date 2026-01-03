const express = require("express");
require("dotenv").config();
const OpenAI = require("openai").default;
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST /upload
app.post("/upload", upload.fields([
  { name: "cvFiles", maxCount: 10 },
  { name: "jdFile", maxCount: 1 }
]), async (req, res) => {
  try {
    let skills = req.body.skills?.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!skills || !skills.length) return res.status(400).json({ error: "Skills required" });

    if (!req.files || !req.files.cvFiles) return res.status(400).json({ error: "No CV files uploaded" });
    if (!req.files.jdFile || req.files.jdFile.length === 0) return res.status(400).json({ error: "No Job Description uploaded" });

    // Extract JD text
    const jdFile = req.files.jdFile[0];
    let jdText = "";
    if (jdFile.mimetype === "application/pdf") {
      jdText = (await pdfParse(jdFile.buffer)).text || "";
    } else if (jdFile.mimetype.includes("word")) {
      jdText = (await mammoth.extractRawText({ buffer: jdFile.buffer })).value || "";
    } else {
      return res.status(400).json({ error: "Unsupported JD file type" });
    }
    jdText = jdText.replace(/[\r\n]+/g, " ").trim();

    const results = [];
    let extraSkills = [];

    for (const file of req.files.cvFiles) {
      let cvText = "";
      try {
        if (file.mimetype === "application/pdf") {
          cvText = (await pdfParse(file.buffer)).text || "";
        } else if (file.mimetype.includes("word")) {
          cvText = (await mammoth.extractRawText({ buffer: file.buffer })).value || "";
        } else {
          results.push({
            filename: file.originalname,
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
          skills: skills.map(s => ({ skill: s, score: 0 })),
          jdMatchScore: 0,
          summary: "Error reading CV"
        });
        continue;
      }

      // GPT prompt for scoring + AI-suggested skills
      const prompt = `
You are a recruitment assistant.

Job description:
"${jdText}"

Candidate CV:
"${cvText}"

Skills to check (case-insensitive): ${skills.join(", ")}

Instructions:
- Score each skill as 1 if mentioned directly or implied, else 0.
- Suggest any additional relevant skills not in the list.
- Score overall CV relevance to JD (0-5).
- Provide a 1-2 sentence professional summary.
- Respond ONLY in JSON like:
{
  "skills": [{ "skill": "excel", "score": 1 }],
  "extraSkills": ["tableau", "sql"],
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
        parsed = JSON.parse(response.choices[0].message.content.trim());

        // Normalize skills
        parsed.skills = skills.map(skillName => {
          const match = parsed.skills.find(s => s.skill.toLowerCase() === skillName);
          return { skill: skillName, score: match ? match.score : 0 };
        });

        if (parsed.extraSkills && parsed.extraSkills.length > 0) {
          extraSkills = Array.from(new Set([...extraSkills, ...parsed.extraSkills.map(s => s.toLowerCase())]));
        }

      } catch (err) {
        console.warn("GPT invalid JSON fallback:", err);
        parsed = {
          skills: skills.map(s => ({ skill: s, score: 0 })),
          extraSkills: [],
          jdMatchScore: 0,
          summary: "Could not generate summary"
        };
      }

      results.push({
        filename: file.originalname,
        skills: parsed.skills,
        jdMatchScore: parsed.jdMatchScore || 0,
        summary: parsed.summary
      });
    }

    // Attach AI-suggested skills to all results
    results.forEach(r => {
      r.skills = [...r.skills, ...extraSkills.map(s => ({ skill: s, score: 0 }))];
    });

    res.json({ results, allSkills: [...skills, ...extraSkills] });

  } catch (err) {
    console.error("Multi-CV scoring error:", err);
    res.status(500).json({ error: "Failed to score CVs" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));



