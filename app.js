const express = require('express');
const app = express();
app.use(express.json());

app.post("/score", (req, res) => {
  const { skills, cv } = req.body;
  if (!skills || !cv) return res.status(400).json({ error: "Skills and CV required" });

  const results = skills.map(skill => ({
    skill,
    score: cv.toLowerCase().includes(skill.toLowerCase()) ? 1 : 0
  }));

  console.log("Dummy scoring results:", results);
  res.json({ scores: results });
});

app.listen(3000, () => console.log("CV Scorer running on port 3000"));
