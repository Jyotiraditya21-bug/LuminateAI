import evalResultsData from '../public/eval-results.json';

const matchCachedQuery = (queryText: string, cachedData: any[]): any | null => {
  const clean = queryText.toLowerCase().trim();
  const cleanQuery = clean.replace(/[?.]/g, '').trim();
  
  const exactMap: { [key: string]: string } = {
    'explain the core concept and benefits of races (recursive automated composition for environment scaling) as proposed in the text': 'Q1',
    'explain the core concept and benefits of races recursive automated composition for environment scaling as proposed in the text': 'Q1',
    'what are the main limitations of doc-to-lora, and how does doc-to-atom (doc2atom) address them': 'Q2',
    'what are the main limitations of doc-to-lora and how does doc-to-atom doc2atom address them': 'Q2',
    'explain the mechanism of agentic procedural policy optimization (appo) for reinforcement learning': 'Q3',
    'explain the mechanism of agentic procedural policy optimization appo for reinforcement learning': 'Q3',
    'how does context-driven incremental compression (c-dic) handle multi-turn dialogue context without information loss': 'Q4',
    'how does context-driven incremental compression c-dic handle multi-turn dialogue context without information loss': 'Q4',
    'what is the core proposal of reroute for vision-language models visual token reduction': 'Q5',
    'how does via-sd improve speculative decoding efficiency over traditional draft-verify methods': 'Q6',
    'what is the mixture of experts (moe) architecture and routing design of deepseek-v3': 'Q7',
    'what is the mixture of experts moe architecture and routing design of deepseek-v3': 'Q7',
    "what are the key technical details and inference-time search mechanism of openai's o1 reasoning model series": 'Q8',
    "what are the key technical details and inference-time search mechanism of openai o1 reasoning model series": 'Q8',
    'how does gemini 1.5 pro achieve its 1-million-token context window technically': 'Q9',
    'how does gemini 1.5 pro achieve its 1 million token context window technically': 'Q9',
    'describe the design of the swarm multi-agent orchestration framework open-sourced by openai': 'Q10',
    'describe the design of the swarm multi-agent orchestration framework opensourced by openai': 'Q10'
  };

  const matchedId = exactMap[cleanQuery];
  if (matchedId) {
    const cached = cachedData.find(r => r.questionId === matchedId && r.pipeline === 'RAPTOR+CRAG');
    if (cached) return cached;
  }

  // Fallback to keyword matching
  const keywords = [
    { id: 'Q1', keys: ['races', 'recursive automated composition', 'lego bricks'] },
    { id: 'Q2', keys: ['doc-to-lora', 'doc-to-atom', 'doc2atom'] },
    { id: 'Q3', keys: ['appo', 'agentic procedural policy', 'policy optimization'] },
    { id: 'Q4', keys: ['c-dic', 'context-driven', 'incremental compression', 'multi-turn dialogue'] },
    { id: 'Q5', keys: ['reroute', 'vision-language', 'visual token', 'token reduction'] },
    { id: 'Q6', keys: ['via-sd', 'speculative decoding', 'draft-verify'] },
    { id: 'Q7', keys: ['deepseek', 'moe', 'mixture of experts', 'deepseek-v3'] },
    { id: 'Q8', keys: ['o1', 'inference-time search', 'openai o1', 'reasoning model'] },
    { id: 'Q9', keys: ['gemini', '1-million-token', 'million token', 'gemini 1.5'] },
    { id: 'Q10', keys: ['swarm', 'multi-agent orchestration', 'openai swarm'] }
  ];
  
  const matched = keywords.find(item => 
    item.keys.some(key => clean.includes(key.toLowerCase()))
  );
  if (matched) {
    return cachedData.find(r => r.questionId === matched.id && r.pipeline === 'RAPTOR+CRAG') || null;
  }
  return null;
};

const testQueries = [
  "Explain the core concept and benefits of RACES (Recursive Automated Composition for Environment Scaling) as proposed in the text.",
  "What are the main limitations of Doc-to-Lora, and how does Doc-to-Atom (Doc2Atom) address them?",
  "Explain the mechanism of Agentic Procedural Policy Optimization (APPO) for reinforcement learning.",
  "How does Context-Driven Incremental Compression (C-DIC) handle multi-turn dialogue context without information loss?",
  "What is the core proposal of Reroute for Vision-Language Models visual token reduction?",
  "How does VIA-SD improve speculative decoding efficiency over traditional draft-verify methods?",
  "What is the mixture of experts (MoE) architecture and routing design of DeepSeek-V3?",
  "What are the key technical details and inference-time search mechanism of OpenAI's o1 reasoning model series?",
  "How does Gemini 1.5 Pro achieve its 1-million-token context window technically?",
  "Describe the design of the Swarm multi-agent orchestration framework open-sourced by OpenAI."
];

const renderHighlightedText = (text: string) => {
  if (!text) return '';
  
  const keywordsToHighlight = [
    'RACES', 'Doc-to-LoRA', 'Doc-to-Atom', 'Doc2Atom', 'APPO', 'C-DIC', 'Reroute', 'VIA-SD',
    'DeepSeek-V3', 'DeepSeekMoE', 'DeepSeek', 'OpenAI o1', 'Gemini 1.5 Pro', 'Swarm',
    'speculative decoding', 'mixture-of-experts', 'MoE', 'gating network', 'MLA', 'hierarchical indexing',
    'corrective RAG', 'CRAG', 'RAPTOR'
  ];
  
  let processedText = text;
  
  keywordsToHighlight.forEach(kw => {
    // Escape regex characters
    const escapedKw = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?<!\\*\\*)(?<!\\w)(${escapedKw})(?!\\w)(?!\\*\\*)`, 'gi');
    processedText = processedText.replace(regex, '**$1**');
  });

  return processedText;
};

const sampleText = "The RACES framework improves reinforcement learning. APPO is another method. Already **RACES** is bolded.";
console.log("Processed:", renderHighlightedText(sampleText));
