<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CV Scorer</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; }
    textarea, input { width: 100%; padding: 8px; margin-bottom: 10px; }
    button { padding: 10px 20px; cursor: pointer; }
    pre { background: #f4f4f4; padding: 10px; white-space: pre-wrap; }
    .skill { display: inline-block; padding: 4px 8px; margin: 2px; border-radius: 4px; }
    .score-1 { background-color: #c8e6c9; } /* green */
    .score-0 { background-color: #ffcdd2; } /* red */
  </style>
</head>
<body>
  <h1>CV Scorer</h1>
  
  <label>Enter CV text:</label>
  <textarea id="cv" rows="6" placeholder="Paste your CV here"></textarea>
  
  <label>Enter skills (comma separated):</label>
  <input type="text" id="skills" placeholder="Excel, Power BI, Python">
  
  <button id="submitBtn">Score CV</button>
  
  <h2>Results:</h2>
  <div id="results">Waiting for input...</div>
  
  <script>
    const submitBtn = document.getElementById('submitBtn');
    const resultsEl = document.getElementById('results');
    
    submitBtn.addEventListener('click', async () => {
      const cvText = document.getElementById('cv').value;
      const skillsText = document.getElementById('skills').value;
      const skills = skillsText.split(',').map(s => s.trim()).filter(Boolean);

      if (!cvText || skills.length === 0) {
        alert("Please enter CV text and at least one skill.");
        return;
      }

      resultsEl.textContent = "Scoring...";

      try {
        const response = await fetch("/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cv: cvText, skills })
        });

        if (!response.ok) {
          resultsEl.textContent = "Error scoring CV";
          return;
        }

        const data = await response.json();

        // Display results with colored indicators
        resultsEl.innerHTML = "";
        data.scores.forEach(item => {
          const span = document.createElement("span");
          span.textContent = `${item.skill}: ${item.score}`;
          span.className = `skill score-${item.score}`;
          resultsEl.appendChild(span);
        });

      } catch (err) {
        resultsEl.textContent = "Error: " + err.message;
      }
    });
  </script>
</body>
</html>
