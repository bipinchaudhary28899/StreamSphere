export interface Video {
    _id: string;
    title: string;
    description?: string;
    S3_url: string;
    thumbnail_url?: string;
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
