// scripts/design-audit/gemini-analyze.js
// Layer 2: Gemini 2.0 Flash agentic vision analysis of screenshots
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'frontend/tests/design-audit/screenshots');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'frontend/tests/design-audit/reports');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

const ANALYSIS_PROMPT = `You are a UI/UX design auditor performing pixel-level analysis of a web app screenshot.

Analyze this screenshot and use code execution to measure:

1. **Spacing & Alignment**: Identify major UI elements and check if spacing between them is consistent. Look for misaligned edges.

2. **Tap Target Sizes**: For interactive elements (buttons, links, inputs), estimate their dimensions. Flag any that appear smaller than 44×44px (mobile minimum).

3. **Text Contrast**: Estimate text-to-background contrast ratios. Flag any text that appears to have insufficient contrast (below WCAG AA: 4.5:1 for normal text, 3:1 for large text).

4. **Visual Hierarchy**: Evaluate if the heading/content hierarchy is clear. Is the most important action visually prominent?

5. **Overflow & Truncation**: Check for any text that appears cut off, overflowing its container, or overlapping other elements.

6. **Layout Issues**: Look for unexpected gaps, overlapping elements, or broken layouts.

Return your analysis as a JSON object with this structure:
{
  "issues": [
    {
      "severity": "critical|major|minor",
      "category": "spacing|tap-target|contrast|hierarchy|overflow|layout",
      "description": "What the issue is",
      "location": "Where in the screenshot (approximate area)",
      "recommendation": "How to fix it"
    }
  ],
  "metrics": {
    "estimatedTapTargetCompliance": "percentage of interactive elements meeting 44px minimum",
    "spacingConsistency": "good|moderate|poor",
    "contrastCompliance": "good|moderate|poor",
    "overallScore": "1-10 rating"
  }
}

Be thorough but practical. Only flag genuine issues, not stylistic preferences.`;

async function analyzeScreenshot(filePath) {
  const imageBuffer = fs.readFileSync(filePath);
  const base64Data = imageBuffer.toString('base64');
  const filename = path.basename(filePath);

  console.log(`  🔍 Analyzing: ${filename}`);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Data,
            },
          },
          {
            text: `Screenshot: ${filename}\n\n${ANALYSIS_PROMPT}`,
          },
        ],
      }],
      tools: [{ codeExecution: {} }],
      generationConfig: {
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Extract text from the response parts
  const parts = data.candidates?.[0]?.content?.parts || [];
  let analysisText = '';
  let codeExecutionResults = [];

  for (const part of parts) {
    if (part.text) {
      analysisText += part.text;
    }
    if (part.executableCode) {
      codeExecutionResults.push({
        code: part.executableCode.code,
        language: part.executableCode.language,
      });
    }
    if (part.codeExecutionResult) {
      codeExecutionResults.push({
        output: part.codeExecutionResult.output,
        outcome: part.codeExecutionResult.outcome,
      });
    }
  }

  // Try to extract JSON from the response
  let parsedAnalysis = null;
  const jsonMatch = analysisText.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      parsedAnalysis = JSON.parse(jsonMatch[1]);
    } catch {
      // Fall through to raw text
    }
  }
  if (!parsedAnalysis) {
    // Try parsing the entire text as JSON
    try {
      parsedAnalysis = JSON.parse(analysisText);
    } catch {
      // Return raw text
    }
  }

  return {
    screenshot: filename,
    analysis: parsedAnalysis || { rawText: analysisText },
    codeExecution: codeExecutionResults,
    timestamp: new Date().toISOString(),
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('🔬 Gemini Agentic Vision Analysis');
  console.log('='.repeat(40));

  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    console.error(`❌ Screenshots directory not found: ${SCREENSHOTS_DIR}`);
    console.error('   Run Layer 1 (capture.spec.js) first.');
    process.exit(1);
  }

  const screenshots = fs.readdirSync(SCREENSHOTS_DIR)
    .filter((f) => f.endsWith('.png'))
    .sort();

  if (screenshots.length === 0) {
    console.error('❌ No screenshots found. Run Layer 1 first.');
    process.exit(1);
  }

  console.log(`📸 Found ${screenshots.length} screenshots to analyze\n`);

  const results = [];
  let errorCount = 0;

  for (let i = 0; i < screenshots.length; i++) {
    const file = screenshots[i];
    const filePath = path.join(SCREENSHOTS_DIR, file);

    try {
      const result = await analyzeScreenshot(filePath);
      results.push(result);
      console.log(`  ✅ ${file} (${i + 1}/${screenshots.length})`);
    } catch (error) {
      console.error(`  ❌ ${file}: ${error.message}`);
      results.push({
        screenshot: file,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      errorCount++;
    }

    // Rate limit: wait 2s between requests to be safe
    if (i < screenshots.length - 1) {
      await sleep(2000);
    }
  }

  // Write results
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const outputPath = path.join(REPORTS_DIR, 'gemini-analysis.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: 'gemini-2.0-flash',
    totalScreenshots: screenshots.length,
    successfulAnalyses: screenshots.length - errorCount,
    errors: errorCount,
    results,
  }, null, 2));

  console.log(`\n✅ Analysis complete: ${outputPath}`);
  console.log(`   ${screenshots.length - errorCount}/${screenshots.length} screenshots analyzed successfully`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
