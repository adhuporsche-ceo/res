const express = require('express');
const { protect, can, canAny } = require('../middleware/authMiddleware');
const {
  submitApplication,
  listApplications,
  reviewApplication,
} = require('../controllers/studentApplicationController');

const router = express.Router();

router.post('/', protect, (req, res, next) => {
  if (req.user.role !== 'STUDENT') {
    return res.status(403).json({ success: false, message: 'Only student accounts can submit applications.' });
  }
  next();
}, submitApplication);
router.get('/', protect, canAny('student.view.all', 'student.create'), listApplications);
router.patch('/:id/status', protect, can('student.create'), reviewApplication);

module.exports = router;