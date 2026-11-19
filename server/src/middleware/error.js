import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Something went wrong';
  let errors = error.errors;

  if (error instanceof multer.MulterError) {
    statusCode = 400;
    message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large'
        : error.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Too many or unexpected files'
          : error.message;
  } else if (error instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    errors = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  } else if (error.name === 'SequelizeUniqueConstraintError') {
    statusCode = 409;
    message = 'That record already exists';
    errors = error.errors?.map((item) => ({ path: item.path, message: item.message }));
  } else if (error.name === 'SequelizeValidationError') {
    statusCode = 400;
    message = 'Database validation failed';
    errors = error.errors?.map((item) => ({ path: item.path, message: item.message }));
  } else if (error.name === 'SequelizeForeignKeyConstraintError') {
    statusCode = 400;
    message = 'A related record is missing or still in use';
  }

  if (statusCode >= 500 && env.nodeEnv !== 'test') {
    console.error('[error]', error);
  }

  res.status(statusCode).json({
    success: false,
    message:
      env.nodeEnv === 'production' && statusCode >= 500 && !error.isOperational
        ? 'Internal server error'
        : message,
    ...(errors ? { errors } : {}),
  });
}