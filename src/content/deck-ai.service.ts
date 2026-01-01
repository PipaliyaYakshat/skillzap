import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Deck } from './schemas/deck.schema';
import { Topic } from './schemas/topic.schema';
import { SubTopic } from './schemas/subtopic.schema';
import { Question } from './interfaces/question.interface';
import { FileTextExtractionService } from './file-text-extraction.service';
import { promises as fsPromises } from 'fs';
import { extname, isAbsolute } from 'path';

type GeneratedSubTopic = {
  title?: string;
  description?: string;
  questions?: Question[];
};

type GeneratedTopic = {
  title?: string;
  description?: string;
  subTopics?: GeneratedSubTopic[];
};

type GeneratedDeckPayload = {
  deckName?: string;
  description?: string;
  topics?: GeneratedTopic[];
};

type QuestionsPayload = {
  questions?: Question[];
};

@Injectable()
export class DeckAIService {
  private openai: OpenAI;
  private modelName: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Deck.name) private deckModel: Model<Deck>,
    @InjectModel(Topic.name) private topicModel: Model<Topic>,
    @InjectModel(SubTopic.name) private subTopicModel: Model<SubTopic>,
    private readonly fileTextExtractionService: FileTextExtractionService,
  ) {
    const apiKey =
      this.configService.get<string>('OPENAI_API_KEY') ??
      this.configService.get<string>('OPENROUTER_API_KEY') ??
      process.env.OPENAI_API_KEY ??
      process.env.OPENROUTER_API_KEY ??
      '';

    if (!apiKey) {
      throw new InternalServerErrorException('OPENAI_API_KEY missing');
    }

    // OpenRouter base URL (or other base as configured)
    const baseURL =
      this.configService.get<string>('OPENAI_BASE_URL') ??
      process.env.OPENAI_BASE_URL ??
      'https://api.groq.com/openai/v1';

    // Correct model default
    this.modelName =
      this.configService.get<string>('OPENAI_MODEL') ??
      process.env.OPENAI_MODEL ??
      'llama-3.1-8b-instant';

    this.openai = new OpenAI({
      apiKey,
      baseURL,
      // Keep requests from hanging indefinitely
      timeout: 15_000,
      defaultHeaders: {
        'HTTP-Referer':
          this.configService.get<string>('OPENAI_HTTP_REFERER') ??
          process.env.OPENAI_HTTP_REFERER ??
          'https://skillzap.app',
        'X-Title':
          this.configService.get<string>('OPENAI_X_TITLE') ??
          process.env.OPENAI_X_TITLE ??
          'Skillzap',
      },
    });
  }

  // =====================================================================
  // Language detection (returns e.g. "Gujarati", "Hindi", "English")
  // =====================================================================
  private async detectLanguage(text: string): Promise<string> {
    if (!text || !text.trim()) return 'English';

    // Keep the language detection payload short
    const sample = text.trim().slice(0, 2000);

    try {
      const prompt = `
You are a language detection assistant.
Return ONLY the language name of the given text. Provide a single short token like:
Gujarati
Hindi
English
Marathi
Tamil
Telugu
Punjabi

Do NOT return any extra commentary, JSON, or punctuation. If you are unsure, return "English".

TEXT:
"""${sample}"""
`;

      const aiResponse = await this.openai.chat.completions.create({
        model: this.modelName,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful language classifier. Reply with just the language name (single line).',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 10,
        temperature: 0,
      });

      const raw = aiResponse.choices?.[0]?.message?.content ?? '';
      const cleaned = this.sanitizeLanguage(raw);
      return cleaned || 'English';
    } catch (err) {
      // On any error, fall back to English
      console.error('Language detection failed:', err);
      return 'English';
    }
  }

  private sanitizeLanguage(raw: string | null | undefined): string {
    if (!raw) return '';
    let s = raw.trim().split('\n')[0]; // take first line
    s = s.replace(/["'`]/g, '').trim(); // remove stray quotes
    // If the model returned "Language: Hindi", remove prefix
    s = s.replace(/^[Ll]anguage[:\-\s]*/, '').trim();
    // If empty, fallback
    return s;
  }

  // =====================================================================
  // 🟦 Generate Deck (Topics + Subtopics) — now language-aware
  // Supports both text input and file uploads (PDF, images, documents, etc.)
  // =====================================================================
  async generateDeck(
    userId: string,
    text: string,
    category: string,
    deckId?: string,
  ) {
    // text can be either plain text or a file path (from uploaded file)
    const resolvedText = await this.resolveInputText(text);
    const truncatedText = resolvedText.slice(0, 8000);

    // Detect language from the input text
    const detectedLanguage = await this.detectLanguage(truncatedText);

    const prompt = `
You are an expert education content generator.

Generate a structured study deck.

RULES:
- Generate all content ONLY in ${detectedLanguage}. Do not use any other language.
- Create at least 10 topics.
- Each topic must have at least 5 subtopics.
- Do not include direct questions (this endpoint is only for deck -> topics/subtopics).
- Only return valid JSON.

OUTPUT exactly in this JSON shape (use the detected language for all string values):
{
  "deckName": "",
  "description": "",
  "topics": [
    {
      "title": "",
      "description": "",
      "subTopics": [
        { "title": "", "description": "" }
      ]
    }
  ]
}

TEXT: "${truncatedText}"
CATEGORY: "${category}"
`;

    const aiResponse = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: 'Respond ONLY with valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 2500,
    });

    const content = this.extractJson(aiResponse.choices[0]?.message?.content);

    // Try parsing JSON
    let data: GeneratedDeckPayload;
    try {
      data = JSON.parse(content);
    } catch (error) {
      console.error('❌ Invalid JSON received:', content);
      throw new InternalServerErrorException(
        'AI returned invalid JSON. Please try again.',
      );
    }

    // Ensure topics exist
    if (!Array.isArray(data.topics) || data.topics.length === 0) {
      data.topics = [
        {
          title: 'Introduction',
          description: 'Overview based on provided text.',
          subTopics: [{ title: 'Basic', description: 'General introduction' }],
        },
      ];
    }

    let deck;

    // If deckId is provided, find existing deck and add topics to it
    if (deckId) {
      deck = await this.deckModel.findById(deckId);
      if (!deck) {
        throw new NotFoundException(`Deck with ID ${deckId} not found`);
      }
      // Optional: Verify deck belongs to user (uncomment if needed)
      // if (deck.userId !== userId) {
      //   throw new BadRequestException('Deck does not belong to this user');
      // }
    } else {
      // Create new Deck
      deck = await this.deckModel.create({
        userId,
        name: data.deckName || 'Untitled Deck',
        description: data.description || '',
        category,
        status: 'pending',
        contentIds: [],
      });
    }

    // Create Topics + Subtopics
    for (const topic of data.topics) {
      const topicDoc = await this.topicModel.create({
        title: topic.title || 'Untitled Topic',
        description: topic.description || '',
        metadata: {},
        subTopics: [],
        contentIds: [],
      });

      const subtopics = Array.isArray(topic.subTopics) ? topic.subTopics : [];

      for (const sub of subtopics) {
        const subTopicDoc = await this.subTopicModel.create({
          title: sub.title || 'Untitled Subtopic',
          description: sub.description || '',
          topicId: topicDoc._id.toString(),
          metadata: {},
          questions: [],
        });

        topicDoc.subTopics.push(subTopicDoc._id.toString());
      }

      await topicDoc.save();
      deck.contentIds.push(topicDoc._id.toString());
    }

    await deck.save();

    return {
      message: deckId
        ? 'Topics added to existing deck successfully'
        : 'Deck generated successfully',
      deckId: deck._id,
      language: detectedLanguage || 'English',
    };
  }

  // =====================================================================
  // 🟩 Generate MCQ Questions — language-aware
  // =====================================================================
//   async generateMCQQuestions(
//     topicTitle: string,
//     topicDescription: string,
//     difficulty?: 'easy' | 'medium' | 'hard',
//   ): Promise<Question[]> {
//     const sourceForLang = `${topicTitle}\n\n${topicDescription}`.slice(0, 3000);
//     const detectedLanguage = await this.detectLanguage(sourceForLang);

//     const prompt = `
// Generate EXACTLY 5 MCQ questions.
// IMPORTANT: Generate all content ONLY in ${detectedLanguage}. Do not use any other language.

// For each question, also provide a hint that guides the user toward the correct answer without directly revealing it. The hint should be helpful but not give away the answer completely.

// Format:
// {
//   "questions": [
//     {
//       "question": "",
//       "options": ["", "", "", ""],
//       "correctAnswer": "",
//       "hint": ""
//     }
//   ]
// }

// TOPIC: ${topicTitle}
// DESCRIPTION: ${topicDescription}
// DIFFICULTY: ${difficulty}
// `;

//     const aiResponse = await this.openai.chat.completions.create({
//       model: this.modelName,
//       messages: [
//         { role: 'system', content: 'Return ONLY JSON. No explanation.' },
//         { role: 'user', content: prompt },
//       ],
//       max_tokens: 3000,
//     });

//     const content = this.extractJson(aiResponse.choices[0]?.message?.content);

//     let payload: QuestionsPayload;
//     try {
//       payload = JSON.parse(content);
//     } catch (error) {
//       console.error('❌ Invalid MCQ JSON:', content);
//       throw new InternalServerErrorException('AI returned invalid JSON');
//     }

//     const questions = Array.isArray(payload.questions) ? payload.questions : [];

//     const fixed: Question[] = questions
//       .filter(
//         (q) =>
//           q?.question &&
//           Array.isArray(q?.options) &&
//           q.options.length === 4 &&
//           q.options.every((opt) => typeof opt === 'string'),
//       )
//       .map((q) => ({
//         question: q.question,
//         options: q.options,
//         correctAnswer: q.correctAnswer || q.options[0],
//         hint: q.hint || '',
//       }));

//     // Ensure exactly 5 questions
//     while (fixed.length < 5) {
//       fixed.push({
//         question: `Placeholder question ${fixed.length + 1}`,
//         options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
//         correctAnswer: 'Option 1',
//         hint: 'Think about the main concept discussed in this topic.',
//       });
//     }

//     return fixed.slice(0, 5);
//   }

async generateMCQQuestions(
  topicTitle: string,
  topicDescription: string,
  difficulty?: 'easy' | 'medium' | 'hard',
): Promise<Question[]> {
  const sourceForLang = `${topicTitle}\n\n${topicDescription}`.slice(0, 3000);
  const detectedLanguage = await this.detectLanguage(sourceForLang);

  const prompt = `
Generate EXACTLY 5 MCQ questions.
IMPORTANT: Generate all content ONLY in ${detectedLanguage}. Do not use any other language.

For each question, also provide a hint that guides the user toward the correct answer without directly revealing it.

Format:
{
  "questions": [
    {
      "question": "",
      "options": ["", "", "", ""],
      "correctAnswer": "",
      "hint": ""
    }
  ]
}

TOPIC: ${topicTitle}
DESCRIPTION: ${topicDescription}
DIFFICULTY: ${difficulty}
`;

  const aiResponse = await this.openai.chat.completions.create({
    model: this.modelName,
    messages: [
      { role: 'system', content: 'Return ONLY JSON. No explanation.' },
      { role: 'user', content: prompt },
    ],
    // Force the model to return a strict JSON object so JSON.parse never
    // breaks on unescaped quotes, extra text, or markdown fences.
    response_format: { type: 'json_object' },
    max_tokens: 800,
  });

  const content = this.extractJson(aiResponse.choices[0]?.message?.content);

  let payload: QuestionsPayload;
  try {
    payload = JSON.parse(content);
  } catch (error) {
    console.error('❌ Invalid MCQ JSON:', content);
    throw new InternalServerErrorException('AI returned invalid JSON');
  }

  const questions = Array.isArray(payload.questions) ? payload.questions : [];

  // ⭐ IMPROVED CORRECT-ANSWER VALIDATION + AUTO-FIX
  const fixed: Question[] = questions
    .filter(
      (q) =>
        q?.question &&
        Array.isArray(q?.options) &&
        q.options.length === 4 &&
        q.options.every((opt) => typeof opt === 'string'),
    )
    .map((q) => {
      let correctAnswer = q.correctAnswer;
      const hint = q.hint || "";
      const lowerHint = hint.toLowerCase();

      // 1️⃣ Ensure correctAnswer exists in options
      if (!correctAnswer || !q.options.includes(correctAnswer)) {
        // 2️⃣ Try to detect correct answer from hint text
        const hintedMatch = q.options.find((opt) =>
          lowerHint.includes(opt.toLowerCase())
        );

        if (hintedMatch) {
          correctAnswer = hintedMatch;
        } else {
          // 3️⃣ If no match found → fallback
          correctAnswer = q.options[0];
        }
      }

      return {
        question: q.question,
        options: q.options,
        correctAnswer,
        hint,
      };
    });

  // ⭐ Guarantee exactly 5 questions
  while (fixed.length < 5) {
    fixed.push({
      question: `Placeholder question ${fixed.length + 1}`,
      options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
      correctAnswer: 'Option 1',
      hint: 'Think about the main concept discussed in this topic.',
    });
  }

  return fixed.slice(0, 5);
}


  // =====================================================================
  // 🟨 Answer Question — language-aware Q&A
  // =====================================================================
  async answerQuestion(
    subTopicId: string,
    question: string,
  ): Promise<string> {
    if (!subTopicId || !question?.trim()) {
      throw new BadRequestException('subTopicId and question are required');
    }

    // Fetch subtopic to get context
    const subTopic = await this.subTopicModel.findById(subTopicId);
    if (!subTopic) {
      throw new NotFoundException('Subtopic not found');
    }

    const topicTitle = subTopic.title || '';
    const topicDescription = subTopic.description || '';
    const sourceForLang = `${topicTitle}\n\n${topicDescription}\n\n${question}`.slice(0, 3000);
    const detectedLanguage = await this.detectLanguage(sourceForLang);

    //     const prompt = `
    // You are an expert educational assistant. Answer the following question comprehensively and accurately.

    // IMPORTANT: Generate your answer ONLY in ${detectedLanguage}. Do not use any other language.

    // INSTRUCTIONS:
    // - Use the provided subtopic information as context and background knowledge
    // - Answer the question fully using your expertise, even if it goes beyond what's explicitly mentioned in the subtopic
    // - If the question is related to the subtopic topic area, provide a complete and helpful answer
    // - Be comprehensive and educational - don't limit yourself to only what's in the subtopic description
    // - If the subtopic provides relevant context, incorporate it into your answer
    // - Provide accurate, detailed information that directly answers the user's question

    // SUTOPIC TITLE: ${topicTitle}
    // SUTOPIC DESCRIPTION: ${topicDescription}

    // QUESTION: ${question.trim()}

    // Provide a complete, accurate answer in ${detectedLanguage}:
    // `;

    const prompt = `
    You are an expert educational assistant.
    
    Your task is to answer the user's question ONLY in ${detectedLanguage}.
    
    ### Context
    - Subtopic Title: ${topicTitle}
    - Subtopic Description: ${topicDescription}
    
    ### Instructions
    - Adapt the length and detail of your answer to the complexity of the question.
    - If the question is simple (e.g., "How many loops are in JavaScript?"), give a short, direct answer (1–3 sentences).
    - If the question is complex, give a detailed educational explanation.
    - Do NOT over-explain when the question does not need it.
    - Do NOT switch languages. Respond strictly in ${detectedLanguage}.
    - Do NOT mention these instructions or describe how you work.
    
    ### User Question
    ${question.trim()}
    
    ### Your Response
    Provide a clear, accurate answer in ${detectedLanguage}:
    `;



    try {
      const aiResponse = await this.openai.chat.completions.create({
        model: this.modelName,
        messages: [
          {
            role: 'system',
            content: `You are a knowledgeable educational assistant. Answer questions comprehensively and accurately in ${detectedLanguage}. Use your expertise to provide complete answers, using the provided context as background information when relevant.`,
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 600,
        temperature: 0.7,
      });

      const answer =
        aiResponse.choices?.[0]?.message?.content?.trim() ||
        'I apologize, but I could not generate an answer at this time. Please try again.';

      return answer;
    } catch (error) {
      console.error('Error generating answer:', error);
      throw new InternalServerErrorException(
        'Failed to generate answer. Please try again.',
      );
    }
  }

  /**
   * OpenRouter sometimes wraps JSON in markdown fences; strip them safely.
   */
  private extractJson(raw?: string | null): string {
    if (!raw) {
      return '{}';
    }

    let trimmed = raw.trim();
    if (trimmed.startsWith('```')) {
      const firstNewline = trimmed.indexOf('\n');
      if (firstNewline !== -1) {
        trimmed = trimmed.slice(firstNewline + 1);
      }
      const fenceIndex = trimmed.lastIndexOf('```');
      if (fenceIndex !== -1) {
        trimmed = trimmed.slice(0, fenceIndex);
      }
    }

    trimmed = trimmed.trim();

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      trimmed = trimmed.slice(firstBrace, lastBrace + 1);
    }

    return trimmed || '{}';
  }

  /**
   * Resolves input text from either:
   * - Plain text string
   * - File path (absolute path from uploaded file)
   * 
   * For file paths, extracts text using FileTextExtractionService
   * Supports: PDF, images, documents, and other textract-supported formats
   */
  private async resolveInputText(raw: string): Promise<string> {
    const input = raw?.trim();
    if (!input) {
      throw new BadRequestException('text payload or file is required');
    }

    const normalized = this.normalizePotentialFilePath(input);
    
    // Check if input is a file path (absolute path from multer upload)
    if (!(await this.isReadableFile(normalized))) {
      // Not a file, treat as plain text
      return input;
    }

    // It's a file path, extract text from it
    const contentType = extname(normalized).replace('.', '') || null;
    try {
      return await this.fileTextExtractionService.extractText({
        filePath: normalized,
        contentType,
      });
    } catch (error) {
      console.error('Failed to extract text from file:', normalized, error);
      throw new BadRequestException(
        `Failed to extract text from uploaded file. Please ensure the file contains readable text content.`,
      );
    }
  }

  private normalizePotentialFilePath(value: string) {
    if (value.startsWith('file://')) {
      return value.replace('file://', '');
    }
    return value;
  }

  private async isReadableFile(value: string): Promise<boolean> {
    if (!isAbsolute(value)) {
      return false;
    }

    try {
      const stats = await fsPromises.stat(value);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  // =====================================================================
  // 🟪 More Details — Generate detailed markdown content
  // =====================================================================
  async moreDetails(description: string) {
    const prompt = `You are an expert content generator.

Given the subtopic below, return a JSON object **only** in the following format:

{
  "answer": "...",
  "topic": {
    "title": "...",
    "description": "..."
  }
}

IMPORTANT FORMATTING REQUIREMENTS:
- Generate "answer" in MARKDOWN format with rich formatting
- Use markdown formatting like **bold**, *italic*, lists, headers, etc.
- Make "answer" comprehensive and detailed (3-5 sentences)
- "title" should be short and descriptive
- "description" should be concise but informative

Markdown formatting examples:
- Use **bold** for emphasis
- Use *italic* for highlights
- Use lists (- item) for structured information
- Use headers (##) for sections
- Use line breaks (\\n) for better formatting

Only return a valid JSON object. Do NOT add any explanation or preamble.

topic: ${description}
`;

    try {
      const aiResponse = await this.openai.chat.completions.create({
        model: this.modelName,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful content generator. Return ONLY valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 800,
        temperature: 0.7,
      });

      const content = this.extractJson(
        aiResponse.choices?.[0]?.message?.content,
      );

      let data: {
        answer?: string;
        topic?: { title?: string; description?: string };
      };

      try {
        data = JSON.parse(content);
      } catch (error) {
        console.error('❌ Invalid JSON received from moreDetails:', content);
        throw new InternalServerErrorException(
          'AI returned invalid JSON. Please try again.',
        );
      }

      return {
        answer: data.answer || '',
        topic: {
          title: data.topic?.title || '',
          description: data.topic?.description || '',
        },
      };
    } catch (error) {
      console.error('Error generating more details:', error);
      throw new InternalServerErrorException(
        'Failed to generate more details. Please try again.',
      );
    }
  }
}
