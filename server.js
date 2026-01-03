const express = require("express");
const dotenv = require("dotenv");
const OpenAI = require("openai").default;
const multer = require("multer");
const fs = require("fs");
const pdf = require("pdf-parse");

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public")); // serve front-end

// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Multer setup: uploaded PDFs go in 'uploads/'
const upload = multer({ dest: "uploads/" });

// New POST endpoint for PDF upload
app.post("/upload", upload.single("cvFile"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const data = await pdf(fileBuffer);
    const cvText = data.text;

    // Delete file after reading
    fs.unlinkSync(req.file.path);

    // Example: simple scoring
    const skills = req.body.skills ? req.body.skills.split(",").map(s => s.trim()) : [];
    if (!skills.length) return res.status(400).json({ error: "No skills provided" });

    // OpenAI request
    const messages = [
      { role: "system", content: "You are an assistant that scores CVs for specific skills." },
      { role: "user", content: `CV: "${cvText}"\nScore skills: ${skills.join(", ")}.\nRespond only as JSON array like [{ "skill": "Excel", "score": 1 }]` }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
      temperature: 0,
      max_tokens: 200
    });

    let scores;
    try {
      scores = JSON.parse(completion.choices[0].message.content.trim());
    } catch {
      scores = skills.map(skill => ({ skill, score: 0 }));
    }

    res.json({ scores });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process PDF" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CV Scorer running on port ${PORT}`));


