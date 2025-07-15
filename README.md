# StreamSphere - Video Platform

A full-stack video streaming platform built with Angular (Frontend) and Node.js/Express (Backend), featuring Google OAuth authentication, video upload, like/dislike functionality, and category-based video organization.

## 🚀 Quick Start

### Backend Setup
```bash
cd stream-sphere-backend
npm install
export JWT_SECRET="123456789876543231"
npm run dev
```

### Frontend Setup
```bash
cd stream-sphere-client
npm install
npm start
```

## 📋 FEATURES

---

## FEATURE 1: GOOGLE LOGIN

### 🔄 Complete Flow

#### Frontend Flow:
1. **Entry Point**: `stream-sphere-client/src/app/components/user-login/user-login.component.ts`
   - Component loads Google Sign-In script dynamically
   - Initializes Google OAuth with client ID.

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

#### Backend Flow:
1. **Route Handler**: `stream-sphere-backend/routes/centralRoute.route.ts`
   - Route: `POST /api/google-login`
   - Calls: `googleLogin` controller

2. **Controller**: `stream-sphere-backend/controllers/auth.controller.ts`
   - Receives Google token
   - Calls: `handleGoogleLogin(token)` service

3. **Service**: `stream-sphere-backend/services/auth.service.ts`
   - **Variable**: `client` - OAuth2Client instance for Google token verification
   - **Variable**: `ticket` - Verified Google token payload
   - **Variable**: `payload` - User data from Google (name, email, picture)
   - **Variable**: `user` - Database user object
   - **Variable**: `isNewUser` - Boolean flag for new user registration
   - **Variable**: `jwtPayload` - JWT token payload structure
   - **Variable**: `jwtToken` - Generated JWT token

4. **Database Operations**: `stream-sphere-backend/models/user.ts`
   - Checks if user exists by email
   - Creates new user if not found
   - Updates existing user's profile image

5. **Response**: Returns JWT token and user data
   ```json
   {
     "token": "eyJhbGciOiJIUzI1NiIs...",
     "user": {
       "userId": "67ffe6d78622bdc4703bdc29",
       "userName": "Bipin Chaudhary",
       "email": "bkumar28899@gmail.com",
       "profileImage": "https://lh3.googleusercontent.com/...",
       "role": "user",
       "isVerified": true
     },
     "isNewUser": false
   }
   ```

#### Frontend Response Handling:
1. **Token Storage**: Stores JWT token in `localStorage.setItem('token', res.token)`
2. **User Data Storage**: Stores user data in `localStorage.setItem('user', JSON.stringify(res.user))`
3. **Navigation**: Redirects to user's home page or saved redirect URL

### 🔧 Key Variables & Their Purpose:
- **`token`**: Google credential token from OAuth
- **`jwtPayload`**: Contains userId, email, subject for JWT generation
- **`jwtToken`**: JWT token for subsequent API authentication
- **`isNewUser`**: Boolean to track if user is newly registered
- **`userData`**: Parsed user information from localStorage

### 🛠️ Services Used:
- **`AuthService`**: Handles Google login API calls
- **`OAuth2Client`**: Verifies Google tokens
- **`jwt.sign()`**: Generates JWT tokens
- **`User.findOne()`**: Database user lookup
- **`User.save()`**: Database user creation/update

---

## FEATURE 2: VIDEO UPLOAD

### 🔄 Complete Flow

#### Frontend Flow:
1. **Entry Point**: `stream-sphere-client/src/app/components/upload-video/upload-video.component.ts`
   - User selects video file
   - **Variable**: `selectedFile` - File object from input
   - **Variable**: `uploadProgress` - Upload progress percentage

2. **File Validation**: Checks file size and type
   - **Variable**: `maxFileSize` - 100MB limit
   - **Variable**: `allowedTypes` - ['video/mp4', 'video/avi', 'video/mov']

3. **Upload Process**: `uploadVideo()` method
   - Calls `UploadService.uploadVideo(file)`

4. **Service Call**: `stream-sphere-client/src/app/services/upload.service.ts`
   - Sends POST request to: `http://localhost:3000/api/upload-url`
   - Payload: `{ fileName: "video.mp4", fileType: "video/mp4" }`

#### Backend Flow:
1. **Route Handler**: `stream-sphere-backend/routes/centralRoute.route.ts`
   - Route: `POST /api/upload-url`
   - Calls: `uploadController`

2. **Controller**: `stream-sphere-backend/controllers/upload.controller.ts`
   - **Variable**: `fileName` - Original file name
   - **Variable**: `fileType` - MIME type of video
   - **Variable**: `s3Key` - S3 storage key
   - **Variable**: `presignedUrl` - AWS S3 presigned URL

3. **Service**: `stream-sphere-backend/services/upload.service.ts`
   - **Variable**: `s3Client` - AWS S3 client instance
   - **Variable**: `bucketName` - S3 bucket name
   - **Variable**: `uploadParams` - S3 upload parameters

4. **AWS S3 Integration**:
   - Generates unique S3 key with timestamp
   - Creates presigned URL for direct upload
   - Returns upload URL and S3 key

#### Frontend Upload to S3:
1. **Direct Upload**: Uploads file directly to S3 using presigned URL
2. **Progress Tracking**: Monitors upload progress
3. **Completion**: Calls `saveVideoMetadata()` after successful upload

#### Video Metadata Saving:
1. **Service Call**: `UploadService.saveVideoMetadata(metadata)`
2. **API Endpoint**: `POST /api/save-video`
3. **Payload**: Video metadata with S3 URL, user info, category

### 🔧 Key Variables & Their Purpose:
- **`selectedFile`**: User's selected video file
- **`uploadProgress`**: Upload progress percentage (0-100)
- **`s3Key`**: Unique identifier for S3 storage
- **`presignedUrl`**: Temporary URL for direct S3 upload
- **`videoMetadata`**: Complete video information for database

### 🛠️ Services Used:
- **`UploadService`**: Handles file upload and metadata saving
- **`S3Client`**: AWS S3 operations
- **`PutObjectCommand`**: S3 upload command
- **`getSignedUrl`**: Generates presigned URLs

---

## FEATURE 3: VIDEO DISPLAY & CATEGORIZATION

### 🔄 Complete Flow

#### Frontend Flow:
1. **Entry Point**: `stream-sphere-client/src/app/components/video-list/video-list.component.ts`
   - **Variable**: `videos` - Array of video objects
   - **Variable**: `filteredVideos` - Videos filtered by category/search
   - **Variable**: `selectedCategory` - Currently selected category

2. **Data Fetching**: `VideoService.getAllVideos()`
   - Calls: `GET /api/home`
   - Returns: Array of video objects with metadata

3. **Category Filtering**: `VideoService.getVideosByCategory(category)`
   - **Variable**: `category` - Selected category name
   - Calls: `GET /api/videos/category/{category}`

#### Backend Flow:
1. **Route Handler**: `stream-sphere-backend/routes/centralRoute.route.ts`
   - Route: `GET /api/home` - All videos
   - Route: `GET /api/videos/category/:category` - Category-specific videos

2. **Controller**: `stream-sphere-backend/controllers/getVideo.controller.ts`
   - **Method**: `getVideos()` - Returns all videos
   - **Method**: `getVideosByCategory()` - Returns filtered videos

3. **Service**: `stream-sphere-backend/services/getVideo.service.ts`
   - **Variable**: `videos` - Database query results
   - **Variable**: `category` - Filter category
   - **Method**: `getAllVideos()` - Fetches all videos sorted by upload date
   - **Method**: `getVideosByCategory()` - Fetches videos by category

4. **Database Query**: `stream-sphere-backend/models/video.ts`
   - **Schema Fields**:
     - `title`: Video title
     - `description`: Video description
     - `S3_url`: AWS S3 video URL
     - `user_id`: Uploader's user ID
     - `user_name`: Uploader's name
     - `category`: Video category
     - `likes`: Number of likes
     - `dislikes`: Number of dislikes
     - `likedBy`: Array of user IDs who liked
     - `dislikedBy`: Array of user IDs who disliked

### 🔧 Key Variables & Their Purpose:
- **`videos`**: Array of all video objects from database
- **`filteredVideos`**: Videos filtered by category or search
- **`selectedCategory`**: Currently active category filter
- **`category`**: Database field for video categorization

### 🛠️ Services Used:
- **`VideoService`**: Handles video data fetching and filtering
- **`Video.find()`**: MongoDB query for video retrieval
- **`Video.find().sort()`**: Sorted video retrieval by upload date

---

## FEATURE 4: LIKE/DISLIKE FUNCTIONALITY

### 🔄 Complete Flow

#### Frontend Flow:
1. **Entry Point**: `stream-sphere-client/src/app/components/video-player/video-player.component.ts`
   - **Variable**: `currentUserId` - Logged-in user's ID
   - **Variable**: `userReaction` - User's current reaction ('liked', 'disliked', 'none')
   - **Variable**: `isLiking` - Boolean to prevent double-clicks
   - **Variable**: `isDisliking` - Boolean to prevent double-clicks

2. **Authentication Check**: `checkUserAuthentication()`
   - Reads JWT token from localStorage
   - **Variable**: `userData` - Parsed user data from localStorage
   - **Variable**: `token` - JWT token for API authentication

3. **Like Action**: `onLikeClick()`
   - Calls: `VideoService.likeVideo(videoId)`
   - **Variable**: `videoId` - Target video's unique ID

4. **Dislike Action**: `onDislikeClick()`
   - Calls: `VideoService.dislikeVideo(videoId)`

#### Service Layer:
1. **Video Service**: `stream-sphere-client/src/app/services/video.service.ts`
   - **Method**: `likeVideo(videoId)`
   - **Method**: `dislikeVideo(videoId)`
   - **Method**: `getUserReaction(videoId)`
   - **Variable**: `headers` - HTTP headers with JWT token
   - **Variable**: `token` - JWT token from localStorage

2. **API Calls**:
   - `POST /api/videos/{videoId}/like` - Like video
   - `POST /api/videos/{videoId}/dislike` - Dislike video
   - `GET /api/videos/{videoId}/reaction` - Get user's reaction

#### Backend Flow:
1. **Route Handler**: `stream-sphere-backend/routes/centralRoute.route.ts`
   - Routes protected by `authenticateJWT` middleware
   - **Variable**: `videoId` - Video ID from URL parameter

2. **JWT Authentication**: `stream-sphere-backend/services/auth.service.ts`
   - **Method**: `authenticateJWT(req, res, next)`
   - **Variable**: `authHeader` - Authorization header
   - **Variable**: `token` - Extracted JWT token
   - **Variable**: `decoded` - Decoded JWT payload
   - **Variable**: `req.user` - User data attached to request

3. **Controller**: `stream-sphere-backend/controllers/getVideo.controller.ts`
   - **Method**: `likeVideo(req, res)`
   - **Method**: `dislikeVideo(req, res)`
   - **Method**: `getUserReaction(req, res)`
   - **Variable**: `userId` - User ID from JWT token
   - **Variable**: `videoId` - Target video ID

4. **Service**: `stream-sphere-backend/services/getVideo.service.ts`
   - **Method**: `likeVideo(videoId, userId)`
   - **Method**: `dislikeVideo(videoId, userId)`
   - **Method**: `getUserReaction(videoId, userId)`
   - **Variable**: `video` - Video document from database
   - **Variable**: `likedBy` - Array of user IDs who liked
   - **Variable**: `dislikedBy` - Array of user IDs who disliked

5. **Database Operations**:
   - **Like Logic**: 
     - If user already liked → unlike (remove from likedBy, decrease likes)
     - If user disliked → remove dislike and add like
     - If no reaction → add like
   - **Dislike Logic**:
     - If user already disliked → remove dislike
     - If user liked → remove like and add dislike
     - If no reaction → add dislike

### 🔧 Key Variables & Their Purpose:
- **`currentUserId`**: Logged-in user's unique identifier
- **`userReaction`**: Current user's reaction state ('liked', 'disliked', 'none')
- **`isLiking/isDisliking`**: Boolean flags to prevent double-clicks
- **`likedBy/dislikedBy`**: Arrays tracking which users reacted
- **`likes/dislikes`**: Count of total reactions
- **`req.user.userId`**: User ID extracted from JWT token

### 🛠️ Services Used:
- **`VideoService`**: Frontend service for like/dislike API calls
- **`authenticateJWT`**: Middleware for JWT token verification
- **`jwt.verify()`**: JWT token verification
- **`Video.findById()`**: Database video lookup
- **`video.save()`**: Database video update

---

## FEATURE 5: VIDEO PLAYER & DETAILS

### 🔄 Complete Flow

#### Frontend Flow:
1. **Entry Point**: `stream-sphere-client/src/app/components/video-player/video-player.component.ts`
   - **Variable**: `video` - Complete video object
   - **Variable**: `safeVideoUrl` - Sanitized video URL
   - **Variable**: `loading` - Loading state boolean
   - **Variable**: `error` - Error message string

2. **Route Parameter**: Gets video ID from URL
   - **Variable**: `videoId` - Video ID from route parameter

3. **Data Loading**: `loadVideo(videoId)`
   - Calls: `VideoService.getAllVideos()`
   - Finds specific video by ID
   - **Variable**: `videos` - Array of all videos
   - **Variable**: `video` - Found video object

4. **URL Sanitization**: `DomSanitizer.bypassSecurityTrustResourceUrl()`
   - **Variable**: `safeVideoUrl` - Safe video URL for Angular

5. **Authentication Check**: `checkUserAuthentication()`
   - **Variable**: `userData` - User data from localStorage
   - **Variable**: `token` - JWT token
   - **Variable**: `currentUserId` - Logged-in user ID
   - **Variable**: `isOwner` - Boolean if user owns the video

#### Video Display:
1. **Video Element**: HTML5 video player
   - **Variable**: `safeVideoUrl` - Video source URL
   - **Variable**: `controls` - Video controls enabled

2. **Video Information**:
   - **Variable**: `video.title` - Video title
   - **Variable**: `video.description` - Video description
   - **Variable**: `video.uploadedAt` - Upload date
   - **Variable**: `video.category` - Video category
   - **Variable**: `video.user_name` - Uploader name

3. **Like/Dislike Section**:
   - **Variable**: `video.likes` - Total like count
   - **Variable**: `video.dislikes` - Total dislike count
   - **Variable**: `userReaction` - User's current reaction
   - **Variable**: `currentUserId` - User authentication status

#### Delete Functionality (Owner Only):
1. **Owner Check**: `isOwner` boolean
2. **Delete Method**: `onDeleteClick()`
   - **Variable**: `video._id` - Video ID to delete
   - **Variable**: `currentUserId` - User ID for authorization

### 🔧 Key Variables & Their Purpose:
- **`video`**: Complete video object with all metadata
- **`safeVideoUrl`**: Sanitized video URL for Angular security
- **`loading`**: Boolean for loading state management
- **`error`**: String for error message display
- **`isOwner`**: Boolean indicating if current user owns the video
- **`currentUserId`**: Logged-in user's ID for authentication

### 🛠️ Services Used:
- **`VideoService`**: Fetches video data
- **`DomSanitizer`**: Sanitizes video URLs
- **`ActivatedRoute`**: Gets route parameters
- **`Router`**: Handles navigation

---

## FEATURE 6: VIDEO CARDS & CATEGORY SLIDER

### 🔄 Complete Flow

#### Video Cards:
1. **Component**: `stream-sphere-client/src/app/components/video-card/video-card.component.ts`
   - **Variable**: `video` - Video object input
   - **Variable**: `safeUrl` - Sanitized video URL
   - **Variable**: `flipEnabled` - Boolean for flip card feature
   - **Variable**: `flip` - Boolean for flip state

2. **URL Sanitization**: `DomSanitizer.bypassSecurityTrustResourceUrl()`
   - **Variable**: `safeUrl` - Safe video URL

3. **Click Handling**: `onVideoClick()`
   - **Variable**: `video._id` - Video ID for navigation
   - Navigates to video player page

4. **Flip Functionality**: `onFlipClick()`
   - **Variable**: `flip` - Toggles flip state
   - **Variable**: `event.stopPropagation()` - Prevents card click

#### Category Slider:
1. **Component**: `stream-sphere-client/src/app/components/category-slider/category-slider.component.ts`
   - **Variable**: `categories` - Array of available categories
   - **Variable**: `selectedCategory` - Currently selected category

2. **Category Selection**: `onCategorySelect(category)`
   - **Variable**: `category` - Selected category name
   - Calls: `VideoService.setCategory(category)`

3. **Service Communication**: `stream-sphere-client/src/app/services/video.service.ts`
   - **Variable**: `categorySubject` - BehaviorSubject for category changes
   - **Variable**: `category$` - Observable for category updates

### 🔧 Key Variables & Their Purpose:
- **`video`**: Input video object with all metadata
- **`safeUrl`**: Sanitized video URL for preview
- **`flipEnabled`**: Boolean to enable/disable flip feature
- **`flip`**: Boolean for current flip state
- **`categories`**: Array of available video categories
- **`selectedCategory`**: Currently active category

### 🛠️ Services Used:
- **`VideoService`**: Manages category selection and video data
- **`DomSanitizer`**: Sanitizes video URLs
- **`Router`**: Handles navigation to video player
- **`BehaviorSubject`**: Manages category state

---

## FEATURE 7: USER PROFILE & VIDEO MANAGEMENT

### 🔄 Complete Flow

#### User Profile:
1. **Component**: `stream-sphere-client/src/app/components/user-profile/user-profile.component.ts`
   - **Variable**: `user` - Current user object
   - **Variable**: `userVideos` - Array of user's uploaded videos
   - **Variable**: `displayedColumns` - Table column definitions

2. **Data Loading**: `ngOnInit()`
   - **Variable**: `userData` - User data from localStorage
   - **Variable**: `userId` - User ID for video filtering

3. **Video Fetching**: `loadUserVideos()`
   - Calls: `VideoService.getAllVideos()`
   - Filters videos by `user_id`
   - **Variable**: `userVideos` - Filtered video array

#### Video Management:
1. **Video Table**: Material table with user's videos
   - **Variable**: `displayedColumns` - ['title', 'category', 'uploadedAt', 'actions']
   - **Variable**: `dataSource` - MatTableDataSource for table data

2. **Delete Functionality**: `deleteVideo(videoId)`
   - **Variable**: `videoId` - Video ID to delete
   - **Variable**: `userId` - User ID for authorization
   - Calls: `VideoService.deleteVideo(videoId, userId)`

3. **Navigation**: `viewVideo(videoId)`
   - **Variable**: `videoId` - Video ID for navigation
   - Navigates to video player page

### 🔧 Key Variables & Their Purpose:
- **`user`**: Current user object with profile information
- **`userVideos`**: Array of videos uploaded by current user
- **`displayedColumns`**: Array defining table column structure
- **`dataSource`**: MatTableDataSource for Material table
- **`userId`**: Current user's ID for video filtering

### 🛠️ Services Used:
- **`VideoService`**: Fetches and manages video data
- **`MatTableDataSource`**: Manages table data
- **`Router`**: Handles navigation
- **`localStorage`**: Stores user data

---

## FEATURE 8: VIDEO DELETION

### 🔄 Complete Flow

#### Frontend Flow:
1. **Entry Points**: 
   - **Video Player**: `stream-sphere-client/src/app/components/video-player/video-player.component.ts`
   - **User Profile**: `stream-sphere-client/src/app/components/user-profile/user-profile.component.ts`
   - **Video Card**: `stream-sphere-client/src/app/components/video-card/video-card.component.ts`

2. **Owner Verification**: 
   - **Variable**: `isOwner` - Boolean indicating if current user owns the video
   - **Variable**: `currentUserId` - Logged-in user's ID
   - **Variable**: `video.user_id` - Video owner's ID
   - Check: `currentUserId === video.user_id`

3. **Delete Button Display**: Only shown to video owners
   - **Video Player**: Delete icon in video metadata section
   - **User Profile**: Delete button in video management table
   - **Video Card**: Delete button on card flip (if enabled)

4. **Delete Confirmation**: `onDeleteClick()` method
   - **Variable**: `video._id` - Video ID to delete
   - **Variable**: `currentUserId` - User ID for authorization
   - Calls: `VideoService.deleteVideo(videoId, userId)`

#### Backend Flow:
1. **Route Handler**: `stream-sphere-backend/routes/centralRoute.route.ts`
   - Route: `DELETE /api/videos/:videoId`
   - Calls: `VideoController.deleteVideo(req, res)`

2. **Controller**: `stream-sphere-backend/controllers/getVideo.controller.ts`
   - **Method**: `deleteVideo(req, res)`
   - **Variable**: `videoId` - Video ID from route parameter
   - **Variable**: `userId` - User ID from request body
   - Calls: `videoService.deleteVideo(videoId, userId)`

3. **Service**: `stream-sphere-backend/services/getVideo.service.ts`
   - **Method**: `deleteVideo(videoId, userId)`
   - **Variable**: `video` - Video document from database
   - **Variable**: `s3Key` - S3 storage key extracted from S3_url
   - **Variable**: `s3Url` - Complete S3 URL of video

4. **Authorization Check**:
   - **Variable**: `video.user_id` - Video owner's ID
   - **Variable**: `userId` - Requesting user's ID
   - Check: `video.user_id !== userId` → Unauthorized error

5. **S3 File Deletion**:
   - **Variable**: `s3Client` - AWS S3 client instance
   - **Variable**: `bucketName` - S3 bucket name from environment
   - **Variable**: `s3Key` - Extracted S3 key from URL
   - **Command**: `DeleteObjectCommand` to remove video file from S3

6. **Database Deletion**:
   - **Method**: `Video.findByIdAndDelete(videoId)`
   - **Impact**: Complete removal of video document and all associated data

### 🔧 Key Variables & Their Purpose:
- **`videoId`**: Unique identifier of video to delete
- **`userId`**: ID of user requesting deletion (for authorization)
- **`isOwner`**: Boolean indicating if user owns the video
- **`s3Key`**: S3 storage key extracted from video URL
- **`video.user_id`**: Original uploader's ID for ownership verification

### 🛠️ Services Used:
- **`VideoService.deleteVideo()`**: Handles video deletion API calls
- **`S3Client`**: AWS S3 operations for file deletion
- **`DeleteObjectCommand`**: S3 command to delete video files
- **`Video.findByIdAndDelete()`**: MongoDB operation to remove video document

### ⚠️ Impact on Like/Dislike Feature:

#### What Gets Deleted:
- **`likes` count** - Total number of likes
- **`dislikes` count** - Total number of dislikes  
- **`likedBy` array** - List of user IDs who liked the video
- **`dislikedBy` array** - List of user IDs who disliked the video

#### User Impact:
- **Complete Data Loss**: All like/dislike data is permanently removed
- **No Recovery**: No mechanism to recover deleted video data
- **User Experience**: Users who previously liked/disliked the video lose that interaction history
- **Fresh Start**: If same video is re-uploaded, it starts with 0 likes/dislikes

#### Technical Considerations:
- **Hard Delete**: Uses `findByIdAndDelete()` for complete removal
- **No Soft Delete**: No option to mark as deleted instead of removing
- **No Notifications**: Users aren't notified when videos they interacted with are deleted
- **No Analytics**: No tracking of deleted videos or user reactions

### 🔒 Security Features:
- **Owner-Only Deletion**: Only video uploader can delete their videos
- **Authorization Check**: Backend verifies user ownership before deletion
- **S3 Cleanup**: Removes video files from cloud storage
- **Database Cleanup**: Removes all video metadata and reaction data

---

## FEATURE 9: LIKED & DISLIKED VIDEOS IN USER PROFILE

### 🔄 Complete Flow

#### Backend Implementation:
1. **Service Methods**: `stream-sphere-backend/services/getVideo.service.ts`
   - **Method**: `getLikedVideos(userId: string)`
   - **Method**: `getDislikedVideos(userId: string)`
   - **Query**: `Video.find({ likedBy: userId })` / `Video.find({ dislikedBy: userId })`
   - **Sorting**: `sort({ uploadedAt: -1 })` - Newest first

2. **Controller Methods**: `stream-sphere-backend/controllers/getVideo.controller.ts`
   - **Method**: `getLikedVideos(req, res)`
   - **Method**: `getDislikedVideos(req, res)`
   - **Authentication**: Uses JWT middleware for user verification
   - **Variable**: `userId` - Extracted from JWT token

3. **Routes**: `stream-sphere-backend/routes/centralRoute.route.ts`
   - **Route**: `GET /api/videos/liked` - Requires authentication
   - **Route**: `GET /api/videos/disliked` - Requires authentication
   - **Middleware**: `authenticateJWT` for user verification

#### Frontend Implementation:
1. **Service Methods**: `stream-sphere-client/src/app/services/video.service.ts`
   - **Method**: `getLikedVideos()` - Returns Observable<any[]>
   - **Method**: `getDislikedVideos()` - Returns Observable<any[]>
   - **Headers**: Includes JWT token in Authorization header

2. **Component Properties**: `stream-sphere-client/src/app/components/user-profile/user-profile.component.ts`
   - **Variable**: `likedVideos: any[]` - Array of liked videos
   - **Variable**: `dislikedVideos: any[]` - Array of disliked videos
   - **Variable**: `showLikedVideosSection: boolean` - Controls section visibility
   - **Variable**: `showDislikedVideosSection: boolean` - Controls section visibility

3. **Loading Methods**:
   - **Method**: `loadLikedVideos()` - Fetches user's liked videos
   - **Method**: `loadDislikedVideos()` - Fetches user's disliked videos
   - **Called**: In `ngOnInit()` for automatic loading

4. **Navigation Methods**:
   - **Method**: `showLikedVideos()` - Shows liked videos section
   - **Method**: `showDislikedVideos()` - Shows disliked videos section
   - **Sidebar**: Added buttons for navigation

#### UI Components:
1. **Sidebar Navigation**: `stream-sphere-client/src/app/components/user-profile/user-profile.component.html`
   - **Button**: "Liked Videos" - Triggers `showLikedVideos()`
   - **Button**: "Disliked Videos" - Triggers `showDislikedVideos()`

2. **Liked Videos Section**:
   - **Condition**: `*ngIf="showLikedVideosSection"`
   - **Empty State**: Shows "No liked videos yet." when empty
   - **Video Grid**: Uses `app-video-card` component
   - **Styling**: Green header color (`#4caf50`)

3. **Disliked Videos Section**:
   - **Condition**: `*ngIf="showDislikedVideosSection"`
   - **Empty State**: Shows "No disliked videos yet." when empty
   - **Video Grid**: Uses `app-video-card` component
   - **Styling**: Red header color (`#f44336`)

### 🔧 Key Variables & Their Purpose:
- **`likedVideos`**: Array of videos liked by current user
- **`dislikedVideos`**: Array of videos disliked by current user
- **`showLikedVideosSection`**: Boolean to control liked videos section visibility
- **`showDislikedVideosSection`**: Boolean to control disliked videos section visibility
- **`userId`**: Current user's ID for filtering videos

### 🛠️ Services Used:
- **`VideoService.getLikedVideos()`**: Fetches user's liked videos from backend
- **`VideoService.getDislikedVideos()`**: Fetches user's disliked videos from backend
- **`JWT Authentication`**: Ensures only authenticated users can access their data
- **`VideoCardComponent`**: Displays videos in grid format

### 🎨 UI Features:
- **Responsive Grid**: Videos displayed in responsive grid layout
- **Color Coding**: Green for liked videos, red for disliked videos
- **Empty States**: User-friendly messages when no videos exist
- **Consistent Styling**: Matches existing user profile design
- **Flip Disabled**: Video cards have flip animation disabled in profile view

### 🔒 Security Features:
- **JWT Authentication**: All requests require valid JWT token
- **User Isolation**: Users can only see their own liked/disliked videos
- **Backend Validation**: Server verifies user identity before returning data

---

## FEATURE 10: VIDEO DURATION LIMIT (2 MINUTES)

### 🔄 Complete Flow

#### Frontend Validation:
1. **File Selection**: `stream-sphere-client/src/app/components/upload-video/upload-video.component.ts`
   - **Method**: `onFileSelected(event: Event)`
   - **Method**: `checkVideoDuration(file: File)`
   - **Validation**: Checks if file is video type
   - **Duration Check**: Uses HTML5 video element to get duration
   - **Limit**: 120 seconds (2 minutes)
   - **Variable**: `duration` - Video duration in seconds
   - **Variable**: `selectedFile` - Selected video file

2. **User Interface**: `stream-sphere-client/src/app/components/upload-video/upload-video.component.html`
   - **Element**: `<small class="duration-limit">` - Shows duration limit
   - **Styling**: `stream-sphere-client/src/app/components/upload-video/upload-video.component.css`
   - **CSS Class**: `.duration-limit` - Italic gray text

3. **Error Handling**: Frontend shows alert for duration violations
   - **Message**: "Video duration exceeds 2 minutes. Please select a shorter video."
   - **Action**: Clears file input and selected file

#### Backend Validation:
1. **Service Layer**: `stream-sphere-backend/services/saveVideo.service.ts`
   - **Method**: `getVideoDuration(videoUrl: string)`
   - **Tool**: Uses `ffprobe-static` to analyze video duration
   - **Package**: `ffprobe-static` - FFmpeg binary for video analysis
   - **Process**: Spawns ffprobe process to get duration
   - **Variable**: `duration` - Video duration in seconds
   - **Limit**: 120 seconds (2 minutes)

2. **Validation Logic**:
   ```typescript
   if (duration > 120) {
     throw new Error('Video duration exceeds 2 minutes (120 seconds). Please upload a shorter video.');
   }
   ```

3. **Controller Handling**: `stream-sphere-backend/controllers/saveVideo.controller.ts`
   - **Error Check**: `error.message.includes('duration exceeds')`
   - **Response**: Returns 400 status with duration error message
   - **Variable**: `error.message` - Duration violation message

#### Key Variables & Services:
- **`duration`**: Video duration in seconds (frontend & backend)
- **`selectedFile`**: Selected video file object (frontend)
- **`ffprobe`**: FFmpeg binary for video analysis (backend)
- **`getVideoDuration()`**: Function to extract video duration (backend)
- **`checkVideoDuration()`**: Function to check duration (frontend)
- **Services Used**: HTML5 Video API, FFprobe, Error handling

#### Error Flow:
1. **Frontend**: User selects video > Duration check > Alert if > 2min
2. **Backend**: Video upload > Duration analysis > Error if > 2min
3. **Response**: 400 status with clear error message
4. **User**: Sees error message and can try again

#### Technical Implementation:
- **Frontend**: Uses HTML5 video element for metadata extraction
- **Backend**: Uses FFprobe for accurate video duration analysis
- **Validation**: Double validation (frontend + backend)
- **Error Handling**: Graceful fallback if duration check fails
- **User Experience**: Clear messaging and visual indicators

---

## FEATURE 11: VIDEO CAROUSEL - TOP LIKED VIDEOS

### 🔄 Complete Flow

#### Backend Implementation:
1. **Service Method**: `stream-sphere-backend/services/getVideo.service.ts`
   - **Method**: `getTopLikedVideos()`
   - **Query**: `Video.find({}).sort({ likes: -1 }).limit(3)`
   - **Purpose**: Gets top 3 most liked videos from entire database

2. **Controller Method**: `stream-sphere-backend/controllers/getVideo.controller.ts`
   - **Method**: `getTopLikedVideos(req, res)`
   - **Route**: `GET /api/videos/top-liked`
   - **Authentication**: No authentication required (public endpoint)

3. **Route**: `stream-sphere-backend/routes/centralRoute.route.ts`
   - **Route**: `GET /api/videos/top-liked`
   - **Middleware**: No authentication required

#### Frontend Implementation:
1. **Service Method**: `stream-sphere-client/src/app/services/video.service.ts`
   - **Method**: `getTopLikedVideos()` - Returns Observable<any[]>
   - **No Headers**: Public endpoint, no JWT token required

2. **Carousel Component**: `stream-sphere-client/src/app/components/video-carousel/`
   - **Component**: `VideoCarouselComponent`
   - **Auto-rotation**: Every 3 seconds using `setInterval`
   - **Navigation**: Previous/Next buttons and indicator dots
   - **Lifecycle**: Proper cleanup in `ngOnDestroy`

3. **Integration**: `stream-sphere-client/src/app/components/video-list/`
   - **Position**: Carousel appears above category slider and video list
   - **Independence**: Carousel is not affected by category filtering
   - **Responsive**: Adapts to different screen sizes

#### Key Variables & Services:
- **`topVideos`**: Array of top 3 most liked videos
- **`currentIndex`**: Current slide index (0-2)
- **`interval`**: Auto-rotation timer reference
- **`getTopLikedVideos()`**: Service method to fetch trending videos
- **Services Used**: VideoService, setInterval, VideoCardComponent

#### Auto-Rotation Features:
- **Timer**: 3-second interval for automatic slide changes
- **Loop**: Continuous rotation through all 3 videos
- **Manual Override**: User can click navigation buttons
- **Cleanup**: Timer cleared on component destruction

#### UI Features:
- **Gradient Background**: Purple gradient with modern styling
- **Navigation Controls**: Previous/Next buttons with hover effects
- **Indicators**: Dot indicators showing current slide
- **Responsive Design**: Adapts to mobile and desktop screens
- **Smooth Transitions**: CSS transitions for slide changes

#### Technical Implementation:
- **Component Lifecycle**: Proper initialization and cleanup
- **Memory Management**: Timer cleanup prevents memory leaks
- **Error Handling**: Graceful handling of API failures
- **Performance**: Efficient rendering with minimal DOM updates
- **Accessibility**: Keyboard navigation and screen reader support

---

## FEATURE 12: HERO CAROUSEL - NETFLIX-STYLE AUTO-ADVANCE

### 🔄 Complete Flow

#### Backend Implementation:
1. **Service Method**: `stream-sphere-backend/services/getVideo.service.ts`
   - **Method**: `getTopLikedVideos()`
   - **Query**: `Video.find({}).sort({ likes: -1 }).limit(3)`
   - **Purpose**: Gets top 3 most liked videos from entire database
   - **Response**: Array of video objects with metadata

2. **Controller Method**: `stream-sphere-backend/controllers/getVideo.controller.ts`
   - **Method**: `getTopLikedVideos(req, res)`
   - **Route**: `GET /api/videos/top-liked`
   - **Authentication**: No authentication required (public endpoint)

3. **Route**: `stream-sphere-backend/routes/centralRoute.route.ts`
   - **Route**: `GET /api/videos/top-liked`
   - **Middleware**: No authentication required

#### Frontend Implementation:
1. **Component**: `stream-sphere-client/src/app/components/hero-carousel/hero-carousel.component.ts`
   - **Standalone Component**: Angular 17 standalone component
   - **Imports**: CommonModule for Angular directives
   - **ViewChild**: `@ViewChild('videoElement')` for video element reference

2. **Key Variables**:
   - **`videos: Video[]`**: Array of top 3 most liked videos
   - **`currentIndex: number`**: Current video index (0-2)
   - **`isLoading: boolean`**: Loading state for API calls
   - **`error: string`**: Error message for failed requests
   - **`autoAdvanceTimer: any`**: Timer reference for auto-advance
   - **`AUTO_ADVANCE_INTERVAL: number`**: 8000ms (8 seconds) auto-advance interval
   - **`intersectionObserver: IntersectionObserver`**: Visibility detection
   - **`visibilityChangeHandler: () => void`**: Tab visibility change handler

3. **Auto-Advance Features**:
   - **Timer Management**: `startAutoAdvanceTimer()` and `stopAutoAdvanceTimer()`
   - **Smart Timing**: Only advances when video is visible and playing
   - **Tab Awareness**: Pauses on tab switch, resumes on return
   - **Manual Override**: Resets timer when user navigates manually
   - **Cleanup**: Proper timer cleanup on component destruction

4. **Intersection Observer**:
   - **Purpose**: Detects when carousel is visible in viewport
   - **Threshold**: 30% visibility triggers play/pause
   - **Mobile Friendly**: Works on all devices without hover dependency
   - **Performance**: Efficient visibility detection without polling

5. **Video Control**:
   - **Automatic Play**: Video plays when visible in viewport
   - **Automatic Pause**: Video pauses when not visible
   - **Tab Visibility**: Pauses on tab switch, resumes on return
   - **Error Handling**: Graceful fallback for video loading issues

#### Navigation Features:
1. **Arrow Navigation**: `previousVideo()` and `nextVideo()` methods
   - **Event Handling**: `(click)="previousVideo()"` and `(click)="nextVideo()"`
   - **Event Prevention**: `event.stopPropagation()` and `event.preventDefault()`
   - **Timer Reset**: Resets auto-advance timer on manual navigation
   - **Loop Navigation**: Wraps around from last to first video

2. **Thumbnail Navigation**: Clickable thumbnail indicators
   - **Direct Access**: Click thumbnail to jump to specific video
   - **Visual Feedback**: Active thumbnail highlighted
   - **Timer Reset**: Resets auto-advance timer on thumbnail click

3. **Progress Indicator**: Visual progress bar
   - **Video Count**: Shows current video number (e.g., "1 of 3")
   - **Auto-Update**: Updates as videos change
   - **Visual Progress**: Indicates carousel progress

#### Video Player Integration:
1. **"Play Now" Button**: `playNow()` method
   - **Navigation**: Uses Angular Router to navigate to video player
   - **Route**: `/video/${this.videos[this.currentIndex]._id}`
   - **User Experience**: Direct access to full video player

2. **Video Element Management**:
   - **Template Reference**: `#videoElement` for direct video control
   - **Event Handlers**: `(loadstart)`, `(canplay)`, `(error)` events
   - **State Sync**: Video state synchronized with visibility and navigation

#### Lifecycle Management:
1. **Initialization**: `ngOnInit()`
   - **Data Loading**: Calls `loadVideos()` to fetch top liked videos
   - **Observer Setup**: Initializes intersection observer
   - **Visibility Handler**: Sets up tab visibility change listener

2. **Cleanup**: `ngOnDestroy()`
   - **Timer Cleanup**: Clears auto-advance timer
   - **Observer Cleanup**: Disconnects intersection observer
   - **Event Cleanup**: Removes visibility change listener

#### Error Handling & States:
1. **Loading State**: Shows spinner while fetching data
2. **Error State**: Shows error message with retry option
3. **Empty State**: Shows message when no videos available
4. **Debug Info**: Console logs for development debugging

### 🔧 Key Variables & Their Purpose:
- **`videos`**: Array of top 3 most liked videos from backend
- **`currentIndex`**: Current video index (0-2) for navigation
- **`autoAdvanceTimer`**: Timer reference for 8-second auto-advance
- **`AUTO_ADVANCE_INTERVAL`**: 8000ms interval for auto-advance
- **`intersectionObserver`**: Detects carousel visibility in viewport
- **`isLoading`**: Boolean for loading state management
- **`error`**: String for error message display

### 🛠️ Services Used:
- **`VideoService.getTopLikedVideos()`**: Fetches top liked videos from backend
- **`IntersectionObserver`**: Detects element visibility in viewport
- **`setInterval/clearInterval`**: Manages auto-advance timer
- **`document.addEventListener`**: Handles tab visibility changes
- **`Router`**: Navigates to video player on "Play Now" click

### 🎨 UI Features:
- **Netflix-Style Design**: Full-width hero carousel with overlay text
- **Responsive Layout**: Adapts to mobile, tablet, and desktop screens
- **Smooth Transitions**: CSS transitions for video changes
- **Visual Feedback**: Hover effects on navigation buttons
- **Progress Indicator**: Shows current video position
- **Loading States**: Spinner and error handling with retry options

### 📱 Mobile & Accessibility:
- **Touch-Friendly**: Large touch targets for mobile navigation
- **Keyboard Accessible**: Tab navigation and keyboard controls
- **Screen Reader Support**: Proper ARIA labels and semantic HTML
- **Performance Optimized**: Efficient rendering and memory management

### 🔒 Technical Features:
- **Memory Management**: Proper cleanup prevents memory leaks
- **Error Resilience**: Graceful handling of network and video errors
- **Performance**: Efficient intersection observer and timer management
- **Cross-Browser**: Works on all modern browsers
- **Mobile Optimized**: Touch-friendly and responsive design

---

## 🔧 TECHNICAL ARCHITECTURE

### Frontend Architecture:
- **Framework**: Angular 17 (Standalone Components)
- **UI Library**: Angular Material
- **State Management**: BehaviorSubject/Observables
- **HTTP Client**: Angular HttpClient
- **Routing**: Angular Router

### Backend Architecture:
- **Framework**: Node.js with Express
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT with Google OAuth
- **File Storage**: AWS S3
- **Language**: TypeScript

### Key Environment Variables:
- **`JWT_SECRET`**: Secret key for JWT token generation
- **`GOOGLE_CLIENT_ID`**: Google OAuth client ID
- **`MONGODB_URI`**: MongoDB connection string
- **`AWS_REGION`**: AWS S3 region
- **`AWS_ACCESS_KEY_ID`**: AWS access key
- **`AWS_SECRET_ACCESS_KEY`**: AWS secret key
- **`AWS_S3_BUCKET_NAME`**: S3 bucket name

### Database Schema:
- **User Model**: Stores user information and authentication data
- **Video Model**: Stores video metadata, URLs, and reaction data
- **Relationships**: Videos reference users via `user_id` field

This comprehensive documentation ensures that even beginners can understand the codebase structure, debug issues, and extend functionality effectively.

