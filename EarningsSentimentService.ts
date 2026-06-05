import { GoogleGenAI, Type, Schema } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function scoreManagementConfidence(transcriptText: string): Promise<{ confidence_score: number, primary_concern: string } | null> {
  try {
    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        confidence_score: {
          type: Type.INTEGER,
          description: "A hard integer from 1-100 representing the management confidence score based on the Q&A segment. 1 is extremely panicked/defensive, 100 is highly confident/optimistic."
        },
        primary_concern: {
          type: Type.STRING,
          description: "The primary concern or theme of the Q&A segment, or 'None' if heavily confident."
        }
      },
      required: ["confidence_score", "primary_concern"]
    };

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are an NLP Machine Learning AI designed to score management confidence from earnings call transcripts.
Task:
1. Isolate the Q&A portion of this transcript. If no Q&A is present, evaluate the forward outlook section.
2. Evaluate executive hesitation, defensive language, or confident forward outlooks.
3. Return a management confidence score (1-100) and the primary concern (or 'None' if completely confident).

Transcript:
${transcriptText.substring(0, 80000)}` // Safeguard transcript length
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.1,
      }
    });

    if (response.text) {
      const parsed = JSON.parse(response.text);
      return {
        confidence_score: parsed.confidence_score,
        primary_concern: parsed.primary_concern
      };
    }
    return null;
  } catch (error) {
    console.error("[EarningsSentimentService] Error scoring management confidence:", error);
    return null;
  }
}
