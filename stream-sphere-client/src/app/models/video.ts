export interface Video {
    _id: string;
    title: string;
    description?: string;
    S3_url: string;
    hlsUrl?: string | null;
    previewUrl?: string | null;
    thumbnailUrl?: string | null;
    user_id: string;
    category?: string;
    aiSummary?: string | null;   // AI-generated summary from Lambda pipeline
    likes: number;
    dislikes: number;
    views?: number;
    uploadedAt: string;
    commentCount?: number;
    status?: string;
    userName?: string;
}

export interface VideoResponse {
    success: boolean;
    videos: Video[];
}
