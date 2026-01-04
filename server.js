//* Full Back End for CV Scorer Dashboard
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

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/upload", upload.fields([
  { name: "cvFiles", maxCount: 10 },
  { name: "jdFile", maxCount: 1 }
]), async (req, res) => {
  try {
    let userSkills = req.body.skills?.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

    if (!req.files || !req.files.cvFiles) return res.status(400).json({ error: "No CV files uploaded" });
    if (!req.files.jdFile || req.files.jdFile.length === 0) return res.status(400).json({ error: "No Job Description uploaded" });

    // --- Extract Job Description text ---
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

    // --- Step 1: Extract suggested skills from JD if userSkills is empty ---
    if (!userSkills || userSkills.length === 0) {
      const skillPrompt = `
You are a recruitment assistant.
Given the following job description, suggest a list of skills relevant to this role.
Job Description:
"${jdText}"
Respond as a JSON array of skill strings.
      `;
      try {
        const skillResp = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: skillPrompt }],
          temperature: 0
        });
        const suggestedSkills = JSON.parse(skillResp.choices[0].message.content.trim());
        userSkills = suggestedSkills.map(s => s.toLowerCase());
      } catch (err) {
        console.warn("Error extracting JD skills:", err);
        userSkills = [];
      }
    }

    const results = [];
    let extraSkills = [];

    // --- Parse each CV ---
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
            skills: userSkills.map(s => ({ skill: s, score: 0, ai: false })),
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
          skills: userSkills.map(s => ({ skill: s, score: 0, ai: false })),
          jdMatchScore: 0,
          summary: "Error reading CV"
        });
        continue;
      }

      // --- GPT prompt for scoring + AI extra skills ---
      const prompt = `
You are a recruitment assistant.
Job description:
"${jdText}"
Candidate CV:
"${cvText}"
Skills to check (case-insensitive): ${userSkills.join(",")}
Instructions:
- Score each skill as 1 if mentioned or implied, 0 otherwise.
- Suggest additional relevant skills from CV.
- Score JD match (0-5).
- Provide 1-2 sentence professional summary.
Respond ONLY as JSON:
{
  "skills": [{ "skill": "excel", "score": 1 }],
  "extraSkills": ["tableau","sql"],
  "jdMatchScore": 4,
  "summary": "Professional summary"
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

        // Normalize skills to userSkills
        parsed.skills = userSkills.map(skillName => {
          const match = parsed.skills.find(s => s.skill.toLowerCase() === skillName);
          return { skill: skillName, score: match ? match.score : 0, ai: false };
        });

        // Collect AI extra skills
        if (parsed.extraSkills && parsed.extraSkills.length > 0) {
          extraSkills = Array.from(new Set([...extraSkills, ...parsed.extraSkills.map(s => s.toLowerCase())]));
        }
      } catch (err) {
        console.warn("GPT invalid JSON fallback:", err);
        parsed = {
          skills: userSkills.map(s => ({ skill: s, score: 0, ai: false })),
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

    // --- Combine userSkills + AI extra skills for global top skills ---
    let allSkills = [...userSkills];
    let aiSkills = extraSkills.filter(s => !allSkills.includes(s));
    allSkills = [...allSkills, ...aiSkills];

    // Mark AI-suggested skills
    const skillMarkers = {};
    aiSkills.forEach(s => skillMarkers[s] = true);

    // Add AI-skill objects to each candidate
    results.forEach(r => {
      aiSkills.forEach(skill => {
        if (!r.skills.find(s => s.skill === skill)) {
          r.skills.push({ skill, score: 0, ai: true });
        }
      });
    });

    res.json({ results, allSkills, skillMarkers });

  } catch (err) {
    console.error("Multi-CV scoring error:", err);
    res.status(500).json({ error: "Failed to score CVs" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));






