// scripts/design-audit/opus-review.js
// Layer 3: Opus strategic UX review using Gemini analysis + accessibility data
import fs, { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'frontend/tests/design-audit/reports');
mkdirSync(REPORTS_DIR, { recursive: true });

const client = new BedrockRuntimeClient({ region: 'ap-south-1' });
const MODEL_ID = 'anthropic.claude-opus-4-6-v1:0';

const UX_REVIEW_PROMPT = `You are a senior UX strategist conducting a comprehensive review of "GridLock" — a real-time multiplayer grid puzzle game for web and mobile browsers.

You have two data sources:
1. **Gemini Pixel Analysis**: Automated vision-based analysis of screenshots across viewports and themes
2. **Accessibility Report**: axe-core WCAG 2.1 AA audit results

## Your Evaluation Framework

### Nielsen's 10 Usability Heuristics
1. Visibility of system status
2. Match between system and real world
3. User control and freedom
4. Consistency and standards
5. Error prevention
6. Recognition rather than recall
7. Flexibility and efficiency of use
8. Aesthetic and minimalist design
9. Help users recognize, diagnose, recover from errors
10. Help and documentation

### Mobile Game UX Best Practices
- One-handed reachability (thumb zones)
- Touch target sizing (44px minimum)
- Progressive disclosure of complexity
- Clear game state communication
- Onboarding flow effectiveness
- Session length optimization

### Cross-Page Consistency
- Navigation patterns
- Typography scale
- Color usage and theming
- Component reuse
- Spacing system adherence

## Output Format

Return a JSON object with this structure:
{
  "summary": {
    "overallUXScore": "1-10",
    "topStrengths": ["strength1", "strength2", "strength3"],
    "criticalIssues": ["issue1", "issue2"]
  },
  "heuristicEvaluation": [
    {
      "heuristic": "name",
      "score": "1-10",
      "findings": "description",
      "evidence": "specific examples from the data"
    }
  ],
  "issues": [
    {
      "id": "UX-001",
      "severity": "critical|major|minor",
      "category": "usability|accessibility|consistency|mobile|visual",
      "title": "Short title",
      "description": "Detailed description",
      "pages": ["affected pages"],
      "viewports": ["affected viewports"],
      "recommendation": "How to fix",
      "effort": "low|medium|high",
      "impact": "low|medium|high"
    }
  ],
  "mobileSpecific": {
    "thumbZoneCompliance": "assessment",
    "touchTargets": "assessment",
    "onboarding": "assessment",
    "gestureSupport": "assessment"
  },
  "themeConsistency": {
    "lightTheme": "assessment",
    "darkTheme": "assessment",
    "switchingExperience": "assessment"
  },
  "prioritizedActionItems": [
    {
      "priority": 1,
      "action": "What to do",
      "rationale": "Why it matters",
      "estimatedImpact": "What improvement to expect"
    }
  ]
}

Be specific, actionable, and grounded in the data provided. Prioritize issues by impact × effort ratio.`;

async function invokeOpus(prompt, data) {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 8192,
    temperature: 0.3,
    messages: [
      {
        role: 'user',
        content: `${prompt}\n\n## Data\n\n### Gemini Pixel Analysis\n\`\`\`json\n${JSON.stringify(data.geminiAnalysis, null, 2)}\n\`\`\`\n\n### Accessibility Report\n\`\`\`json\n${JSON.stringify(data.accessibilityReport, null, 2)}\n\`\`\``,
      },
    ],
  };

  // Truncate if payload is too large (Bedrock has limits)
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > 180_000) {
    console.log('  ⚠️  Payload too large, summarizing input data...');
    // Summarize: keep only issues from gemini, and violations from a11y
    const summarized = {
      geminiAnalysis: {
        totalScreenshots: data.geminiAnalysis.totalScreenshots,
        results: data.geminiAnalysis.results?.map((r) => ({
          screenshot: r.screenshot,
          analysis: r.analysis?.issues || r.analysis?.rawText?.slice(0, 500) || 'no data',
          metrics: r.analysis?.metrics,
        })),
      },
      accessibilityReport: data.accessibilityReport.map((r) => ({
        page: r.page,
        theme: r.theme,
        violationCount: r.violations?.length || 0,
        violations: r.violations?.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes?.length || 0,
        })),
      })),
    };

    payload.messages[0].content = `${prompt}\n\n## Data\n\n### Gemini Pixel Analysis (summarized)\n\`\`\`json\n${JSON.stringify(summarized.geminiAnalysis, null, 2)}\n\`\`\`\n\n### Accessibility Report (summarized)\n\`\`\`json\n${JSON.stringify(summarized.accessibilityReport, null, 2)}\n\`\`\``;
  }

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody;
}

async function main() {
  console.log('🧠 Opus Strategic UX Review');
  console.log('='.repeat(40));

  // Load input data
  const geminiPath = path.join(REPORTS_DIR, 'gemini-analysis.json');
  const a11yPath = path.join(REPORTS_DIR, 'accessibility.json');

  let geminiAnalysis = null;
  let accessibilityReport = null;

  if (fs.existsSync(geminiPath)) {
    geminiAnalysis = JSON.parse(fs.readFileSync(geminiPath, 'utf-8'));
    console.log(`  📄 Loaded Gemini analysis: ${geminiAnalysis.totalScreenshots || '?'} screenshots`);
  } else {
    console.log('  ⚠️  No Gemini analysis found (Layer 2 may have been skipped)');
    geminiAnalysis = { skipped: true, message: 'Gemini analysis was not available' };
  }

  if (fs.existsSync(a11yPath)) {
    accessibilityReport = JSON.parse(fs.readFileSync(a11yPath, 'utf-8'));
    console.log(`  📄 Loaded accessibility report: ${accessibilityReport.length} page audits`);
  } else {
    console.log('  ⚠️  No accessibility report found');
    accessibilityReport = [];
  }

  if ((!geminiAnalysis || geminiAnalysis.skipped) && (!accessibilityReport || accessibilityReport.length === 0)) {
    console.log('No input data found. Run Layer 1 and/or Layer 2 first.');
    process.exit(0);
  }

  console.log('\n  🤖 Calling Opus for strategic review...');

  try {
    const response = await invokeOpus(UX_REVIEW_PROMPT, {
      geminiAnalysis,
      accessibilityReport,
    });

    // Extract the text content
    const textContent = response.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    if (!textContent) {
      throw new Error('No text content in Opus response');
    }

    // Try to extract JSON from the response
    let parsedReview = null;
    const jsonMatch = textContent.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        parsedReview = JSON.parse(jsonMatch[1]);
      } catch {
        // Fall through
      }
    }
    if (!parsedReview) {
      try {
        parsedReview = JSON.parse(textContent);
      } catch {
        // Store raw text
      }
    }

    const output = {
      generatedAt: new Date().toISOString(),
      model: MODEL_ID,
      review: parsedReview || { rawText: textContent },
      inputSources: {
        geminiAnalysis: !!geminiAnalysis && !geminiAnalysis.skipped,
        accessibilityReport: accessibilityReport.length > 0,
      },
    };

    const outputPath = path.join(REPORTS_DIR, 'ux-review.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`\n✅ UX review complete: ${outputPath}`);

    // Print summary if available
    if (parsedReview?.summary) {
      console.log(`\n📊 Summary:`);
      console.log(`   Overall UX Score: ${parsedReview.summary.overallUXScore}/10`);
      if (parsedReview.summary.criticalIssues?.length) {
        console.log(`   ⚠️  Critical Issues: ${parsedReview.summary.criticalIssues.length}`);
      }
    }
  } catch (error) {
    console.error(`\n❌ Opus review failed: ${error.message}`);

    // Write error report so downstream knows what happened
    const outputPath = path.join(REPORTS_DIR, 'ux-review.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      error: error.message,
      model: MODEL_ID,
    }, null, 2));

    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
