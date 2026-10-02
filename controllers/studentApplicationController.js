const mongoose = require('mongoose');
const { pool } = require('../config/postgres');
const { randomUUID } = require('crypto');
const StudentApplication = require('../models/StudentApplication');

const validGoals = new Set(['Placement', 'Higher Studies', 'Entrepreneurship']);
const validStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED']);

const validateApplication = (application) => {
  const personal = application?.personalDetails || {};
  const family = application?.familyDetails || {};
  const requiredPersonal = [
    'registerNumber', 'name', 'dob', 'gender', 'department', 'section',
    'institutionalEmail', 'personalEmail', 'mobile', 'residentialAddress', 'category',
  ];
  if (requiredPersonal.some((key) => !String(personal[key] || '').trim())) {
    return 'Complete all required personal details.';
  }
  if (!String(family.emergencyContact || '').trim()) return 'Emergency contact is required.';
  if (!validGoals.has(application?.careerGoal?.primaryGoal)) return 'Select a valid career goal.';
  if (application.consent !== true) return 'Consent is required to submit this application.';
  return null;
};

const submitApplication = async (req, res, next) => {
  const application = req.body;
  const validationError = validateApplication(application);
  if (validationError) return res.status(400).json({ success: false, message: validationError });

  const registerNumber = application.personalDetails.registerNumber.trim().toUpperCase();
  const department = application.personalDetails.department.trim().toUpperCase();
  const section = application.personalDetails.section.trim().toUpperCase();

  try {
    if (mongoose.connection.readyState === 1) {
      const existing = await StudentApplication.findOne({ registerNumber, status: 'PENDING' }).lean();
      if (existing) {
        return res.status(409).json({ success: false, message: 'An application with this register number is already pending.' });
      }

      const record = await StudentApplication.create({
        registerNumber,
        department,
        section,
        status: 'PENDING',
        submittedAt: new Date(),
        application,
      });

      return res.status(201).json({
        success: true,
        message: 'Student application submitted for review.',
        data: {
          _id: record._id,
          registerNumber,
          department,
          section,
          status: record.status,
          submittedAt: record.submittedAt,
        },
      });
    }

    const fallbackRecord = {
      _id: `local-${Date.now()}`,
      registerNumber,
      department,
      section,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
      application,
    };

    if (req.app && Array.isArray(req.app.locals.fallbackApplications)) {
      req.app.locals.fallbackApplications.push(fallbackRecord);
    }

    return res.status(201).json({
      success: true,
      message: 'Student application saved in local fallback mode because MongoDB Atlas is unavailable.',
      data: fallbackRecord,
    });
  } catch (error) {
    next(error);
  }
};

const listApplications = async (req, res, next) => {
  const status = String(req.query.status || 'PENDING').toUpperCase();
  if (!validStatuses.has(status)) return res.status(400).json({ success: false, message: 'Invalid application status.' });

  try {
    if (mongoose.connection.readyState === 1) {
      const rows = await StudentApplication.find({ status }).sort({ submittedAt: -1 }).lean();
      return res.json({ success: true, data: rows });
    }

    if (req.app && Array.isArray(req.app.locals.fallbackApplications)) {
      const rows = req.app.locals.fallbackApplications.filter((item) => item.status === status);
      return res.json({ success: true, data: rows });
    }

    return res.json({ success: true, data: [] });
  } catch (error) { next(error); }
};

const reviewApplication = async (req, res, next) => {
  const status = String(req.body.status || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be APPROVED or REJECTED.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM student_applications WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const applicationRow = rows[0];
    if (!applicationRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }
    if (applicationRow.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'This application has already been reviewed.' });
    }

    let studentId = null;
    if (status === 'APPROVED') {
      const application = applicationRow.application;
      const personal = application.personalDetails;
      const profile = {
        ...application,
        createdBy: req.user._id,
        createdByRole: req.user.role,
        updatedBy: req.user._id,
        updatedByRole: req.user.role,
      };
      for (const key of ['semesters', 'arrears', 'mentorInterventions']) {
        profile[key] = (profile[key] || []).map((item) => ({ ...item, _id: item._id || randomUUID() }));
      }
      const inserted = await client.query(
        `INSERT INTO students (register_number, department, section, created_by, updated_by, profile)
         VALUES ($1, $2, $3, $4, $4, $5::jsonb)
         RETURNING id`,
        [personal.registerNumber.trim().toUpperCase(), personal.department.trim().toUpperCase(), personal.section.trim().toUpperCase(), req.user._id, JSON.stringify(profile)]
      );
      studentId = inserted.rows[0].id;
    }

    const updated = await client.query(
      `UPDATE student_applications SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3
       RETURNING id, register_number AS "registerNumber", status, submitted_at AS "submittedAt", reviewed_at AS "reviewedAt"`,
      [status, req.user._id, req.params.id]
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, student_id, student_register_number, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.user._id, req.user.name, req.user.role, `STUDENT_APPLICATION_${status}`, studentId, applicationRow.register_number, `Reviewed application ${req.params.id}`, req.ip || '']
    );
    await client.query('COMMIT');
    res.json({ success: true, data: { ...updated.rows[0], studentId } });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A student profile with this register number already exists.' });
    }
    next(error);
  } finally {
    client.release();
  }
};

module.exports = { submitApplication, listApplications, reviewApplication };