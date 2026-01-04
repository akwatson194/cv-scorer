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

app.post("/upload", upload.fields([
  { name: "cvFiles", maxCount: 10 },
  { name: "jdFile", maxCount: 1 }
]), async (req, res) => {
  try {
    let userSkills = req.body.skills?.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

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

    // Extract suggested skills from JD if no user skills
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
    let allSuggestedSkills = [];

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
            skills: userSkills.map(s => ({ skill: s, score: 0 })),
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
          skills: userSkills.map(s => ({ skill: s, score: 0 })),
          jdMatchScore: 0,
          summary: "Error reading CV"
        });
        continue;
      }

      // GPT prompt for scoring + AI extra skills
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
          return { skill: skillName, score: match ? match.score : 0 };
        });

        if (parsed.extraSkills && parsed.extraSkills.length > 0) {
          allSuggestedSkills = Array.from(new Set([...allSuggestedSkills, ...parsed.extraSkills.map(s => s.toLowerCase())]));
        }
      } catch (err) {
        console.warn("GPT invalid JSON fallback:", err);
        parsed = {
          skills: userSkills.map(s => ({ skill: s, score: 0 })),
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

    // Combine user skills + AI suggested skills for global top skills
    let combinedSkills = [...new Set([...userSkills, ...allSuggestedSkills])];

    // Compute top 5-10 skills across all candidates
    const skillCounts = {};
    results.forEach(cv => {
      cv.skills.forEach(s => {
        if (!skillCounts[s.skill]) skillCounts[s.skill] = 0;
        skillCounts[s.skill] += s.score;
      });
    });

    let topSkills = combinedSkills.sort((a,b) => (skillCounts[b]||0) - (skillCounts[a]||0)).slice(0,10);
    while(topSkills.length < 5) topSkills.push("-");

    res.json({ results, allSkills: topSkills });

  } catch (err) {
    console.error("Multi-CV scoring error:", err);
    res.status(500).json({ error: "Failed to score CVs" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));





