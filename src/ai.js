import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
export const aiEnabled = !!client;

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

const FORM_PROMPT = `This is a photo of a handwritten Baby Connections parent feedback form.
Read the handwriting and return ONLY a JSON object with these keys:
- "rating": integer 1-5 for how helpful the program was, or null if not marked
- "would_recommend": true, false, or null if not marked
- "most_valued": what the parent wrote about what they valued most ("" if blank)
- "suggestions": what the parent wrote as suggestions/comments ("" if blank)
- "raw_text": a full transcription of all handwriting on the page
- "confidence": "high", "medium" or "low" (low if handwriting was hard to read or the page isn't a form)
Never guess at illegible words; write [illegible] instead.`;

/** Transcribe a photo of a paper feedback form. Returns null when AI isn't configured. */
export async function transcribeFeedbackPhoto(path) {
  if (!client) return null;
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: MEDIA[ext] || 'image/jpeg', data: readFileSync(path).toString('base64') } },
        { type: 'text', text: FORM_PROMPT },
      ],
    }],
  });
  const text = msg.content.map((b) => b.text || '').join('');
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) throw new Error('No JSON in model response');
  return JSON.parse(json[0]);
}

/** Short narrative summary of parent comments for a program report. */
export async function summarizeComments(programName, comments) {
  if (!client || !comments.length) return null;
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Parent feedback comments from the Baby Connections program "${programName}":\n\n${comments
        .map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nWrite a 3-4 sentence summary for program staff: main strengths, main suggestions, and overall tone. Be factual; don't invent details.`,
    }],
  });
  return msg.content.map((b) => b.text || '').join('').trim();
}
