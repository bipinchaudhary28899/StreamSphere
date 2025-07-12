# Netflix-Style Hero Carousel Component

## Overview
The `HeroCarouselComponent` is a Netflix-style hero carousel that displays the top 3 most liked videos from your StreamSphere app. It features auto-play functionality, smooth transitions, and a responsive design that works across all devices.

## Features

### 🎬 Auto-Play
- Automatically cycles through videos every 5 seconds
- Pauses on mouse hover for better user experience
- Smooth fade transitions between videos

### 🎮 Interactive Controls
- Left/right navigation arrows (appear on hover)
- Clickable thumbnail indicators
- Progress bar showing current position
- Play button for video interaction

### 📱 Responsive Design
- Full-width hero section (70vh height on desktop)
- Responsive typography and spacing
- Mobile-optimized controls and layout
- Adaptive thumbnail indicators

### 🎨 Visual Design
- Netflix-style gradient overlays
- Category-based thumbnail placeholders
- Smooth hover animations
- Professional typography with text shadows

## Usage

### Basic Implementation
```html
<app-hero-carousel></app-hero-carousel>
```

### Component Structure
```typescript
// Import in your component
import { HeroCarouselComponent } from '../hero-carousel/hero-carousel.component';

// Add to imports array
imports: [HeroCarouselComponent]
```

## Data Structure

The component expects video data in this format:
```typescript
interface Video {
  id: string;
  title: string;
  description?: string;
  thumbnail: string;
  channel: string;
  views: string;
  timestamp: string;
  category: string;
  videoUrl: string;
}
```

## API Integration

The component automatically fetches data from:
- **Endpoint**: `/api/videos/top-liked`
- **Method**: GET
- **Response**: Array of top 3 most liked videos

## Customization

### Auto-Play Interval
```typescript
// In hero-carousel.component.ts
autoPlayInterval = 5000; // 5 seconds
```

### Thumbnail Colors
```typescript
// Category-based colors in generateThumbnailUrl()
const colors = {
  'Sports': 'FF6B35/FFFFFF',
  'Music': '9B59B6/FFFFFF',
  'Gaming': 'E74C3C/FFFFFF',
  // ... more categories
};
```

### Styling
The component uses CSS custom properties and can be styled via:
- `.hero-carousel` - Main container
- `.hero-container` - Video container
- `.hero-content` - Text overlay
- `.hero-nav` - Navigation controls
- `.hero-indicators` - Thumbnail indicators

## Responsive Breakpoints

- **Desktop**: 70vh height, full controls
- **Tablet (768px)**: 50vh height, simplified controls
- **Mobile (480px)**: 40vh height, minimal controls

## Events

### Mouse Interactions
- `mouseenter`: Shows controls, pauses auto-play
- `mouseleave`: Hides controls, resumes auto-play
- `click`: Triggers video play action

### Navigation
- `prevSlide()`: Previous video
- `nextSlide()`: Next video
- `goToSlide(index)`: Jump to specific video

## Performance Features

- **Lazy Loading**: Only loads top 3 videos
- **Smooth Transitions**: CSS-based animations
- **Memory Management**: Proper cleanup on destroy
- **Error Handling**: Graceful fallbacks for missing data

## Browser Support

- Modern browsers with CSS Grid and Flexbox
- Mobile browsers with touch support
- Progressive enhancement for older browsers

## Dependencies

- Angular Common Module
- VideoService for API calls
- No external libraries required

## Future Enhancements

- Video preview on hover
- Custom thumbnail generation
- Advanced animation options
- Accessibility improvements
- Keyboard navigation support 