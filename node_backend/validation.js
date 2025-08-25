const Joi = require('joi');

// User validation schemas
const userCreateSchema = Joi.object({
  email: Joi.string().email().required().description('User email address'),
  password: Joi.string().min(6).required().description('Password (min 6 characters)')
});

const userLoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Chat validation schemas
const chatCreateSchema = Joi.object({
  provider: Joi.string().valid('chatgpt', 'claude', 'perplexity', 'user').required().description('AI provider'),
  title: Joi.string().required().description('Chat title'),
  link: Joi.string().required().description('Chat URL'),
  preview: Joi.string().allow(null, '').optional().description('Chat preview/summary'),
  description: Joi.string().allow(null, '').optional().description('Chat description'),
  lastMessage: Joi.string().allow(null, '').optional().description('Last message timestamp'),
  date: Joi.string().allow(null, '').optional().description('Provider-specific date'),
  category: Joi.string().allow(null, '').optional().description('User-assigned category'),
  subject: Joi.string().allow(null, '').optional().description('User-assigned subject'),
  timestamp: Joi.date().optional().description('ISO timestamp when first seen')
});

const chatUpdateSchema = Joi.object({
  title: Joi.string().optional(),
  preview: Joi.string().allow(null, '').optional(),
  description: Joi.string().allow(null, '').optional(),
  category: Joi.string().allow(null, '').optional(),
  subject: Joi.string().allow(null, '').optional()
});

const syncRequestSchema = Joi.object({
  chats: Joi.array().items(chatCreateSchema).required().description('List of chats to sync')
});

// Validation middleware
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        detail: error.details[0].message
      });
    }
    next();
  };
};

// Query parameter validation
const validateQueryParams = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        detail: error.details[0].message
      });
    }
    next();
  };
};

const chatQuerySchema = Joi.object({
  provider: Joi.string().optional(),
  category: Joi.string().optional(),
  subject: Joi.string().optional(),
  limit: Joi.number().integer().min(1).max(1000).default(100),
  offset: Joi.number().integer().min(0).default(0)
});

const searchQuerySchema = Joi.object({
  q: Joi.string().required().min(1)
});

module.exports = {
  userCreateSchema,
  userLoginSchema,
  chatCreateSchema,
  chatUpdateSchema,
  syncRequestSchema,
  chatQuerySchema,
  searchQuerySchema,
  validate,
  validateQueryParams
};