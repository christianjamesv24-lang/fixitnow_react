import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import {
  RequestPhoto,
  RequestStatusHistory,
  SavedAddress,
  ServiceCategory,
  ServiceRequest,
  TechnicianProfile,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getPagination, pagedData } from '../utils/pagination.js';
import { softDeleteRecord } from '../utils/softDelete.js';
import { notifyUser } from '../services/notification.service.js';
import { emitToRole } from '../sockets/registry.js';
import { ensureRequestConversation } from '../services/chat.service.js';
import {
  createLocationShare,
  emitLocationShare,
  findActiveLocationShare,
  locationShareJSON,
  stopActiveLocationShare,
} from '../services/location.service.js';
import { isServiceLocation } from '../utils/serviceArea.js';
import {
  STATUS_LABELS,
  STATUS_TRANSITIONS,
  WORK_STARTED_STATUSES,
} from '../utils/constants.js';

const USER_ATTRIBUTES = ['id', 'name', 'avatarUrl', 'phone'];
const ACTIVE_TECH_STATUSES = ['accepted', 'on_the_way', 'arrived', 'in_progress'];
const DEFAULT_STATUS_NOTES = {
  on_the_way: 'Technician is on the way',
  arrived: 'Technician arrived at the service address',
  in_progress: 'Work started on the appliance',
  completed: 'Job completed',
};

function photoUrl(filePath) {
  return `/uploads/${String(filePath).replace(/^\/?uploads\//, '')}`;
}

function listIncludes(viewer) {
  const include = [{ association: 'category', attributes: ['id', 'name', 'icon', 'slug'] }];
  if (viewer.role !== 'customer') {
    include.push({ association: 'customer', attributes: USER_ATTRIBUTES });
  }
  include.push({ association: 'technician', attributes: USER_ATTRIBUTES });
  return include;
}

function detailIncludes(viewer) {
  const include = listIncludes(viewer);
  include.push(
    { association: 'photos' },
    {
      association: 'history',
      separate: true,
      include: [{ association: 'changedByUser', attributes: ['id', 'name', 'role'] }],
    }
  );
  return include;
}

function serializeRequest(instance, viewer) {
  const raw = instance.toJSON();
  if (Array.isArray(raw.photos)) {
    raw.photos = raw.photos
      .map((photo) => ({
        id: photo.id,
        url: photoUrl(photo.filePath),
        originalName: photo.originalName,
        sortOrder: photo.sortOrder,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  if (Array.isArray(raw.history)) {
    raw.history.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  const isOwner = Number(raw.customerId) === Number(viewer.id);
  const isAssigned = raw.technicianId && Number(raw.technicianId) === Number(viewer.id);
  const canSeePrivate = isOwner || isAssigned || viewer.role === 'admin';
  if (!canSeePrivate) {
    delete raw.address;
    delete raw.lat;
    delete raw.lng;
    delete raw.cancellationReason;
    raw.addressHidden = true;
    if (raw.customer) delete raw.customer.phone;
  }
  return raw;
}

async function safeNotify(values) {
  try {
    await notifyUser(values);
  } catch (error) {
    console.error('Notification dispatch failed:', error.message);
  }
}

async function resolveAddress(body, userId, existing = null) {
  const hasAddressFields = ['address', 'city', 'lat', 'lng'].some(
    (field) => body[field] !== undefined
  );

  if (body.savedAddressId) {
    const saved = await SavedAddress.findOne({
      where: { id: body.savedAddressId, userId },
    });
    if (!saved) throw ApiError.badRequest('The selected saved address was not found');
    assertServiceLocation(saved);
    return { address: saved.address, city: saved.city, lat: saved.lat, lng: saved.lng };
  }

  if (!hasAddressFields) {
    if (existing) return {};
    throw ApiError.badRequest('Choose a saved address or enter a complete service address');
  }

  const merged = {
    address: body.address ?? existing?.address,
    city: body.city ?? existing?.city,
    lat: body.lat ?? existing?.lat,
    lng: body.lng ?? existing?.lng,
  };
  if (!merged.address || !merged.city || merged.lat === undefined || merged.lng === undefined) {
    throw ApiError.badRequest('Provide the complete address, city, latitude and longitude');
  }
  assertServiceLocation(merged);
  return merged;
}

function assertServiceLocation(location) {
  if (!isServiceLocation(location)) {
    throw ApiError.badRequest(
      'FixitNow currently serves Oriental Mindoro only. Choose a municipality in the province and a location pin within the service area.'
    );
  }
}

async function assertCategory(categoryId) {
  const category = await ServiceCategory.findOne({ where: { id: categoryId, isActive: true } });
  if (!category) throw ApiError.badRequest('Choose an active service category');
  return category;
}

async function preferredTechnician(id, city, categoryId) {
  const profile = await TechnicianProfile.findOne({
    where: { userId: id, verificationStatus: 'verified', isAvailable: true },
    include: [
      { association: 'user', attributes: ['id', 'name', 'isActive'], where: { isActive: true } },
      { association: 'areas', where: { city }, required: true },
      {
        association: 'skills',
        where: { id: categoryId },
        attributes: ['id'],
        through: { attributes: [] },
        required: true,
      },
    ],
  });
  if (!profile) {
    throw ApiError.badRequest(
      'The selected technician is unavailable or does not serve this location and service category'
    );
  }
  return profile;
}

async function ensureNoScheduleConflict({ technicianId, preferredDate, timeSlot, excludeId, transaction }) {
  if (!technicianId) return;
  const conflict = await ServiceRequest.findOne({
    where: {
      id: { [Op.ne]: excludeId },
      technicianId,
      preferredDate,
      timeSlot,
      status: { [Op.in]: ACTIVE_TECH_STATUSES },
    },
    attributes: ['id'],
    transaction,
  });
  if (conflict) {
    throw ApiError.conflict('This technician already has another job during that time slot');
  }
}

async function loadRequest(id, viewer, { detail = true } = {}) {
  return ServiceRequest.findByPk(id, {
    include: detail ? detailIncludes(viewer) : listIncludes(viewer),
  });
}

function assertCanView(request, viewer) {
  if (!request) throw ApiError.notFound('Service request not found');
  if (viewer.role === 'admin') return;
  if (viewer.role === 'customer') {
    if (Number(request.customerId) !== Number(viewer.id)) {
      throw ApiError.notFound('Service request not found');
    }
    return;
  }
  if (Number(request.technicianId) === Number(viewer.id)) return;
  const isOpen = request.status === 'pending' && !request.technicianId;
  const isVerified = viewer.technicianProfile?.verificationStatus === 'verified';
  if (!isOpen || !isVerified) throw ApiError.notFound('Service request not found');
}

export const createRequest = asyncHandler(async (req, res) => {
  const body = req.body;
  await assertCategory(body.categoryId);
  const address = await resolveAddress(body, req.user.id);

  let technician = null;
  if (body.preferredTechnicianId) {
    technician = await preferredTechnician(body.preferredTechnicianId, address.city, body.categoryId);
    await ensureNoScheduleConflict({
      technicianId: technician.userId,
      preferredDate: body.preferredDate,
      timeSlot: body.timeSlot,
    });
  }

  const request = await sequelize.transaction(async (transaction) => {
    const created = await ServiceRequest.create(
      {
        customerId: req.user.id,
        technicianId: technician?.userId || null,
        categoryId: body.categoryId,
        applianceBrand: body.applianceBrand || null,
        applianceModel: body.applianceModel || null,
        issueDescription: body.issueDescription,
        urgency: body.urgency,
        preferredDate: body.preferredDate,
        timeSlot: body.timeSlot,
        ...address,
        status: 'pending',
      },
      { transaction }
    );

    if (req.files?.length) {
      await RequestPhoto.bulkCreate(
        req.files.map((file, index) => ({
          requestId: created.id,
          filePath: `requests/${file.filename}`,
          originalName: file.originalname,
          sortOrder: index,
        })),
        { transaction }
      );
    }

    await RequestStatusHistory.create(
      {
        requestId: created.id,
        status: 'pending',
        note: 'Request submitted',
        changedBy: req.user.id,
      },
      { transaction }
    );

    return created;
  });

  await safeNotify({
    userId: req.user.id,
    type: 'request_created',
    title: 'Request submitted',
    body: 'We received your service request. You will be notified as soon as a technician responds.',
    data: { url: `/requests/${request.id}`, requestId: request.id },
  });

  if (!technician) {
    const matches = await TechnicianProfile.findAll({
      where: { verificationStatus: 'verified', isAvailable: true },
      include: [
        {
          association: 'user',
          attributes: ['id'],
          where: { isActive: true },
          required: true,
        },
        {
          association: 'skills',
          through: { attributes: [] },
          attributes: ['id'],
          where: { id: body.categoryId },
          required: true,
        },
        {
          association: 'areas',
          attributes: ['city'],
          where: { city: address.city },
          required: true,
        },
      ],
    });

    for (const match of matches) {
      await safeNotify({
        userId: match.userId,
        type: 'request_available',
        title: 'New job available',
        body: `${req.user.name} needs a technician in ${address.city}.`,
        data: { url: `/requests/${request.id}`, requestId: request.id },
      });
    }

    emitToRole('technician', 'request:created', {
      requestId: request.id,
      categoryId: request.categoryId,
      city: request.city,
    });
  }

  if (technician) {
    await safeNotify({
      userId: technician.userId,
      type: 'request_assigned',
      title: 'New direct job request',
      body: `${req.user.name} requested you for a ${body.preferredDate} ${body.timeSlot} visit.`,
      data: { url: `/requests/${request.id}`, requestId: request.id },
    });
  }

  const full = await loadRequest(request.id, req.user);
  res.status(201).json({
    success: true,
    message: 'Service request submitted',
    data: { request: serializeRequest(full, req.user) },
  });
});

export const listRequests = asyncHandler(async (req, res) => {
  const query = req.validatedQuery;
  const { page, limit, offset } = getPagination(query, 10);
  const where = {};

  if (req.user.role === 'customer') where.customerId = req.user.id;
  if (req.user.role === 'technician') where.technicianId = req.user.id;
  if (query.status) where.status = query.status;
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.city) where.city = query.city;
  if (query.q) {
    where[Op.or] = [
      { issueDescription: { [Op.like]: `%${query.q}%` } },
      { applianceBrand: { [Op.like]: `%${query.q}%` } },
      { applianceModel: { [Op.like]: `%${query.q}%` } },
      { address: { [Op.like]: `%${query.q}%` } },
    ];
  }

  const { count, rows } = await ServiceRequest.findAndCountAll({
    where,
    include: listIncludes(req.user),
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit,
    offset,
  });

  res.json({
    success: true,
    message: 'OK',
    data: pagedData(
      rows.map((row) => serializeRequest(row, req.user)),
      count,
      page,
      limit
    ),
  });
});

export const availableJobs = asyncHandler(async (req, res) => {
  const profile = await TechnicianProfile.findOne({
    where: { userId: req.user.id },
    include: [
      { association: 'skills', through: { attributes: [] }, attributes: ['id', 'name'] },
      { association: 'areas', attributes: ['city'] },
    ],
  });
  if (!profile || profile.verificationStatus !== 'verified') {
    throw ApiError.forbidden('Complete verification before browsing the job board');
  }

  const query = req.validatedQuery;
  const { page, limit, offset } = getPagination(query, 10);
  const where = { status: 'pending', technicianId: null };
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.city) where.city = query.city;

  const skillIds = (profile.skills || []).map((skill) => skill.id);
  const cities = (profile.areas || []).map((area) => area.city);
  if (query.q) {
    where[Op.or] = [
      { issueDescription: { [Op.like]: `%${query.q}%` } },
      { applianceBrand: { [Op.like]: `%${query.q}%` } },
      { applianceModel: { [Op.like]: `%${query.q}%` } },
    ];
  }

  if (!skillIds.length) {
    return res.json({
      success: true,
      message: 'OK',
      data: pagedData([], 0, page, limit),
    });
  }
  where.categoryId = where.categoryId
    ? { [Op.eq]: where.categoryId }
    : { [Op.in]: skillIds };
  where.city = {
    [Op.in]: query.city ? cities.filter((city) => city === query.city) : cities,
  };

  const { count, rows } = await ServiceRequest.findAndCountAll({
    where,
    include: listIncludes(req.user),
    order: [
      ['preferredDate', 'ASC'],
      ['createdAt', 'ASC'],
    ],
    limit,
    offset,
  });

  res.json({
    success: true,
    message: 'OK',
    data: pagedData(
      rows.map((row) => serializeRequest(row, req.user)),
      count,
      page,
      limit
    ),
  });
});

export const getRequest = asyncHandler(async (req, res) => {
  const request = await loadRequest(req.params.id, req.user);
  assertCanView(request, req.user);
  res.json({
    success: true,
    message: 'OK',
    data: { request: serializeRequest(request, req.user) },
  });
});

function assertLocationParticipant(request, viewer) {
  const isOwner = Number(request.customerId) === Number(viewer.id);
  const isAssignedTech = Number(request.technicianId) === Number(viewer.id);
  if (viewer.role === 'admin' || (!isOwner && !isAssignedTech)) {
    throw ApiError.notFound('Service request not found');
  }
  return { isOwner, isAssignedTech };
}

export const getRequestLocation = asyncHandler(async (req, res) => {
  const request = await ServiceRequest.findByPk(req.params.id);
  if (!request) throw ApiError.notFound('Service request not found');
  assertLocationParticipant(request, req.user);
  const share =
    request.status === 'on_the_way' ? await findActiveLocationShare(request.id) : null;
  res.json({ success: true, data: { location: locationShareJSON(share) } });
});

export const startRequestLocation = asyncHandler(async (req, res) => {
  const request = await ServiceRequest.findByPk(req.params.id);
  if (!request) throw ApiError.notFound('Service request not found');
  const { isAssignedTech } = assertLocationParticipant(request, req.user);
  if (!isAssignedTech || req.user.role !== 'technician') {
    throw ApiError.forbidden('Only the assigned technician can share live location');
  }
  if (request.status !== 'on_the_way') {
    throw ApiError.conflict('Live location can be shared while the technician is on the way');
  }

  const conversation = await ensureRequestConversation(request);
  const share = await createLocationShare(request, conversation.id, req.user.id, req.body);
  res.status(201).json({
    success: true,
    message: 'Live location sharing started',
    data: { location: locationShareJSON(share) },
  });
});

export const updateRequestLocation = asyncHandler(async (req, res) => {
  const request = await ServiceRequest.findByPk(req.params.id);
  if (!request) throw ApiError.notFound('Service request not found');
  const { isAssignedTech } = assertLocationParticipant(request, req.user);
  if (!isAssignedTech || req.user.role !== 'technician') {
    throw ApiError.forbidden('Only the assigned technician can share live location');
  }
  if (request.status !== 'on_the_way') {
    await stopActiveLocationShare(request);
    throw ApiError.conflict('Live location sharing has ended because the job status changed');
  }

  const share = await findActiveLocationShare(request.id);
  if (!share || Number(share.userId) !== Number(req.user.id)) {
    throw ApiError.conflict('Start live location sharing before sending location updates');
  }
  await share.update(req.body);
  emitLocationShare(request, share);
  res.json({ success: true, data: { location: locationShareJSON(share) } });
});

export const stopRequestLocation = asyncHandler(async (req, res) => {
  const request = await ServiceRequest.findByPk(req.params.id);
  if (!request) throw ApiError.notFound('Service request not found');
  const { isAssignedTech } = assertLocationParticipant(request, req.user);
  if (!isAssignedTech || req.user.role !== 'technician') {
    throw ApiError.forbidden('Only the assigned technician can stop live location sharing');
  }
  const share = await stopActiveLocationShare(request);
  res.json({
    success: true,
    message: 'Live location sharing stopped',
    data: { location: locationShareJSON(share) },
  });
});

export const updateRequest = asyncHandler(async (req, res) => {
  const body = req.body;
  const request = await ServiceRequest.findOne({
    where: { id: req.params.id, customerId: req.user.id },
  });
  if (!request) throw ApiError.notFound('Service request not found');
  if (WORK_STARTED_STATUSES.includes(request.status)) {
    throw ApiError.conflict('This request can no longer be changed because work has started');
  }
  if (!['pending', 'accepted'].includes(request.status)) {
    throw ApiError.conflict('Only pending or accepted requests can be updated');
  }

  const addressKeys = ['savedAddressId', 'address', 'city', 'lat', 'lng'];
  if (request.status === 'accepted') {
    const forbidden = [
      'categoryId',
      'applianceBrand',
      'applianceModel',
      'issueDescription',
      'urgency',
      ...addressKeys,
    ].filter((key) => body[key] !== undefined);
    if (forbidden.length) {
      throw ApiError.badRequest('Only the date and time slot can be changed after acceptance');
    }
  }

  if (body.categoryId) await assertCategory(body.categoryId);
  const updates = { ...body };
  delete updates.savedAddressId;
  if (updates.applianceBrand === '') updates.applianceBrand = null;
  if (updates.applianceModel === '') updates.applianceModel = null;

  const address = await resolveAddress(body, req.user.id, request);
  Object.assign(updates, address);
  delete updates.savedAddressId;

  const scheduleChanged =
    (body.preferredDate && body.preferredDate !== request.preferredDate) ||
    (body.timeSlot && body.timeSlot !== request.timeSlot);

  if (scheduleChanged) {
    await ensureNoScheduleConflict({
      technicianId: request.technicianId,
      preferredDate: body.preferredDate || request.preferredDate,
      timeSlot: body.timeSlot || request.timeSlot,
      excludeId: request.id,
    });
  }

  await sequelize.transaction(async (transaction) => {
    await request.update(updates, { transaction });
    if (scheduleChanged) {
      await RequestStatusHistory.create(
        {
          requestId: request.id,
          status: request.status,
          note: `Rescheduled to ${request.preferredDate} (${request.timeSlot})`,
          changedBy: req.user.id,
        },
        { transaction }
      );
    }
  });

  if (scheduleChanged && request.technicianId) {
    await safeNotify({
      userId: request.technicianId,
      type: 'schedule_changed',
      title: 'Customer rescheduled a job',
      body: `Request #${request.id} is now scheduled for ${request.preferredDate} (${request.timeSlot}).`,
      data: { url: `/requests/${request.id}`, requestId: request.id },
    });
  }

  const full = await loadRequest(request.id, req.user);
  res.json({
    success: true,
    message: scheduleChanged ? 'Schedule updated' : 'Request updated',
    data: { request: serializeRequest(full, req.user) },
  });
});

export const acceptRequest = asyncHandler(async (req, res) => {
  const profile = await TechnicianProfile.findOne({
    where: { userId: req.user.id },
    include: [
      { association: 'skills', through: { attributes: [] }, attributes: ['id'] },
      { association: 'areas', attributes: ['city'] },
    ],
  });
  if (!profile || profile.verificationStatus !== 'verified') {
    throw ApiError.forbidden('Only verified technicians can accept jobs');
  }
  if (!profile.isAvailable) throw ApiError.conflict('Turn on availability before accepting jobs');

  const request = await sequelize.transaction(async (transaction) => {
    const locked = await ServiceRequest.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!locked) throw ApiError.notFound('Service request not found');
    if (locked.status !== 'pending') {
      throw ApiError.conflict('This request is no longer open for acceptance');
    }
    if (locked.technicianId && Number(locked.technicianId) !== Number(req.user.id)) {
      throw ApiError.forbidden('This request was reserved for another technician');
    }

    const isDirect = Number(locked.technicianId) === Number(req.user.id);
    if (!isDirect) {
      const skillIds = (profile.skills || []).map((skill) => skill.id);
      const cities = (profile.areas || []).map((area) => area.city);
      if (!skillIds.includes(locked.categoryId)) {
        throw ApiError.forbidden('This job is outside your listed skills');
      }
      if (!cities.includes(locked.city)) {
        throw ApiError.forbidden('This job is outside your service areas');
      }
    }

    await ensureNoScheduleConflict({
      technicianId: req.user.id,
      preferredDate: locked.preferredDate,
      timeSlot: locked.timeSlot,
      excludeId: locked.id,
      transaction,
    });

    await locked.update(
      {
        technicianId: req.user.id,
        status: 'accepted',
        acceptedAt: new Date(),
      },
      { transaction }
    );
    await RequestStatusHistory.create(
      {
        requestId: locked.id,
        status: 'accepted',
        note: `${req.user.name} accepted the job`,
        changedBy: req.user.id,
      },
      { transaction }
    );
    return locked;
  });

  await safeNotify({
    userId: request.customerId,
    type: 'request_accepted',
    title: 'Your request was accepted',
    body: `${req.user.name} will handle your ${request.preferredDate} ${request.timeSlot} visit.`,
    data: { url: `/requests/${request.id}`, requestId: request.id },
  });
  await ensureRequestConversation(request).catch((error) => {
    console.error('Could not open request conversation:', error.message);
  });

  const full = await loadRequest(request.id, req.user);
  res.json({
    success: true,
    message: 'Job accepted',
    data: { request: serializeRequest(full, req.user) },
  });
});

export const declineRequest = asyncHandler(async (req, res) => {
  const request = await sequelize.transaction(async (transaction) => {
    const locked = await ServiceRequest.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!locked) throw ApiError.notFound('Service request not found');
    if (Number(locked.technicianId) !== Number(req.user.id)) {
      throw ApiError.forbidden('This job is not assigned to you');
    }
    if (!['pending', 'accepted'].includes(locked.status)) {
      throw ApiError.conflict('This job can no longer be declined because work has started');
    }

    await locked.update(
      {
        technicianId: null,
        status: 'pending',
        acceptedAt: null,
      },
      { transaction }
    );
    await RequestStatusHistory.create(
      {
        requestId: locked.id,
        status: 'pending',
        note: `${req.user.name} declined the job; it is open to other technicians${
          req.body.reason ? `: ${req.body.reason}` : ''
        }`,
        changedBy: req.user.id,
      },
      { transaction }
    );
    return locked;
  });

  await safeNotify({
    userId: request.customerId,
    type: 'request_declined',
    title: 'A technician declined the request',
    body: 'Your request is back on the job board so another verified technician can accept it.',
    data: { url: `/requests/${request.id}`, requestId: request.id },
  });

  const full = await loadRequest(request.id, req.user);
  res.json({
    success: true,
    message: 'Job declined and returned to the job board',
    data: { request: serializeRequest(full, req.user) },
  });
});

export const updateRequestStatus = asyncHandler(async (req, res) => {
  const body = req.body;
  const request = await sequelize.transaction(async (transaction) => {
    const locked = await ServiceRequest.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!locked) throw ApiError.notFound('Service request not found');
    if (Number(locked.technicianId) !== Number(req.user.id)) {
      throw ApiError.forbidden('This job is not assigned to you');
    }

    const allowed = STATUS_TRANSITIONS[locked.status] || [];
    if (!allowed.includes(body.status)) {
      throw ApiError.conflict(
        `A ${STATUS_LABELS[locked.status]} request cannot move to ${STATUS_LABELS[body.status]}`
      );
    }

    if (body.status === 'completed') {
      if (body.finalCost === undefined) {
        throw ApiError.badRequest('Enter the final cost before completing the job');
      }
      if (!(body.diagnosisNotes || locked.diagnosisNotes)) {
        throw ApiError.badRequest('Record diagnosis notes before completing the job');
      }
    }

    const updates = { status: body.status };
    if (body.diagnosisNotes) updates.diagnosisNotes = body.diagnosisNotes;
    if (body.partsUsed) updates.partsUsed = body.partsUsed;
    if (body.finalCost !== undefined) updates.finalCost = body.finalCost;
    if (body.status === 'completed') updates.completedAt = new Date();

    await locked.update(updates, { transaction });
    await RequestStatusHistory.create(
      {
        requestId: locked.id,
        status: body.status,
        note: body.note || DEFAULT_STATUS_NOTES[body.status],
        changedBy: req.user.id,
      },
      { transaction }
    );
    return locked;
  });

  const statusText = STATUS_LABELS[body.status] || body.status;
  if (body.status !== 'on_the_way') await stopActiveLocationShare(request);
  await safeNotify({
    userId: request.customerId,
    type: 'status_changed',
    title: body.status === 'completed' ? 'Your repair is complete' : 'Job status updated',
    body:
      body.status === 'completed'
        ? `Request #${request.id} was completed. Final cost: PHP ${Number(body.finalCost).toLocaleString('en-PH')}.`
        : `Request #${request.id} is now marked as ${statusText.toLowerCase()}.`,
    data: { url: `/requests/${request.id}`, requestId: request.id, status: body.status },
  });

  const full = await loadRequest(request.id, req.user);
  res.json({
    success: true,
    message: `Job marked as ${statusText.toLowerCase()}`,
    data: { request: serializeRequest(full, req.user) },
  });
});

export const cancelRequest = asyncHandler(async (req, res) => {
  const request = await sequelize.transaction(async (transaction) => {
    const locked = await ServiceRequest.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!locked) throw ApiError.notFound('Service request not found');

    if (req.user.role !== 'admin' && Number(locked.customerId) !== Number(req.user.id)) {
      throw ApiError.notFound('Service request not found');
    }
    if (req.user.role === 'admin') {
      if (['completed', 'cancelled'].includes(locked.status)) {
        throw ApiError.conflict('This request can no longer be cancelled');
      }
    } else if (!['pending', 'accepted'].includes(locked.status)) {
      throw ApiError.conflict('This request can no longer be cancelled');
    }

    await locked.update(
      {
        status: 'cancelled',
        cancellationReason: req.body.reason,
        cancelledBy: req.user.id,
      },
      { transaction }
    );
    await RequestStatusHistory.create(
      {
        requestId: locked.id,
        status: 'cancelled',
        note: `Cancelled by ${req.user.role === 'admin' ? 'admin' : 'customer'}: ${req.body.reason}`,
        changedBy: req.user.id,
      },
      { transaction }
    );
    return locked;
  });

  await stopActiveLocationShare(request);
  if (request.technicianId && Number(request.technicianId) !== Number(req.user.id)) {
    await safeNotify({
      userId: request.technicianId,
      type: 'system',
      title: 'A job was cancelled',
      body: `Request #${request.id} was cancelled by the customer.`,
      data: { url: `/requests/${request.id}`, requestId: request.id },
    });
  }

  const full = await loadRequest(request.id, req.user);
  res.json({
    success: true,
    message: 'Service request cancelled',
    data: { request: serializeRequest(full, req.user) },
  });
});

export const deleteRequest = asyncHandler(async (req, res) => {
  const request = await ServiceRequest.findByPk(req.params.id);
  if (!request) throw ApiError.notFound('Service request not found');
  if (req.user.role !== 'admin' && Number(request.customerId) !== Number(req.user.id)) {
    throw ApiError.notFound('Service request not found');
  }
  if (req.user.role !== 'admin' && request.status !== 'cancelled') {
    throw ApiError.badRequest('Only cancelled requests can be deleted');
  }
  await stopActiveLocationShare(request);
  await softDeleteRecord(request, req.user.id);
  res.json({ success: true, message: 'Service request deleted', data: null });
});