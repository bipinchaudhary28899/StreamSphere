import express, { Router } from 'express';  // Use import here
import { googleLogin } from '../controllers/auth.controller';

const router: Router = express.Router();

router.post('/google-login', googleLogin);

export default router;
