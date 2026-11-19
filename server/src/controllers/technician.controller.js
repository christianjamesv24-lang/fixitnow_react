import { Op } from 'sequelize';
import fs from 'node:fs/promises';
import path from 'node:path';
import sequelize from '../config/db.js';
import {
  ServiceCategory,
  TechnicianArea,
  TechnicianDocument,
  TechnicianProfile,
  TechnicianSkill,
  Review,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getPagination, pagedData } from '../utils/pagination.js';
import { replaceAreas, replaceAvailability, assertCategoriesExist } from '../services/auth.service.js';
import { DOCUMENT_TYPES } from '../utils/constants.js';
import { SERVICE_AREAS } from '../utils/serviceArea.js';
import { broadcast } from '../sockets/registry.js';

const directoryInclude = [
  {
    association: 'user',
    attributes: ['id', 'name', 'avatarUrl', 'lastActiveAt', 'createdAt'],
    where: { isActive: true },
  },
  { association: 'skills', through: { attributes: [] } },
  { association: 'areas' },
];

function publicProfileJSON(profile) {
  const json = profile.toJSON();
  if (json.user) json.name = json.user.name;
  return json;
}

export const listTechnicians = asyncHandler(async (req, res) => {
  const query = req.validatedQuery;
  const { page, limit, offset } = getPagination(query, 12);
  const where = { verificationStatus: 'verified', isAvailable: true };
  if (query.featured === 'true') where.featured = true;
  if (query.minRating) where.avgRating = { [Op.gte]: query.minRating };

  const matchingAreas = await TechnicianArea.findAll({
    attributes: ['technicianProfileId'],
    where: query.city ? { city: query.city } : { city: { [Op.in]: SERVICE_AREAS } },
    group: ['technicianProfileId'],
    raw: true,
  });
  where.id = { [Op.in]: matchingAreas.map((area) => area.technicianProfileId) };

  const include = directoryInclude.map((item) => ({ ...item }));
  const userInclude = include[0];
  if (query.q) userInclude.where = { ...userInclude.where, name: { [Op.like]: `%${query.q}%` } };
  userInclude.required = true;

  const skillInclude = include[1];
  if (query.categoryId) {
    skillInclude.where = { id: query.categoryId };
    skillInclude.required = true;
  }

  const areaInclude = include[2];
  areaInclude.where = { city: { [Op.in]: SERVICE_AREAS } };
  areaInclude.separate = true;

  const order =
    query.sort === 'newest'
      ? [['createdAt', 'DESC']]
      : query.sort === 'jobs'
        ? [['reviewCount', 'DESC']]
        : [
            ['avgRating', 'DESC'],
            ['reviewCount', 'DESC'],
          ];

  const { count, rows } = await TechnicianProfile.findAndCountAll({
    where,
    include,
    order,
    limit,
    offset,
    distinct: true,
    subQuery: false,
  });

  let items = rows.map(publicProfileJSON);

  res.json({
    success: true,
    message: 'OK',
    data: pagedData(items, count, page, limit),
  });
});

export const getPublicTechnician = asyncHandler(async (req, res) => {
  const profile = await TechnicianProfile.findOne({
    where: { userId: req.params.id },
    include: [
      {
        association: 'user',
        attributes: ['id', 'name', 'avatarUrl', 'lastActiveAt', 'createdAt'],
        where: { isActive: true },
      },
      { association: 'skills', through: { attributes: [] } },
      { association: 'areas', where: { city: { [Op.in]: SERVICE_AREAS } }, required: true },
      { association: 'availability', where: { isActive: true }, required: false },
    ],
  });
  if (!profile) throw ApiError.notFound('Technician not found');
  if (profile.verificationStatus !== 'verified' && req.user?.role !== 'admin') {
    throw ApiError.notFound('Technician not found');
  }
  res.json({ success: true, message: 'OK', data: { profile: publicProfileJSON(profile) } });
});

export const getMyTechnicianProfile = asyncHandler(async (req, res) => {
  if (req.user.role !== 'technician') throw ApiError.forbidden('Technician account required');
  const profile = await TechnicianProfile.findOne({
    where: { userId: req.user.id },
    include: [
      { association: 'skills', through: { attributes: [] } },
      { association: 'areas' },
      { association: 'availability' },
      { association: 'documents' },
    ],
  });
  res.json({ success: true, message: 'OK', data: { profile } });
});

export const updateMyTechnicianProfile = asyncHandler(async (req, res) => {
  if (req.user.role !== 'technician') throw ApiError.forbidden('Technician account required');
  const profile = await TechnicianProfile.findOne({ where: { userId: req.user.id } });
  if (!profile) throw ApiError.notFound('Technician profile not found');

  const { skillCategoryIds, cities, availability, ...fields } = req.body;
  await assertCategoriesExist(skillCategoryIds);

  const transaction = await sequelize.transaction();
  try {
    await profile.update(fields, { transaction });
    if (skillCategoryIds) {
      await TechnicianSkill.destroy({
        where: { technicianProfileId: profile.id },
        transaction,
      });
      if (skillCategoryIds.length) {
        await TechnicianSkill.bulkCreate(
          [...new Set(skillCategoryIds)].map((categoryId) => ({
            technicianProfileId: profile.id,
            categoryId,
          })),
          { transaction }
        );
      }
    }
    await replaceAreas(profile.id, cities, req.user.id);
    await replaceAvailability(profile.id, availability, req.user.id);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  const refreshed = await TechnicianProfile.findByPk(profile.id, {
    include: [
      { association: 'skills', through: { attributes: [] } },
      { association: 'areas' },
      { association: 'availability' },
    ],
  });
  broadcast('technician:updated', { profileId: profile.id, userId: req.user.id });
  res.json({ success: true, message: 'Profile updated', data: { profile: refreshed } });
});

export const submitTechnicianDocument = asyncHandler(async (req, res) => {
  const profile = await TechnicianProfile.findOne({ where: { userId: req.user.id } });
  if (!profile) {
    if (req.file) {
      await fs.unlink(req.file.path).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    throw ApiError.notFound('Technician profile not found');
  }
  if (!req.file) throw ApiError.badRequest('Choose a document to upload');

  const type = req.validatedQuery.type;
  if (!DOCUMENT_TYPES.includes(type)) {
    await fs.unlink(req.file.path).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    throw ApiError.badRequest('Choose a valid document type');
  }

  const transaction = await sequelize.transaction();
  let document;
  try {
    const previousDocuments = await TechnicianDocument.findAll({
      where: { technicianProfileId: profile.id, type },
      transaction,
    });
    for (const previous of previousDocuments) {
      await previous.destroy({ transaction });
    }

    document = await TechnicianDocument.create(
      {
        technicianProfileId: profile.id,
        type,
        filePath: `documents/${path.basename(req.file.path)}`,
        originalName: req.file.originalname.slice(0, 255),
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
      },
      { transaction }
    );
    await profile.update(
      {
        verificationStatus: 'pending',
        verificationNote: null,
        submittedAt: new Date(),
        verifiedAt: null,
        verifiedBy: null,
      },
      { transaction }
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    await fs.unlink(req.file.path).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }

  res.status(201).json({
    success: true,
    message: 'Document submitted for review',
    data: {
      document: {
        id: document.id,
        type: document.type,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        createdAt: document.createdAt,
      },
    },
  });
});

export const listTechnicianReviews = asyncHandler(async (req, res) => {
  const technician = await TechnicianProfile.findOne({
    where: { userId: req.params.id, verificationStatus: 'verified' },
  });
  if (!technician) throw ApiError.notFound('Technician not found');

  const { page, limit, offset } = getPagination(req.query, 6);
  const { count, rows } = await Review.findAndCountAll({
    where: { technicianId: req.params.id, isHidden: false },
    include: [
      {
        association: 'customer',
        attributes: ['id', 'name', 'avatarUrl'],
      },
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
    distinct: true,
  });

  res.json({
    success: true,
    message: 'OK',
    data: {
      ...pagedData(rows, count, page, limit),
      summary: {
        avgRating: technician.avgRating,
        reviewCount: technician.reviewCount,
        ratingDistribution: technician.ratingDistribution,
      },
    },
  });
});

export const getFilterMeta = asyncHandler(async (req, res) => {
  const categories = await ServiceCategory.findAll({
    where: { isActive: true },
    order: [['sortOrder', 'ASC']],
    attributes: ['id', 'name', 'slug', 'icon', 'isPopular'],
  });
  res.json({
    success: true,
    message: 'OK',
    data: { categories, cities: SERVICE_AREAS },
  });
});