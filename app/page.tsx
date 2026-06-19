"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import Anthropic from "@anthropic-ai/sdk";
import * as mammoth from "mammoth";

interface Category {
  name: string;
  score: number;
  feedback: string;
}

interface Analysis {
  overallScore: number;
  grade: string;
  summary: string;
  categories: Category[];
  strengths: string[];
  improvements: string[];
  missingKeywords: string[];
  tip: string;
}

async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === "application/pdf") {
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    GlobalWorkerOptions.workerSrc = "/atsrating/pdf.worker.min.mjs";
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
    }
    return text;
  } else {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }
}

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : score >= 40 ? "#f97316" : "#ef4444";
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="130" height="130" className="-rotate-90">
        <circle cx="65" cy="65" r={radius} fill="none" stroke="#1e293b" strokeWidth="10" />
        <circle
          cx="65" cy="65" r={radius} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold" style={{ color }}>{score}</span>
        <span className="text-xs text-slate-400">/ 100</span>
      </div>
    </div>
  );
}

function CategoryBar({ category }: { category: Category }) {
  const color =
    category.score >= 80 ? "bg-green-500" :
    category.score >= 60 ? "bg-amber-500" :
    category.score >= 40 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="mb-4">
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium text-slate-300">{category.name}</span>
        <span className="text-sm font-bold text-slate-200">{category.score}%</span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2 mb-1">
        <div className={`h-2 rounded-full ${color} transition-all duration-700`} style={{ width: `${category.score}%` }} />
      </div>
      <p className="text-xs text-slate-400">{category.feedback}</p>
    </div>
  );
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles[0]) { setFile(acceptedFiles[0]); setAnalysis(null); setError(null); }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/msword": [".doc"],
    },
    maxFiles: 1,
  });

  const analyze = async () => {
    if (!file || !apiKey.trim()) return;
    setLoading(true); setError(null); setAnalysis(null);

    try {
      const resumeText = await extractTextFromFile(file);
      if (!resumeText.trim()) throw new Error("Could not extract text from file");

      const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });

      const jobDescSection = jobDescription.trim()
        ? `\n\n**Job Description:**\n${jobDescription}`
        : "\n\n**No job description — analyze for general ATS best practices.**";

      const prompt = `You are an expert ATS (Applicant Tracking System) resume analyst. Analyze the resume and return a JSON ATS rating.${jobDescSection}

**Resume:**
${resumeText}

Return ONLY valid JSON (no markdown):
{
  "overallScore": <0-100>,
  "grade": "<A/B/C/D/F>",
  "summary": "<2-3 sentence overview>",
  "categories": [
    {"name": "Keyword Optimization", "score": <0-100>, "feedback": "<specific feedback>"},
    {"name": "Format & Parsing", "score": <0-100>, "feedback": "<specific feedback>"},
    {"name": "Contact Information", "score": <0-100>, "feedback": "<specific feedback>"},
    {"name": "Work Experience", "score": <0-100>, "feedback": "<specific feedback>"},
    {"name": "Skills Section", "score": <0-100>, "feedback": "<specific feedback>"},
    {"name": "Education", "score": <0-100>, "feedback": "<specific feedback>"}
  ],
  "strengths": ["<s1>", "<s2>", "<s3>"],
  "improvements": ["<i1>", "<i2>", "<i3>", "<i4>"],
  "missingKeywords": ["<k1>", "<k2>", "<k3>"],
  "tip": "<one actionable tip>"
}`;

      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0];
      if (content.type !== "text") throw new Error("Unexpected response");
      setAnalysis(JSON.parse(content.text));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const gradeColor =
    analysis?.grade === "A" ? "text-green-400" :
    analysis?.grade === "B" ? "text-emerald-400" :
    analysis?.grade === "C" ? "text-amber-400" :
    analysis?.grade === "D" ? "text-orange-400" : "text-red-400";

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">ATS</div>
          <h1 className="text-xl font-bold">Resume ATS Rater</h1>
          <span className="ml-auto text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">Powered by Claude AI</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* API Key */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Anthropic API Key <span className="text-red-400">*</span>
            <span className="text-slate-500 font-normal ml-1">— never stored, used only in your browser</span>
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 pr-12 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
            >
              {showKey ? "hide" : "show"}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Get your key at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
              console.anthropic.com
            </a>
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Upload Resume <span className="text-red-400">*</span>
            </label>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                isDragActive ? "border-blue-500 bg-blue-500/10" :
                file ? "border-green-500 bg-green-500/10" :
                "border-slate-600 hover:border-slate-500 bg-slate-800/50"
              }`}
            >
              <input {...getInputProps()} />
              <div className="text-4xl mb-3">{file ? "✅" : "📄"}</div>
              {file ? (
                <div>
                  <p className="font-medium text-green-400">{file.name}</p>
                  <p className="text-xs text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB · Click to replace</p>
                </div>
              ) : (
                <div>
                  <p className="font-medium text-slate-300">{isDragActive ? "Drop it here!" : "Drag & drop your resume"}</p>
                  <p className="text-xs text-slate-500 mt-1">PDF, DOC, DOCX supported</p>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Job Description <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the job description for tailored keyword analysis..."
              className="w-full h-[152px] bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </div>

        <button
          onClick={analyze}
          disabled={!file || !apiKey.trim() || loading}
          className="w-full py-3 px-6 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Analyzing your resume...
            </>
          ) : "Analyze ATS Score"}
        </button>

        {error && (
          <div className="mt-4 p-4 bg-red-900/40 border border-red-700 rounded-xl text-red-300 text-sm">{error}</div>
        )}

        {analysis && (
          <div className="mt-10 space-y-6">
            <div className="bg-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-6">
              <ScoreRing score={analysis.overallScore} />
              <div className="flex-1 text-center sm:text-left">
                <div className="flex items-center gap-3 justify-center sm:justify-start mb-2">
                  <h2 className="text-2xl font-bold">ATS Score</h2>
                  <span className={`text-3xl font-black ${gradeColor}`}>{analysis.grade}</span>
                </div>
                <p className="text-slate-400 text-sm leading-relaxed">{analysis.summary}</p>
                {analysis.tip && (
                  <div className="mt-3 flex items-start gap-2 bg-blue-900/40 border border-blue-700 rounded-lg px-3 py-2">
                    <span className="text-blue-400 mt-0.5">💡</span>
                    <p className="text-xs text-blue-200">{analysis.tip}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-800 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-5">Category Breakdown</h3>
              {analysis.categories.map((cat) => <CategoryBar key={cat.name} category={cat} />)}
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-slate-800 rounded-2xl p-6">
                <h3 className="text-lg font-semibold mb-4"><span className="text-green-400">✓</span> Strengths</h3>
                <ul className="space-y-2">
                  {analysis.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="text-green-400 mt-0.5 shrink-0">•</span>{s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-slate-800 rounded-2xl p-6">
                <h3 className="text-lg font-semibold mb-4"><span className="text-amber-400">!</span> Areas to Improve</h3>
                <ul className="space-y-2">
                  {analysis.improvements.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="text-amber-400 mt-0.5 shrink-0">•</span>{item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {analysis.missingKeywords?.length > 0 && (
              <div className="bg-slate-800 rounded-2xl p-6">
                <h3 className="text-lg font-semibold mb-4"><span className="text-red-400">⚠</span> Missing Keywords</h3>
                <div className="flex flex-wrap gap-2">
                  {analysis.missingKeywords.map((kw, i) => (
                    <span key={i} className="px-3 py-1 bg-red-900/40 border border-red-700 rounded-full text-xs text-red-300">{kw}</span>
                  ))}
                </div>
              </div>
            )}

            <p className="text-center text-xs text-slate-600 pb-4">
              Analysis by Claude AI · Results are estimates based on common ATS patterns
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
