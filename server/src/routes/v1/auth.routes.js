import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { authLimiter, passwordResetLimiter } from '../../middleware/rateLimit.js';
import { imageUploader } from '../../middleware/upload.js';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../../validators/auth.schema.js';
import {
  register,
  login,
  refresh,
  logout,
  me,
  sessions,
  revokeSessionByIdController,
  updateProfile,
  uploadAvatar,
  changePassword,
  forgotPassword,
  resetPasswordWithToken,
} from '../../controllers/auth.controller.js';

const router = Router();

router.post('/register', authLimiter, validateBody(registerSchema), register);
router.post('/login', authLimiter, validateBody(loginSchema), login);
router.post('/forgot-password', passwordResetLimiter, validateBody(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', passwordResetLimiter, validateBody(resetPasswordSchema), resetPasswordWithToken);
router.post('/refresh', authLimiter, refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me);
router.get('/sessions', authenticate, sessions);
router.delete('/sessions/:id', authenticate, revokeSessionByIdController);
router.patch('/me', authenticate, validateBody(updateProfileSchema), updateProfile);
router.post(
  '/me/avatar',
  authenticate,
  imageUploader('avatars').single('avatar'),
  uploadAvatar
);
router.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  changePassword
);

export default router;