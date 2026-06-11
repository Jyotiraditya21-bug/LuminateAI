import OpenAI from 'openai';
import { IndexNode } from './retrieve';

export type GradeRating = 'CORRECT' | 'AMBIGUOUS' | 'INCORRECT';

export interface GradeResult {
  rating: GradeRating;
  reason: string;
}

export interface ArxivPaper {
  title: string;
  abstract: string;
  authors: string[];
  published: string;
  url: string;
  arxivId: string;
}

// Clean and format text helper
function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
}

// Parser for live arXiv XML responses
export function parseArxivXml(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entryContent = match[1];

    const titleMatch = entryContent.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = entryContent.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = entryContent.match(/<published>([\s\S]*?)<\/published>/);
    const idMatch = entryContent.match(/<id>([\s\S]*?)<\/id>/);

    const authors: string[] = [];
    const nameRegex = /<name>([^<]+)<\/name>/g;
    let nameMatch;
    while ((nameMatch = nameRegex.exec(entryContent)) !== null) {
      authors.push(cleanText(nameMatch[1]));
    }

    const title = titleMatch ? cleanText(titleMatch[1]) : 'Unknown Title';
    const summary = summaryMatch ? cleanText(summaryMatch[1]) : 'No Abstract';
    const published = publishedMatch ? cleanText(publishedMatch[1]) : '';
    const idUrl = idMatch ? cleanText(idMatch[1]) : '';
    const arxivId = idUrl.split('/abs/').pop()?.split('v')[0] || '';

    papers.push({
      title,
      abstract: summary,
      authors,
      published,
      url: idUrl,
      arxivId
    });
  }

  return papers;
}

// Grade the retrieved nodes using GPT-4o-mini
export async function gradeContext(
  openai: OpenAI,
  query: string,
  nodes: IndexNode[]
): Promise<GradeResult> {
  const contextText = nodes
    .map((n, i) => `[Snippet ${i + 1}] (Level: ${n.level})\nContent: ${n.text}`)
    .join('\n\n');

  const prompt = `You are a strict grading assistant evaluating retrieval results for an AI research assistant.
Given a user query and a list of retrieved snippets (which may be paper abstracts or higher-level summaries), assess if the context contains enough direct and confident information to fully answer the query.

Select one of these three ratings:
- CORRECT: The retrieved context is fully sufficient to answer the query confidently.
- AMBIGUOUS: The context is partially helpful, but some details are missing or it is incomplete.
- INCORRECT: The context is completely irrelevant or does not contain any answer to the query.

Provide your output in the following JSON format:
{
  "rating": "CORRECT" | "AMBIGUOUS" | "INCORRECT",
  "reason": "A one-sentence explanation of your grading decision."
}

Do not include any other text, markdown wrapper (like \`\`\`json), or whitespace. Return ONLY the raw JSON.

User Query: "${query}"

Retrieved Context:
${contextText}

JSON Output:`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });

  const rawJson = response.choices[0].message.content || '{}';
  try {
    const parsed = JSON.parse(rawJson);
    return {
      rating: parsed.rating || 'AMBIGUOUS',
      reason: parsed.reason || 'No reason provided.'
    };
  } catch (e) {
    console.error('Failed to parse grading response:', rawJson);
    return {
      rating: 'AMBIGUOUS',
      reason: 'Failed to parse grading output, defaulting to AMBIGUOUS.'
    };
  }
}

// Fetch papers live from arXiv using LLM-generated keywords
export async function fetchLiveArxiv(
  openai: OpenAI,
  query: string
): Promise<{ papers: ArxivPaper[]; searchQuery: string }> {
  // Use GPT-4o-mini to extract search keywords
  const prompt = `Extract the 2-3 most important technical terms/keywords from this query for searching arXiv papers. Return only the keywords separated by spaces, with no punctuation, no quotes, and no extra text.\nQuery: "${query}"\nKeywords:`;
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 20,
    temperature: 0.1
  });

  const keywords = response.choices[0].message.content?.trim() || query;
  // Format search query: replace spaces with +
  const arxivSearchQuery = keywords.split(/\s+/).map(w => w.trim()).filter(Boolean).join('+');

  console.log(`Generated live arXiv search query: "${arxivSearchQuery}"`);

  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(arxivSearchQuery)}&start=0&max_results=5&sortBy=relevance`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`arXiv search failed: ${res.statusText}`);
  }
  const xmlText = await res.text();
  const papers = parseArxivXml(xmlText);

  return { papers, searchQuery: keywords };
}
