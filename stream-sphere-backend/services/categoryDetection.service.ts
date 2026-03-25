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
    "ASMR",
    "Unboxing & Reviews",
    "Live Streams",
    "Events & Conferences",
    "Memes & Challenges"
  ];
  private readonly threshold = 0.2; // Confidence threshold for category assignment

  async detectCategory(title: string, description: string): Promise<string> {
    try {
      // Combine title and description for analysis
      const combinedText = `Video Title: ${title} Description: ${description} This video is related to:`;

      // Use Hugging Face API for category detection
      if (this.HUGGING_FACE_API_KEY) {
        return await this.detectByHuggingFace(combinedText);
      }

      return "Uncategorized";
    } catch (error) {
      console.error("Error detecting category:", error);
      return "Uncategorized";
    }
  }

  private async detectByHuggingFace(text: string): Promise<string> {
    try {
      const response = await axios.post(
        this.HUGGING_FACE_API_URL,
        {
          inputs: text,
          parameters: {
            candidate_labels: this.categories,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.HUGGING_FACE_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );

      // ✅ ALWAYS normalize first
      const result = Array.isArray(response.data)
        ? response.data[0]
        : response.data;

      console.log("HF RAW RESPONSE:", result); // 🔥 NOW THIS WILL PRINT

      if (result) {
        if (result.labels && result.scores) {
          const bestMatchIndex = result.scores.indexOf(
            Math.max(...result.scores),
          );
          const confidence = result.scores[bestMatchIndex];

          console.log(
            "Best Label:",
            result.labels[bestMatchIndex],
            "Confidence:",
            confidence,
          );

          if (confidence > this.threshold) {
            return result.labels[bestMatchIndex];
          }
        }

        if (result.label && result.score) {
          console.log(
            "Single Label:",
            result.label,
            "Confidence:",
            result.score,
          );

          if (result.score > this.threshold) {
            return result.label;
          }
        }
      }

      return "Uncategorized";
    } catch (error: any) {
      console.error(
        "Hugging Face API error:",
        error?.response?.data || error.message,
      );
      return "Uncategorized";
    }
  }

  // Get all available categories
  getAvailableCategories(): string[] {
    return this.categories;
  }
}
