# StreamSphere - Video Platform

A full-stack video streaming platform built with Angular (Frontend) and Node.js/Express (Backend), featuring Google OAuth authentication, video upload, like/dislike functionality, watch history, category-based video organization, and performance optimizations including lazy loading, CloudFront caching, and debounce-style request throttling.

---

## 🚀 Quick Start

### Backend Setup
```bash
cd stream-sphere-backend
npm install
cp .env.example .env   # then fill in your own values
npm run dev
```

### Frontend Setup
```bash
cd stream-sphere-client
npm install
npm start
```

---

## 📋 Features

- [Feature 1: Google Login](#feature-1-google-login)
- [Feature 2: Video Upload](#feature-2-video-upload)
- [Feature 3: Video Display & Categorization](#feature-3-video-display--categorization)
- [Feature 4: Like/Dislike Functionality](#feature-4-likedislike-functionality)
- [Feature 5: Video Player & Details](#feature-5-video-player--details)
- [Feature 6: Video Cards & Category Slider](#feature-6-video-cards--category-slider)
- [Feature 7: User Profile & Video Management](#feature-7-user-profile--video-management)
- [Feature 8: Video Deletion](#feature-8-video-deletion)
- [Feature 9: Liked & Disliked Videos in User Profile](#feature-9-liked--disliked-videos-in-user-profile)
- [Feature 10: Video Duration Limit (2 Minutes)](#feature-10-video-duration-limit-2-minutes)
- [Feature 11: Video Carousel – Top Liked Videos](#feature-11-video-carousel--top-liked-videos)
- [Feature 12: Hero Carousel – Netflix-Style Auto-Advance](#feature-12-hero-carousel--netflix-style-auto-advance)
- [Feature 13: Watch History](#feature-13-watch-history)
- [Optimizations](#-optimizations)
- [Technical Architecture](#-technical-architecture)

---

## FEATURE 1: GOOGLE LOGIN

### 🔄 Complete Flow

#### Frontend Flow
1. **Entry Point**: `stream-sphere-client/src/app/components/user-login/user-login.component.ts`
   - Component loads Google Sign-In script dynamically
   - Initializes Google OAuth with client ID

2. **User Interaction**: User clicks "Continue with Google" button
   - Google OAuth popup appears
   - User authenticates with Google
   - Google returns a credential token

3. **Token Processing**: `handleCredentialResponse()` method
   - Receives Google credential token
   - Calls `AuthService.googleLogin(token)`

4. **API Call**: `stream-sphere-client/src/app/services/auth.service.ts`
   - Sends POST request to: `http://localhost:3000/api/google-login`
   - Payload: `{ token: "google_credential_token" }`

#### Backend Flow
1. **Route Handler**: `stream-sphere-backend/routes/centralRoute.route.ts`
   - Route: `POST /api/google-login`
   - Calls: `googleLogin` controller

2. **Controller**: `stream-sphere-backend/controllers/auth.controller.ts`

3. **Service**: `stream-sphere-backend/services/auth.service.ts`
   - `client` — OAuth2Client instance for Google token verification
   - `ticket` — Verified Google token payload
   - `payload` — User data from Google (name, email, picture)
   - `user` — Database user object
   - `isNewUser` — Boolean flag for new user registration
   - `jwtPayload` — JWT token payload structure
   - `jwtToken` — Generated JWT token

4. **Database Operations**: `stream-sphere-backend/models/user.ts`
   - Checks if user exists by email
   - Creates new user if not found
   - Updates existing user's profile image

5. **Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "userId": "67ffe6d78622bdc4703bdc29",
    "userName": "John Doe",
    "email": "john@example.com",
    "profileImage": "https://lh3.googleusercontent.com/...",
    "role": "user",
    "isVerified": true
  },
  "isNewUser": false
}
```

#### Frontend Response Handling
- Stores JWT token: `localStorage.setItem('token', res.token)`
- Stores user data: `localStorage.setItem('user', JSON.stringify(res.user))`
- Redirects to home page or saved redirect URL

### 🔧 Key Variables
| Variable | Purpose |
|---|---|
| `token` | Google credential token from OAuth |
| `jwtPayload` | Contains userId, email, subject for JWT generation |
| `jwtToken` | JWT token for subsequent API authentication |
| `isNewUser` | Boolean to track if user is newly registered |
| `userData` | Parsed user information from localStorage |

### 🛠️ Services Used
- `AuthService` — Handles Google login API calls
- `OAuth2Client` — Verifies Google tokens
- `jwt.sign()` — Generates JWT tokens
- `User.findOne()` — Database user lookup
- `User.save()` — Database user creation/update

---

## FEATURE 2: VIDEO UPLOAD

### 🔄 Complete Flow

#### Frontend Flow
1. **Entry Point**: `stream-sphere-client/src/app/components/upload-video/upload-video.component.ts`
   - `selectedFile` — File object from input
   - `uploadProgress` — Upload progress percentage

2. **File Validation**
   - `maxFileSize` — 100MB limit
   - `allowedTypes` — `['video/mp4', 'video/avi', 'video/mov']`

3. **Upload Process**: `uploadVideo()` → `UploadService.uploadVideo(file)`

4. **API Call**: `POST /api/upload-url`
   - Payload: `{ fileName: "video.mp4", fileType: "video/mp4" }`

#### Backend Flow
1. **Route**: `POST /api/upload-url` → `uploadController`

2. **Controller**: `stream-sphere-backend/controllers/upload.controller.ts`
   - `fileName` — Original file name
   - `fileType` — MIME type of video
   - `s3Key` — S3 storage key
   - `presignedUrl` — AWS S3 presigned URL

3. **Service**: `stream-sphere-backend/services/upload.service.ts`
   - Generates unique S3 key with timestamp
   - Creates presigned URL for direct upload

#### Frontend Upload to S3
- Uploads file directly to S3 using presigned URL
- Tracks upload progress
- Calls `saveVideoMetadata()` after successful upload

#### Video Metadata Saving
- Endpoint: `POST /api/save-video`
- Payload: Video metadata with S3 URL, user info, category

### 🔧 Key Variables
| Variable | Purpose |
|---|---|
| `selectedFile` | User's selected video file |
| `uploadProgress` | Upload progress percentage (0–100) |
| `s3Key` | Unique identifier for S3 storage |
| `presignedUrl` | Temporary URL for direct S3 upload |
| `videoMetadata` | Complete video information for database |

### 🛠️ Services Used
- `UploadService` — Handles file upload and metadata saving
- `S3Client` — AWS S3 operations
- `PutObjectCommand` — S3 upload command
- `getSignedUrl` — Generates presigned URLs

---

## FEATURE 3: VIDEO DISPLAY & CATEGORIZATION

### 🔄 Complete Flow

#### Frontend Flow
1. **Entry Point**: `stream-sphere-client/src/app/components/video-list/video-list.component.ts`
   - `videos` — Array of video objects
   - `filteredVideos` — Videos filtered by category/search
   - `selectedCategory` — Currently selected category

2. **Data Fetching**: `VideoService.getAllVideos()` → `GET /api/home`

3. **Category Filtering**: `VideoService.getVideosByCategory(category)` → `GET /api/videos/category/{category}`

#### Backend Flow
1. **Routes**:
   - `GET /api/home` — All videos
   - `GET /api/videos/category/:category` — Category-specific videos

2. **Controller**: `stream-sphere-backend/controllers/getVideo.controller.ts`
   - `getVideos()` — Returns all videos
   - `getVideosByCategory()` — Returns filtered videos

3. **Service**: `stream-sphere-backend/services/getVideo.service.ts`
   - `getAllVideos()` — Fetches all videos sorted by upload date
   - `getVideosByCategory()` — Fetches videos by category

4. **Video Schema Fields** (`stream-sphere-backend/models/video.ts`):
   - `title`, `description`, `S3_url`, `user_id`, `user_name`
   - `category`, `likes`, `dislikes`, `likedBy`, `dislikedBy`

### 🛠️ Services Used
- `VideoService` — Handles video data fetching and filtering
- `Video.find()` — MongoDB query for video retrieval
- `Video.find().sort()` — Sorted video retrieval by upload date

---

## FEATURE 4: LIKE/DISLIKE FUNCTIONALITY

### 🔄 Complete Flow

#### Frontend Flow
1. **Entry Point**: `stream-sphere-client/src/app/components/video-player/video-player.component.ts`
   - `currentUserId` — Logged-in user's ID
   - `userReaction` — User's current reaction (`'liked'`, `'disliked'`, `'none'`)
   - `isLiking` / `isDisliking` — Booleans to prevent double-clicks

2. **Actions**:
   - `onLikeClick()` → `VideoService.likeVideo(videoId)`
   - `onDislikeClick()` → `VideoService.dislikeVideo(videoId)`

3. **API Calls**:
   - `POST /api/videos/{videoId}/like`
   - `POST /api/videos/{videoId}/dislike`
   - `GET /api/videos/{videoId}/reaction`

#### Backend Flow
1. **Routes**: Protected by `authenticateJWT` middleware

2. **JWT Authentication**: `stream-sphere-backend/services/auth.service.ts`
   - `authenticateJWT(req, res, next)` middleware
   - Extracts and verifies JWT from `Authorization` header
   - Attaches decoded user to `req.user`

3. **Database Logic**:
   - **Like**: If already liked → unlike; if disliked → switch; else → add like
   - **Dislike**: If already disliked → remove; if liked → switch; else → add dislike

### 🔧 Key Variables
| Variable | Purpose |
|---|---|
| `currentUserId` | Logged-in user's unique identifier |
| `userReaction` | Current user's reaction state |
| `isLiking`/`isDisliking` | Flags to prevent double-clicks |
| `likedBy`/`dislikedBy` | Arrays tracking which users reacted |
| `likes`/`dislikes` | Count of total reactions |

### 🛠️ Services Used
- `VideoService` — Frontend service for like/dislike API calls
- `authenticateJWT` — Middleware for JWT token verification
- `jwt.verify()` — JWT token verification
- `Video.findById()` / `video.save()` — Database operations

---

## FEATURE 5: VIDEO PLAYER & DETAILS

### 🔄 Complete Flow

#### Frontend Flow
1. **Entry Point**: `stream-sphere-client/src/app/components/video-player/video-player.component.ts`
   - `video` — Complete video object
   - `safeVideoUrl` — Sanitized video URL
   - `loading` / `error` — Loading and error state
   - `isOwner` — Boolean if current user owns the video

2. **URL Sanitization**: `DomSanitizer.bypassSecurityTrustResourceUrl()`

3. **Authentication Check**: `checkUserAuthentication()`
   - Reads JWT token from localStorage
   - Sets `currentUserId` and `isOwner`

#### Video Display
- HTML5 video player with controls
- Video title, description, upload date, category, uploader name
- Like/dislike section with counts and current user reaction
- Delete button (owner only)

### 🛠️ Services Used
- `VideoService` — Fetches video data
- `DomSanitizer` — Sanitizes video URLs
- `ActivatedRoute` — Gets route parameters
- `Router` — Handles navigation

---

## FEATURE 6: VIDEO CARDS & CATEGORY SLIDER

### 🔄 Complete Flow

#### Video Cards
- **Component**: `stream-sphere-client/src/app/components/video-card/video-card.component.ts`
- `video` — Video object input
- `safeUrl` — Sanitized video URL
- `flip` — Boolean for flip state (flip shows extra details)
- `onVideoClick()` — Navigates to video player
- `onFlipClick()` — Toggles card flip (stops propagation)

#### Category Slider
- **Component**: `stream-sphere-client/src/app/components/category-slider/category-slider.component.ts`
- `categories` — Array of available categories
- `selectedCategory` — Currently selected category
- `onCategorySelect(category)` → `VideoService.setCategory(category)`
- Uses `BehaviorSubject` (`categorySubject`) for reactive category updates

### 🛠️ Services Used
- `VideoService` — Manages category selection and video data
- `DomSanitizer` — Sanitizes video URLs
- `BehaviorSubject` — Manages category state

---

## FEATURE 7: USER PROFILE & VIDEO MANAGEMENT

### 🔄 Complete Flow

#### User Profile
- **Component**: `stream-sphere-client/src/app/components/user-profile/user-profile.component.ts`
- Loads user data from localStorage on `ngOnInit()`
- Fetches user's uploaded videos via `VideoService.getAllVideos()` filtered by `user_id`

#### Video Management Table
- Angular Material table with columns: `['title', 'category', 'uploadedAt', 'actions']`
- `deleteVideo(videoId)` → `VideoService.deleteVideo(videoId, userId)`
- `viewVideo(videoId)` → navigates to video player

### 🔧 Key Variables
| Variable | Purpose |
|---|---|
| `user` | Current user object with profile information |
| `userVideos` | Array of videos uploaded by current user |
| `displayedColumns` | Array defining table column structure |
| `dataSource` | `MatTableDataSource` for Material table |

### 🛠️ Services Used
- `VideoService` — Fetches and manages video data
- `MatTableDataSource` — Manages table data
- `Router` — Handles navigation
- `localStorage` — Stores user data

---

## FEATURE 8: VIDEO DELETION

### 🔄 Complete Flow

#### Frontend Flow
- Delete button shown only to video owners (checked via `currentUserId === video.user_id`)
- Available from: Video Player, User Profile table, Video Card (flip view)
- `onDeleteClick()` → `VideoService.deleteVideo(videoId, userId)`

#### Backend Flow
1. **Route**: `DELETE /api/videos/:videoId`

2. **Authorization Check**: `video.user_id !== userId` → 401 Unauthorized

3. **S3 File Deletion**: `DeleteObjectCommand` removes video from S3

4. **Database Deletion**: `Video.findByIdAndDelete(videoId)` — removes all metadata and reaction data (likes, dislikes, likedBy, dislikedBy)

### ⚠️ Impact on Like/Dislike Data
- All like/dislike counts and user arrays are permanently removed (hard delete)
- No soft-delete or recovery mechanism
- Re-uploaded videos start fresh with 0 likes/dislikes

### 🔒 Security Features
- Owner-only deletion enforced on both frontend and backend
- S3 file cleanup on deletion
- Full database cleanup of associated data

---

## FEATURE 9: LIKED & DISLIKED VIDEOS IN USER PROFILE

### 🔄 Complete Flow

#### Backend
- `getLikedVideos(userId)` → `Video.find({ likedBy: userId }).sort({ uploadedAt: -1 })`
- `getDislikedVideos(userId)` → `Video.find({ dislikedBy: userId }).sort({ uploadedAt: -1 })`
- Routes: `GET /api/videos/liked` and `GET /api/videos/disliked` (both require `authenticateJWT`)

#### Frontend
- Sidebar buttons: "Liked Videos" and "Disliked Videos"
- `loadLikedVideos()` and `loadDislikedVideos()` called in `ngOnInit()`
- Sections shown/hidden via `showLikedVideosSection` and `showDislikedVideosSection` booleans
- Videos displayed using `app-video-card` with flip animation disabled
- Liked videos: green header (`#4caf50`); Disliked videos: red header (`#f44336`)

### 🔒 Security
- JWT authentication required for all requests
- Users can only access their own liked/disliked videos

---

## FEATURE 10: VIDEO DURATION LIMIT (2 MINUTES)

### 🔄 Complete Flow

#### Frontend Validation
- `checkVideoDuration(file: File)` uses HTML5 `<video>` element to read metadata
- Limit: 120 seconds
- On violation: shows alert, clears file input
- UI hint: `<small class="duration-limit">` displays limit text in italic gray

#### Backend Validation
- `getVideoDuration(videoUrl)` uses `ffprobe-static` to analyze video
- If `duration > 120` → throws error with message `'Video duration exceeds 2 minutes...'`
- Controller returns `400` status with the error message

### 🔧 Key Variables
| Variable | Purpose |
|---|---|
| `duration` | Video duration in seconds (frontend & backend) |
| `selectedFile` | Selected video file object (frontend) |
| `ffprobe` | FFmpeg binary for video analysis (backend) |

### 🛠️ Services Used
- HTML5 Video API — Frontend duration check
- `ffprobe-static` — Backend accurate duration analysis
- Double validation (frontend + backend) for robustness

---

## FEATURE 11: VIDEO CAROUSEL – TOP LIKED VIDEOS

### 🔄 Complete Flow

#### Backend
- `getTopLikedVideos()` → `Video.find({}).sort({ likes: -1 }).limit(3)`
- Route: `GET /api/videos/top-liked` (public, no authentication required)

#### Frontend
- **Component**: `stream-sphere-client/src/app/components/video-carousel/`
- `topVideos` — Array of top 3 most liked videos
- `currentIndex` — Current slide index (0–2)
- Auto-rotation every 3 seconds via `setInterval`
- Previous/Next buttons + dot indicators
- Timer cleaned up in `ngOnDestroy`

### 🎨 UI Features
- Purple gradient background with modern styling
- Navigation controls with hover effects
- Dot indicators showing current slide
- Smooth CSS transitions
- Responsive for mobile and desktop

---

## FEATURE 12: HERO CAROUSEL – NETFLIX-STYLE AUTO-ADVANCE

### 🔄 Complete Flow

#### Backend
- Same endpoint as Feature 11: `GET /api/videos/top-liked`

#### Frontend
- **Component**: `stream-sphere-client/src/app/components/hero-carousel/hero-carousel.component.ts`
- Standalone Angular 17 component

#### Key Variables
| Variable | Purpose |
|---|---|
| `videos` | Array of top 3 most liked videos |
| `currentIndex` | Current video index (0–2) |
| `autoAdvanceTimer` | Timer reference for 8-second auto-advance |
| `AUTO_ADVANCE_INTERVAL` | 8000ms auto-advance interval |
| `intersectionObserver` | Detects carousel visibility in viewport |
| `isLoading` / `error` | Loading and error state |

#### Auto-Advance Behavior
- Advances every 8 seconds when carousel is visible
- Pauses when tab is switched; resumes on return
- Manual navigation (arrows/thumbnails) resets the timer
- `IntersectionObserver` with 30% threshold triggers play/pause

#### Navigation
- Arrow buttons: `previousVideo()` / `nextVideo()` with `stopPropagation()`
- Clickable thumbnail indicators for direct access
- "Play Now" button navigates to `/video/:id`

#### Lifecycle Management
- `ngOnInit()`: loads videos, sets up IntersectionObserver and tab visibility listener
- `ngOnDestroy()`: clears timer, disconnects observer, removes event listener

### 🎨 UI Features
- Full-width Netflix-style hero layout with overlay text
- Progress indicator showing current video position (e.g., "1 of 3")
- Loading spinner and error state with retry option
- Touch-friendly and keyboard accessible

---

## FEATURE 13: WATCH HISTORY

### 🔄 Complete Flow

#### Backend
1. **Model**: `stream-sphere-backend/models/history.ts` (or history field on `User` model)
   - Stores `userId`, `videoId`, `watchedAt` timestamp
   - Capped or deduplicated to avoid duplicates on re-watch

2. **Service**: `stream-sphere-backend/services/history.service.ts`
   - `addToHistory(userId, videoId)` — Adds/updates watch entry
   - `getHistory(userId)` — Returns user's watch history sorted by `watchedAt` descending

3. **Controller**: `stream-sphere-backend/controllers/history.controller.ts`
   - `addToHistory(req, res)` — Extracts `userId` from JWT, records video watch
   - `getHistory(req, res)` — Returns paginated history for authenticated user

4. **Routes**: `stream-sphere-backend/routes/centralRoute.route.ts`
   - `POST /api/history` — Record a video watch (requires `authenticateJWT`)
   - `GET /api/history` — Fetch watch history (requires `authenticateJWT`)

#### Frontend
1. **Triggering History**: `stream-sphere-client/src/app/components/video-player/video-player.component.ts`
   - Calls `VideoService.addToHistory(videoId)` when video starts playing
   - Only fires if user is authenticated (`currentUserId` is set)

2. **History Page / Profile Section**:
   - Displays recently watched videos using `app-video-card`
   - Loaded via `VideoService.getHistory()` in `ngOnInit()`
   - `historyVideos` — Array of recently watched video objects
   - `showHistorySection` — Boolean to toggle section visibility

3. **Sidebar Navigation**: "History" button in user profile sidebar

### 🔧 Key Variables
| Variable | Purpose |
|---|---|
| `historyVideos` | Array of recently watched videos |
| `showHistorySection` | Boolean to toggle history section |
| `watchedAt` | Timestamp of when video was watched |
| `userId` | Used to isolate history per user |

### 🔒 Security
- JWT authentication required on all history endpoints
- Users can only view their own history

---

## ⚡ Optimizations

### 1. Request Throttling (setTimeout-based Debounce)

To prevent excessive API calls on rapid user interactions (e.g., quickly clicking like/dislike or switching categories), a **3-second `setTimeout`** is used to delay sending requests until the user's action settles.

**How it works:**
- When the user triggers an action, a `setTimeout` is started
- If the same action is triggered again before the timeout fires, the previous timer is cleared and restarted
- The API call only fires once the user stops interacting for 3 seconds

**Where it's used:**
- Category filtering in the video list
- Prevents a new API request on every single click when browsing categories rapidly

```typescript
let debounceTimer: any;

onCategorySelect(category: string) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    this.videoService.getVideosByCategory(category).subscribe(...);
  }, 300); // adjust delay as needed
}
```

> Note: This is a manual `setTimeout`-based approach rather than RxJS `debounceTime`, achieving the same effect without adding operator complexity.

---

### 2. Lazy Loading (Route-Level Code Splitting)

All feature routes are **lazy loaded** in Angular, meaning their JavaScript bundles are only downloaded when the user navigates to that route.

**Benefits:**
- Significantly reduces initial bundle size and load time
- Users only download code for pages they actually visit

**Implementation** (`app.routes.ts`):
```typescript
{
  path: 'upload',
  loadComponent: () =>
    import('./components/upload-video/upload-video.component')
      .then(m => m.UploadVideoComponent)
},
{
  path: 'profile',
  loadComponent: () =>
    import('./components/user-profile/user-profile.component')
      .then(m => m.UserProfileComponent)
},
// ... all routes use loadComponent
```

---

### 3. CloudFront CDN Caching

Video files stored in **AWS S3** are served through **Amazon CloudFront**, Anthropic's global CDN, to improve video load times and reduce latency for users worldwide.

**Benefits:**
- Videos are cached at edge locations closer to the user
- Reduces direct S3 bandwidth costs
- Faster video start times, especially for popular/top-liked videos
- The carousel and hero carousel (Features 11 & 12) benefit most, as they always show the same top 3 videos

**Implementation:**
- S3 bucket is configured as the CloudFront origin
- Video `S3_url` fields in the database are replaced with CloudFront distribution URLs
- Cache-control headers set appropriate TTLs for video content

**Environment Variable:**
```
CLOUDFRONT_DOMAIN=https://xxxx.cloudfront.net
```

---

## 🔧 Technical Architecture

### Frontend
- **Framework**: Angular 17 (Standalone Components)
- **UI Library**: Angular Material
- **State Management**: BehaviorSubject / Observables
- **HTTP Client**: Angular HttpClient
- **Routing**: Angular Router with lazy loading

### Backend
- **Framework**: Node.js with Express
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT with Google OAuth
- **File Storage**: AWS S3
- **CDN**: Amazon CloudFront
- **Language**: TypeScript

### Key Environment Variables

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Secret key for JWT token generation |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `MONGODB_URI` | MongoDB connection string |
| `AWS_REGION` | AWS S3 region |
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `AWS_S3_BUCKET_NAME` | S3 bucket name |
| `CLOUDFRONT_DOMAIN` | CloudFront distribution URL |

### Database Schema

- **User Model**: Stores user information and authentication data
- **Video Model**: Stores video metadata, S3/CloudFront URLs, and reaction data (`likes`, `dislikes`, `likedBy`, `dislikedBy`)
- **History Model**: Stores per-user watch history with timestamps
- **Relationships**: Videos reference users via `user_id`; history references both users and videos
