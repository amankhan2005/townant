import { Router } from 'express';
import admin from './admin/index.js';
import ai from './ai.js';
import auth from './auth.js';
import bookings from './bookings.js';
import catalog from './catalog.js';
import conversations from './conversations.js';
import favorites from './favorites.js';
import me from './me.js';
import notifications from './notifications.js';
import reviews from './reviews.js';
import staffAuth from './staffAuth.js';
import support from './support.js';
import vendorApplications from './vendorApplications.js';
import vendor from './vendor/index.js';

const router = Router();

router.use('/auth', auth);
router.use('/staff-auth', staffAuth);
router.use('/catalog', catalog);
router.use('/me', me);
router.use('/bookings', bookings);
router.use('/favorites', favorites);
router.use('/conversations', conversations);
router.use('/reviews', reviews);
router.use('/notifications', notifications);
router.use('/support', support);
router.use('/vendor-applications', vendorApplications);
router.use('/ai', ai);
router.use('/vendor', vendor);
router.use('/admin', admin);

export default router;
