const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('./models');

// Security configuration
const SECRET_KEY = process.env.SECRET_KEY || 'your-secret-key-change-this-in-production';
const ALGORITHM = 'HS256';
const ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7; // 1 week

// Password hashing
const verifyPassword = async (plainPassword, hashedPassword) => {
  return await bcrypt.compare(plainPassword, hashedPassword);
};

const getPasswordHash = async (password) => {
  return await bcrypt.hash(password, 12);
};

// Token management
const createAccessToken = (data, expiresIn = `${ACCESS_TOKEN_EXPIRE_HOURS}h`) => {
  return jwt.sign(data, SECRET_KEY, { 
    algorithm: ALGORITHM, 
    expiresIn 
  });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, SECRET_KEY, { algorithms: [ALGORITHM] });
  } catch (error) {
    return null;
  }
};

// User management
const getUserByEmail = async (email) => {
  return await User.findOne({ where: { email } });
};

const getUserById = async (userId) => {
  return await User.findByPk(userId);
};

const authenticateUser = async (email, password) => {
  const user = await getUserByEmail(email);
  if (!user) {
    return null;
  }
  
  const isValidPassword = await verifyPassword(password, user.hashedPassword);
  if (!isValidPassword) {
    return null;
  }
  
  return user;
};

const createUser = async (email, password) => {
  const hashedPassword = await getPasswordHash(password);
  const user = await User.create({
    email,
    hashedPassword
  });
  return user;
};

// Middleware for authentication
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const payload = verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }

    const userId = payload.sub;
    if (!userId) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }

    const user = await getUserById(userId);
    if (!user) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        detail: 'Inactive user'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      detail: 'Could not validate credentials'
    });
  }
};

module.exports = {
  verifyPassword,
  getPasswordHash,
  createAccessToken,
  verifyToken,
  getUserByEmail,
  getUserById,
  authenticateUser,
  createUser,
  authenticate
};