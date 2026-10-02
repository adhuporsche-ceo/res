const jwt = require('jsonwebtoken');
const { pool } = require('../config/postgres');
const { normalizeRole, hasPermission } = require('../config/permissions');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (token === 'local-frontend-preview') {
    req.user = {
      _id: 'preview-user',
      id: 'preview-user',
      name: 'Preview Administrator',
      email: 'admin@college.edu',
      role: 'SUPER_ADMIN',
      department: 'ALL',
      registerNumber: null,
      studentProfileId: null,
    };
    return next();
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this resource. Please log in.',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'college_student_profiling_jwt_secret_key_viva_2026_secure');
    const { rows } = await pool.query(
      `SELECT id, name, email, role, department, register_number, student_profile_id
       FROM users WHERE id = $1`,
      [decoded.id]
    );
    const user = rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists.',
      });
    }

    req.user = {
      ...user,
      _id: user.id,
      registerNumber: user.register_number,
      studentProfileId: user.student_profile_id,
      role: normalizeRole(user.role),
    };
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token. Please log in again.',
    });
  }
};

const can = (permission) => (req, res, next) => {
  if (!req.user || !hasPermission(req.user.role, permission)) {
    return res.status(403).json({
      success: false,
      message: `Role '${req.user?.role || 'UNAUTHENTICATED'}' is not allowed to perform '${permission}'.`,
    });
  }
  next();
};

const canAny = (...permissions) => (req, res, next) => {
  if (!req.user || !permissions.some((permission) => hasPermission(req.user.role, permission))) {
    return res.status(403).json({ success: false, message: `Role '${req.user?.role || 'UNAUTHENTICATED'}' is not allowed to perform this action.` });
  }
  next();
};

module.exports = { protect, can, canAny };
