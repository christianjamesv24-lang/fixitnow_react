import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import {
  Announcement,
  AuditLog,
  Conversation,
  Message,
  Review,
  SavedAddress,
  ServiceCategory,
  ServiceRequest,
  SiteContent,
  TechnicianProfile,
  User,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getPagination, pagedData } from '../utils/pagination.js';
import { logAudit } from '../utils/audit.js';
import { ARCHIVE_MODELS, restoreRecord } from '../utils/softDelete.js';
import { defaultContentFor, SITE_CONTENT_KEYS } from '../utils/defaultContent.js';
import { env } from '../config/env.js';
import path from 'node:path';
import { ensureRequestConversation } from '../services/chat.service.js';
import { recalculateTechnicianRating } from '../services/rating.service.js';
import { revokeAllSessions } from '../services/auth.service.js';
import { notifyUser } from '../services/notification.service.js';
import { broadcast, getIo } from '../sockets/registry.js';

const userAttributes = ['id', 'name', 'email', 'phone', 'role', 'isActive', 'createdAt'];

async function pagedList(model, req, options = {}) {
  const { page, limit, offset } = getPagination(req.validatedQuery, 30);
  const { count, rows } = await model.findAndCountAll({
    ...options,
    limit,
    offset,
    distinct: true,
  });
  return pagedData(rows, count, page, limit);
}

export const listAdminRequests = asyncHandler(async (req, res) => {
  const where = {};
  const { status, q } = req.validatedQuery;
  if (status) where.status = status;
  if (q && /^\d+$/.test(q)) where.id = Number(q);
  const data = await pagedList(ServiceRequest, req, {
    where,
    include: [
      { association: 'category', attributes: ['id', 'name', 'icon'] },
      { association: 'customer', attributes: userAttributes },
      { association: 'technician', attributes: userAttributes },
    ],
    order: [['createdAt', 'DESC']],
  });
  res.json({ success: true, data });
});

export const assignAdminRequest = asyncHandler(async (req, res) => {
  const request = await ServiceRequest.findByPk(req.params.id);
  if (!request) throw ApiError.notFound('Service request not found');
  if (['cancelled', 'completed'].includes(request.status)) {
    throw ApiError.conflict('Completed or cancelled requests cannot be reassigned');
  }

  if (req.body.technicianId !== null) {
    const profile = await TechnicianProfile.findOne({
      where: { userId: req.body.technicianId, verificationStatus: 'verified' },
      include: [
        { association: 'user', attributes: ['id', 'isActive'], where: { isActive: true } },
        { association: 'areas', where: { city: request.city }, required: true },
      ],
    });
    if (!profile) {
      throw ApiError.badRequest('Choose an active, verified technician who serves this location');
    }
  }

  const existingConversation = await Conversation.findOne({ where: { requestId: request.id } });
  if (req.body.technicianId === null && existingConversation) {
    throw ApiError.conflict('A request with an open chat cannot be left unassigned');
  }

  const before = request.toJSON();
  await request.update({ technicianId: req.body.technicianId });
  if (existingConversation && req.body.technicianId !== null) {
    await ensureRequestConversation(request);
  }
  await logAudit({
    actorId: req.user.id,
    action: 'request.assigned',
    entityType: 'ServiceRequest',
    entityId: request.id,
    before: { technicianId: before.technicianId },
    after: { technicianId: request.technicianId },
    ip: req.ip,
  });
  res.json({ success: true, data: { request } });
});

export const listVerificationQueue = asyncHandler(async (req, res) => {
  const where = {};
  if (req.validatedQuery.status) where.verificationStatus = req.validatedQuery.status;
  const data = await pagedList(TechnicianProfile, req, {
    where,
    include: [
      { association: 'user', attributes: userAttributes },
      { association: 'documents' },
      { association: 'skills', through: { attributes: [] } },
      { association: 'areas' },
    ],
    order: [['submittedAt', 'ASC']],
  });
  res.json({ success: true, data });
});

export const decideVerification = asyncHandler(async (req, res) => {
  const profile = await TechnicianProfile.findByPk(req.params.id);
  if (!profile) throw ApiError.notFound('Technician verification not found');
  const { action, note = null } = req.body;
  const status = { approve: 'verified', reject: 'rejected', resubmit: 'pending', suspend: 'suspended' }[action];
  const before = profile.toJSON();
  await profile.update({
    verificationStatus: status,
    verificationNote: note,
    verifiedAt: status === 'verified' ? new Date() : null,
    verifiedBy: status === 'verified' ? req.user.id : null,
    submittedAt: action === 'resubmit' ? new Date() : profile.submittedAt,
  });
  await logAudit({
    actorId: req.user.id,
    action: `technician.verification.${action}`,
    entityType: 'TechnicianProfile',
    entityId: profile.id,
    before: { verificationStatus: before.verificationStatus },
    after: { verificationStatus: status, verificationNote: status === 'verified' ? note : profile.verificationNote },
    ip: req.ip,
  });

  if (status === 'verified') {
    broadcast('technician:verified', { profileId: profile.id, userId: profile.userId });
  }
  try {
    await notifyUser({
      userId: profile.userId,
      type: 'verification_decision',
      title: status === 'verified' ? 'Verification approved' : 'Verification update',
      body: note || `Your verification status is now ${status}.`,
      data: { url: '/technician/verification' },
    });
  } catch (error) {
    console.error('Verification notification failed:', error.message);
  }

  res.json({ success: true, data: { profile } });
});

export const getVerificationDocument = asyncHandler(async (req, res) => {
  const profile = await TechnicianProfile.findByPk(req.params.profileId);
  if (!profile) throw ApiError.notFound('Technician verification not found');
  const document = await profile.getDocuments({ where: { id: req.params.documentId } });
  if (!document.length) throw ApiError.notFound('Verification document not found');
  res.sendFile(path.join(env.uploadsDir, 'private', 'documents', path.basename(document[0].filePath)));
});

export const listAdminUsers = asyncHandler(async (req, res) => {
  const where = {};
  if (req.validatedQuery.status === 'active') where.isActive = true;
  if (req.validatedQuery.status === 'inactive') where.isActive = false;
  if (req.validatedQuery.status && !['active', 'inactive'].includes(req.validatedQuery.status)) {
    where.role = req.validatedQuery.status;
  }
  if (req.validatedQuery.q) {
    where[Op.or] = [
      { name: { [Op.like]: `%${req.validatedQuery.q}%` } },
      { email: { [Op.like]: `%${req.validatedQuery.q}%` } },
    ];
  }
  const data = await pagedList(User, req, { where, attributes: userAttributes, order: [['createdAt', 'DESC']] });
  res.json({ success: true, data });
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (Number(user.id) === Number(req.user.id) && !req.body.isActive) {
    throw ApiError.badRequest('You cannot deactivate your own admin account');
  }
  if (user.role === 'admin' && !req.body.isActive) {
    const activeAdmins = await User.count({ where: { role: 'admin', isActive: true } });
    if (activeAdmins <= 1) throw ApiError.conflict('At least one active admin account must remain');
  }
  const before = { isActive: user.isActive };
  await user.update({ isActive: req.body.isActive });
  if (!user.isActive) {
    await revokeAllSessions(user.id);
    getIo()?.in(`user:${user.id}`).disconnectSockets(true);
  }
  await logAudit({
    actorId: req.user.id,
    action: req.body.isActive ? 'user.activated' : 'user.deactivated',
    entityType: 'User',
    entityId: user.id,
    before,
    after: { isActive: user.isActive },
    ip: req.ip,
  });
  res.json({ success: true, data: { user } });
});

export const listAdminReviews = asyncHandler(async (req, res) => {
  const where = {};
  if (req.validatedQuery.status === 'hidden') where.isHidden = true;
  if (req.validatedQuery.status === 'visible') where.isHidden = false;
  const data = await pagedList(Review, req, {
    where,
    include: [
      { association: 'customer', attributes: ['id', 'name'] },
      { association: 'technician', attributes: ['id', 'name'] },
      { association: 'request', attributes: ['id', 'status'] },
    ],
    order: [['createdAt', 'DESC']],
  });
  res.json({ success: true, data });
});

export const updateReviewVisibility = asyncHandler(async (req, res) => {
  const review = await Review.findByPk(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');
  const before = { isHidden: review.isHidden, hiddenNote: review.hiddenNote };
  const nowHidden = req.body.isHidden;
  await sequelize.transaction(async (transaction) => {
    await review.update({
      isHidden: nowHidden,
      hiddenNote: nowHidden ? req.body.hiddenNote || null : null,
      hiddenBy: nowHidden ? req.user.id : null,
      hiddenAt: nowHidden ? new Date() : null,
    }, { transaction });
    await recalculateTechnicianRating(review.technicianId, transaction);
  });
  await logAudit({
    actorId: req.user.id,
    action: nowHidden ? 'review.hidden' : 'review.restored',
    entityType: 'Review',
    entityId: review.id,
    before,
    after: { isHidden: review.isHidden, hiddenNote: review.hiddenNote },
    ip: req.ip,
  });
  res.json({ success: true, data: { review } });
});

export const listAdminCategories = asyncHandler(async (req, res) => {
  const items = await ServiceCategory.findAll({ order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  res.json({ success: true, data: { items } });
});

export const createAdminCategory = asyncHandler(async (req, res) => {
  const category = await ServiceCategory.create(req.body);
  await logAudit({
    actorId: req.user.id,
    action: 'category.created',
    entityType: 'ServiceCategory',
    entityId: category.id,
    after: category.toJSON(),
    ip: req.ip,
  });
  res.status(201).json({ success: true, data: { category } });
});

export const updateAdminCategory = asyncHandler(async (req, res) => {
  const category = await ServiceCategory.findByPk(req.params.id);
  if (!category) throw ApiError.notFound('Category not found');
  const before = category.toJSON();
  await category.update(req.body);
  await logAudit({
    actorId: req.user.id,
    action: 'category.updated',
    entityType: 'ServiceCategory',
    entityId: category.id,
    before,
    after: category.toJSON(),
    ip: req.ip,
  });
  res.json({ success: true, data: { category } });
});

export const deleteAdminCategory = asyncHandler(async (req, res) => {
  const category = await ServiceCategory.findByPk(req.params.id);
  if (!category) throw ApiError.notFound('Category not found');
  await category.update({ deletedBy: req.user.id });
  await category.destroy();
  await logAudit({
    actorId: req.user.id,
    action: 'category.archived',
    entityType: 'ServiceCategory',
    entityId: category.id,
    before: category.toJSON(),
    ip: req.ip,
  });
  res.json({ success: true, data: null });
});

export const getAdminContent = asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (!SITE_CONTENT_KEYS.includes(key)) throw ApiError.notFound('Site content section not found');
  const row = await SiteContent.findOne({ where: { key } });
  res.json({ success: true, data: { key, blocks: row?.blocks || defaultContentFor(key) } });
});

export const updateAdminContent = asyncHandler(async (req, res) => {
  if (!SITE_CONTENT_KEYS.includes(req.params.key)) throw ApiError.notFound('Site content section not found');
  const [row] = await SiteContent.findOrCreate({
    where: { key: req.params.key },
    defaults: { blocks: req.body.blocks, updatedBy: req.user.id },
  });
  const before = row.blocks;
  await row.update({ blocks: req.body.blocks, updatedBy: req.user.id });
  await logAudit({
    actorId: req.user.id,
    action: 'site_content.updated',
    entityType: 'SiteContent',
    entityId: row.id,
    before: { key: row.key, blocks: before },
    after: { key: row.key, blocks: row.blocks },
    ip: req.ip,
  });
  res.json({ success: true, data: { key: row.key, blocks: row.blocks } });
});

export const listAdminAnnouncements = asyncHandler(async (req, res) => {
  const items = await Announcement.findAll({ order: [['createdAt', 'DESC']] });
  res.json({ success: true, data: { items } });
});

export const createAdminAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await Announcement.create({ ...req.body, createdBy: req.user.id });
  await logAudit({
    actorId: req.user.id,
    action: 'announcement.created',
    entityType: 'Announcement',
    entityId: announcement.id,
    after: announcement.toJSON(),
    ip: req.ip,
  });
  res.status(201).json({ success: true, data: { announcement } });
});

export const updateAdminAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await Announcement.findByPk(req.params.id);
  if (!announcement) throw ApiError.notFound('Announcement not found');
  const before = announcement.toJSON();
  await announcement.update(req.body);
  await logAudit({
    actorId: req.user.id,
    action: 'announcement.updated',
    entityType: 'Announcement',
    entityId: announcement.id,
    before,
    after: announcement.toJSON(),
    ip: req.ip,
  });
  res.json({ success: true, data: { announcement } });
});

export const listAdminArchive = asyncHandler(async (req, res) => {
  const modelName = ARCHIVE_MODELS[req.validatedQuery.type];
  if (!modelName) throw ApiError.badRequest('Choose a supported archive type');
  const models = {
    Announcement,
    Conversation,
    Message,
    Review,
    SavedAddress,
    ServiceCategory,
    ServiceRequest,
    TechnicianProfile,
    User,
  };
  const model = models[modelName];
  if (!model) throw ApiError.badRequest('This archive type is not available');
  const data = await pagedList(model, req, {
    paranoid: false,
    where: { deletedAt: { [Op.ne]: null } },
    order: [['deletedAt', 'DESC']],
  });
  res.json({ success: true, data });
});

export const restoreAdminArchive = asyncHandler(async (req, res) => {
  const modelName = ARCHIVE_MODELS[req.params.type];
  const models = {
    Announcement,
    Conversation,
    Message,
    Review,
    SavedAddress,
    ServiceCategory,
    ServiceRequest,
    TechnicianProfile,
    User,
  };
  const model = models[modelName];
  if (!model) throw ApiError.badRequest('Choose a supported archive type');
  const record = await restoreRecord(model, req.params.id);
  if (!record) throw ApiError.notFound('Archived record not found');
  await logAudit({
    actorId: req.user.id,
    action: 'archive.restored',
    entityType: modelName,
    entityId: record.id,
    after: record.toJSON(),
    ip: req.ip,
  });
  res.json({ success: true, data: { record } });
});

export const listAdminAudit = asyncHandler(async (req, res) => {
  const data = await pagedList(AuditLog, req, {
    include: [{ association: 'actor', attributes: ['id', 'name', 'email'] }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ success: true, data });
});
