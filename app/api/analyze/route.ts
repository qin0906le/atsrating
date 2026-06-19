import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const client = new Anthropic();

async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    return result.text;
  } else if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new Error("Unsupported file type");
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("resume") as File | null;
    const jobDescription = formData.get("jobDescription") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const resumeText = await extractText(buffer, file.type);

    if (!resumeText.trim()) {
      return NextResponse.json(
        { error: "Could not extract text from the file" },
        { status: 422 }
      );
    }

    const jobDescSection = jobDescription?.trim()
      ? `\n\n**Job Description provided:**\n${jobDescription}`
      : "\n\n**No job description provided — analyze for general ATS best practices.**";

    const prompt = `You are an expert ATS (Applicant Tracking System) resume analyst. Analyze the following resume and provide a detailed ATS compatibility rating.${jobDescSection}

**Resume Content:**
${resumeText}

Provide your analysis in the following JSON format (respond ONLY with valid JSON, no markdown):
{
  "overallScore": <number 0-100>,
  "grade": "<A/B/C/D/F>",
  "summary": "<2-3 sentence overview>",
  "categories": [
    {
      "name": "Keyword Optimization",
      "score": <0-100>,
      "feedback": "<specific feedback>"
    },
    {
      "name": "Format & Parsing",
      "score": <0-100>,
      "feedback": "<specific feedback>"
    },
    {
      "name": "Contact Information",
      "score": <0-100>,
      "feedback": "<specific feedback>"
    },
    {
      "name": "Work Experience",
      "score": <0-100>,
      "feedback": "<specific feedback>"
    },
    {
      "name": "Skills Section",
      "score": <0-100>,
      "feedback": "<specific feedback>"
    },
    {
      "name": "Education",
      "score": <0-100>,
      "feedback": "<specific feedback>"
    }
  ],
  "strengths": ["<strength1>", "<strength2>", "<strength3>"],
  "improvements": ["<improvement1>", "<improvement2>", "<improvement3>", "<improvement4>"],
  "missingKeywords": ["<keyword1>", "<keyword2>", "<keyword3>"],
  "tip": "<one actionable tip to immediately improve ATS score>"
}`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    const analysis = JSON.parse(content.text);
    return NextResponse.json(analysis);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
