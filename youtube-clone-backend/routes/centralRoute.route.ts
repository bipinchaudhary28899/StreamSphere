import express, { Router } from 'express';  // Use import here
import { googleLogin } from '../controllers/auth.controller';
import { uploadController } from '../controllers/upload.controller';
import { saveVideoController } from '../controllers/saveVideo.controller';
import { VideoController } from '../controllers/getVideo.controller';

const router: Router = express.Router();

router.post('/google-login', googleLogin);
router.post('/upload-url', uploadController);
router.post('/save-video', saveVideoController);
router.get('/home', VideoController.getVideos);

export default router;
