const express = require('express');
const { protect, can, canAny } = require('../middleware/authMiddleware');
const {
  submitApplication,
  listApplications,
  reviewApplication,
} = require('../controllers/studentApplicationController');

const router = express.Router();

router.post('/', submitApplication);
router.get('/', protect, canAny('student.view.all', 'student.create'), listApplications);
router.patch('/:id/status', protect, can('student.create'), reviewApplication);

module.exports = router;