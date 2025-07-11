// services/categoryDetection.service.ts
import axios from 'axios';

export class CategoryDetectionService {
  private readonly HUGGING_FACE_API_URL = 'https://api-inference.huggingface.co/models/facebook/bart-large-mnli';
  private readonly HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;

  // Define common video categories
  private readonly categories = [
    'Gaming',
    'Technology', 
    'Education',
    'Music',
    'Sports',
    'Comedy',
    'Cooking',
    'Travel',
    'News',
    'Lifestyle',
    'Entertainment',
    'Science',
    'Business',
    'Health',
    'Fashion',
    'Art',
    'Documentary',
    'Animation',
    'Tutorial',
    'Review'
  ];

  async detectCategory(title: string, description: string): Promise<string> {
    try {
      // Combine title and description for analysis
      const combinedText = `${title} ${description}`;
      
      // Use Hugging Face API for category detection
      if (this.HUGGING_FACE_API_KEY) {
        return await this.detectByHuggingFace(combinedText);
      }

      return 'Uncategorized';
    } catch (error) {
      console.error('Error detecting category:', error);
      return 'Uncategorized';
    }
  }

  private async detectByHuggingFace(text: string): Promise<string> {
    try {
      const response = await axios.post(
        this.HUGGING_FACE_API_URL,
        {
          inputs: text,
          parameters: {
            candidate_labels: this.categories
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.HUGGING_FACE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data && response.data.labels && response.data.scores) {
        const bestMatchIndex = response.data.scores.indexOf(Math.max(...response.data.scores));
        const confidence = response.data.scores[bestMatchIndex];
        
        // Only return category if confidence is above threshold
        if (confidence > 0.2) {
          return response.data.labels[bestMatchIndex];
        }
      }

      return 'Uncategorized';
    } catch (error) {
      console.error('Hugging Face API error:', error);
      return 'Uncategorized';
    }
  }

  // Get all available categories
  getAvailableCategories(): string[] {
    return this.categories;
  }
} 