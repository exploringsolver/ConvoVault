const { Sequelize } = require('sequelize');
require('dotenv').config();

// Database configuration
const DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./chatsync.db';

// Create Sequelize instance
const sequelize = new Sequelize(DATABASE_URL, {
  logging: false, // Set to console.log to see SQL queries
  dialect: DATABASE_URL.includes('sqlite') ? 'sqlite' : 'postgres',
  dialectOptions: DATABASE_URL.includes('sqlite') ? {
    // SQLite specific options
  } : {},
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// Test database connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
  }
};

// Create tables
const createTables = async () => {
  try {
    await sequelize.sync({ alter: true });
    console.log('✅ Database tables created/updated successfully.');
  } catch (error) {
    console.error('❌ Error creating database tables:', error);
  }
};

// Initialize database
const initDatabase = async () => {
  await testConnection();
  await createTables();
};

// Graceful shutdown
const closeDatabase = async () => {
  try {
    await sequelize.close();
    console.log('✅ Database connection closed.');
  } catch (error) {
    console.error('❌ Error closing database:', error);
  }
};

module.exports = {
  sequelize,
  testConnection,
  createTables,
  initDatabase,
  closeDatabase
};