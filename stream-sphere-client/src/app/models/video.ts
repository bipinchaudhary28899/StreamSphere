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
    likes: number;
    dislikes: number;
    uploadedAt: string;
    commentCount?: number;
}

export interface VideoResponse {
    success: boolean;
    videos: Video[];
}
