const express = require('express');
const { protect, can, canAny } = require('../middleware/authMiddleware');
const {
  submitApplication,
  listApplications,
  reviewApplication,
} = require('../controllers/studentApplicationController');

const router = express.Router();

router.use(protect);
router.get('/', canAny('student.view.all', 'student.create'), listApplications);
router.post('/', can('student.create'), submitApplication);
router.patch('/:id/status', can('student.create'), reviewApplication);

module.exports = router;