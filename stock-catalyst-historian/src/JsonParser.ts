import { jsonrepair } from 'jsonrepair';

export function extractAndParseJson(text: string): any {
  let t = text.trim();
  
  // (a) Strip citation brackets
  t = t.replace(/\[\d+\]/g, "");

  // (b) Extract the substring from the first "{" to the last "}"
  const firstBrace = t.indexOf('{');
  const lastBrace = t.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    t = t.substring(firstBrace, lastBrace + 1);
  }

  // Remove bad control characters
  t = t.replace(/[\u0000-\u0019]+/g, ' ');

  try {
    return JSON.parse(t);
  } catch (err) {
    try {
      const repaired = jsonrepair(t);
      return JSON.parse(repaired);
    } catch (repairErr) {
      console.warn("Failed to repair JSON:", repairErr);
      throw err;
    }
  }
}


