// services/categoryDetection.service.ts
import axios from "axios";

export class CategoryDetectionService {
  private readonly HUGGING_FACE_API_URL =
  "https://router.huggingface.co/hf-inference/models/facebook/bart-large-mnli";
  private readonly HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;

  // Define common video categories
  private readonly categories = [
    "Music",
    "Gaming",
    "Sports",
    "Movies",
    "Comedy",
    "Web Series",
    "Learning",
    "Podcasts",
    "News",
    "Fitness",
    "Vlogs",
    "Travel",
    "Tech",
    "Food & Recipes",
    "Motivation",
    "Short Films",
    "Art & Design",
    "Fashion",
    "Kids",
    "History",
    "DIY",
    "Documentaries",
    "Spirituality",
    "Real Estate",
    "Automotive",
    "Science",
    "Nature",
    "Animals",
    "Health & Wellness",
    "Business & Finance",
    "Personal Development",
    "Unboxing & Reviews",
    "Live Streams",
    "Events & Conferences",
    "Memes & Challenges",
    "festivals",
    "Interviews",
    "Trailers & Teasers",
    "Animation",
    "Magic & Illusions",
    "Comedy Skits",
    "Parodies",
    "Reaction Videos",
    "ASMR",
  ];
  private readonly threshold = 0.0; // Confidence threshold for category assignment

  async detectCategory(title: string, description: string): Promise<string> {
    try {
      // Use only the actual content — no trailing prompts that confuse BART-MNLI
      const combinedText = description
        ? `${title}. ${description}`.trim()
        : title.trim();

      // Use Hugging Face API for category detection
      if (this.HUGGING_FACE_API_KEY) {
        return await this.detectByHuggingFace(combinedText);
      }

      return "Other";
    } catch (error) {
      console.error("Error detecting category:", error);
      return "Other";
    }
  }

  /**
   * Call the HuggingFace inference API with exponential-backoff retry.
   *
   * HF free-tier returns HTTP 429 (rate limit) or 503 (model loading) when
   * multiple users call it simultaneously.  Without retries every concurrent
   * burst silently falls back to "Other".  With retries we give the model a
   * few seconds to recover before giving up.
   *
   * Schedule: attempt 1 → wait 1 s → attempt 2 → wait 2 s → attempt 3 → give up
   */
  private async detectByHuggingFace(text: string): Promise<string> {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          this.HUGGING_FACE_API_URL,
          {
            inputs: text,
            parameters: {
              candidate_labels: this.categories,
              hypothesis_template: "This video is about {}.",
            },
          },
          {
            headers: {
              Authorization: `Bearer ${this.HUGGING_FACE_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 20000,
          },
        );

        // Normalize: HF sometimes wraps the result in an array
        const result = Array.isArray(response.data)
          ? response.data[0]
          : response.data;

        if (result?.labels && result?.scores) {
          const bestIdx = result.scores.indexOf(Math.max(...result.scores));
          if (result.scores[bestIdx] > this.threshold) return result.labels[bestIdx];
        }

        if (result?.label && result?.score) {
          if (result.score > this.threshold) return result.label;
        }

        return "Other";

      } catch (error: any) {
        const status: number | undefined = error?.response?.status;
        const isRetryable = status === 429 || status === 503 || !status; // also retry network errors

        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * attempt; // 1s, 2s
          console.warn(
            `HuggingFace attempt ${attempt}/${MAX_RETRIES} failed (HTTP ${status ?? 'network error'}) — retrying in ${delay}ms`,
          );
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }

        console.error(
          `HuggingFace API error after ${attempt} attempt(s):`,
          error?.response?.data || error.message,
        );
        return "Other";
      }
    }

    return "Other"; // TypeScript fallthrough guard
  }

  // Get all available categories
  getAvailableCategories(): string[] {
    return this.categories;
  }
}
