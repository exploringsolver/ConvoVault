const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Import modules
const { initDatabase, closeDatabase } = require('./database');
const { User, Chat } = require('./models');
const { 
  authenticate, 
  getUserByEmail, 
  authenticateUser, 
  createUser, 
  createAccessToken 
} = require('./auth');
const { 
  validate, 
  validateQueryParams,
  userCreateSchema, 
  userLoginSchema, 
  chatCreateSchema, 
  chatUpdateSchema, 
  syncRequestSchema,
  chatQuerySchema,
  searchQuerySchema
} = require('./validation');
const { categorizeChatWithAI } = require('./aiService');
const { Op } = require('sequelize');

// Initialize Express app
const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: '*', // In production, specify exact origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Authentication endpoints
app.post('/api/auth/register', validate(userCreateSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        detail: 'Email already registered'
      });
    }
    
    // Create new user
    const user = await createUser(email, password);
    res.json({
      message: 'User created successfully',
      user_id: user.id
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      detail: 'Internal server error'
    });
  }
});

app.post('/api/auth/login', validate(userLoginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Authenticate user
    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({
        detail: 'Invalid email or password'
      });
    }
    
    // Create access token
    const accessToken = createAccessToken({ sub: user.id.toString() });
    
    res.json({
      access_token: accessToken,
      token_type: 'bearer',
      user: {
        id: user.id,
        email: user.email,
        created_at: user.createdAt,
        is_active: user.isActive
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      detail: 'Internal server error'
    });
  }
});

// Chat endpoints
app.get('/api/chats', authenticate, validateQueryParams(chatQuerySchema), async (req, res) => {
  try {
    const { provider, category, subject, limit = 100, offset = 0 } = req.query;
    const userId = req.user.id;
    
    // Build query conditions
    const where = { userId };
    if (provider) where.provider = provider;
    if (category) where.category = category;
    if (subject) where.subject = subject;
    
    const chats = await Chat.findAll({
      where,
      order: [['updatedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json(chats);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({
      detail: 'Internal server error'
    });
  }
});

app.post('/api/chats', authenticate, validate(chatCreateSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const chatData = req.body;
    
    // Check if chat already exists for this user
    const existingChat = await Chat.findOne({
      where: {
        userId,
        provider: chatData.provider,
        link: chatData.link
      }
    });
    
    if (existingChat) {
      // Update existing chat
      const updateData = { ...chatData };
      delete updateData.timestamp; // Don't update timestamp
      
      await existingChat.update(updateData);
      await existingChat.reload();
      return res.json(existingChat);
    }
    
    // Create new chat
    const chat = await Chat.create({
      userId,
      ...chatData
    });
    
    res.json(chat);
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({
      detail: 'Internal server error'
    });
  }
});

app.put('/api/chats/:chatId', authenticate, validate(chatUpdateSchema), async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    const updateData = req.body;
    
    const chat = await Chat.findOne({
      where: {
        id: chatId,
        userId
      }
    });
    
    if (!chat) {
      return res.status(404).json({
        detail: 'Chat not found'
      });
    }
    
    await chat.update(updateData);
    await chat.reload();
    
    res.json(chat);
  } catch (error) {
    console.error('Update chat error:', error);
    res.status(500).json({
      detail: 'Internal server error'
    });
  }
});

app.delete('/api/chats/:chatId', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    
    const chat = await Chat.findOne({
      where: {
        id: chatId,
        userId
      }
    });
    
    if (!chat) {
      return res.status(404).json({
        detail: 'Chat not found'
      });
    }
    
    await chat.destroy();
    
    res.json({
      message: 'Chat deleted successfully'
    });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({
      detail: 'Internal server error'
    });
  }
});

app.post('/api/sync', authenticate, validate(syncRequestSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { chats } = req.body;
    
    let createdCount = 0;
    let updatedCount = 0;
    
    for (const chatData of chats) {
      const existingChat = await Chat.findOne({
        where: {
          userId,
          provider: chatData.provider,
          link: chatData.link
        }
      });
      
      if (existingChat) {
        // Update existing chat (preserve user-set category/subject)
        const updateData = { ...chatData };
        delete updateData.timestamp;
        
        if (existingChat.category && existingChat.category !== 'General') {
          delete updateData.category;
        }
        if (existingChat.subject && existingChat.subject !== 'Other') {
          delete updateData.subject;
        }
        
        await existingChat.update(updateData);
        updatedCount++;
      } else {
        // Create new chat with AI categorization
        const newChatData = { ...chatData };
        
        // Parse timestamp if it's a string
        if (typeof newChatData.timestamp === 'string') {
          try {
            newChatData.timestamp = new Date(newChatData.timestamp);
          } catch (error) {
            newChatData.timestamp = new Date();
          }
        } else if (!newChatData.timestamp) {
          newChatData.timestamp = new Date();
        }
        
        // Auto-categorize if not already categorized
        if (!newChatData.category || !newChatData.subject) {
          const [category, subject] = await categorizeChatWithAI(
            newChatData.title,
            newChatData.preview,
            newChatData.description
          );
          
          if (!newChatData.category) {
            newChatData.category = category;
          }
          if (!newChatData.subject) {
            newChatData.subject = subject;
          }
        }
        
        await Chat.create({
          userId,
          ...newChatData
        });
        createdCount++;
      }
    }
    
    res.json({
      message: `Sync completed: ${createdCount} created, ${updatedCount} updated`,
      synced_count: chats.length,
      created_count: createdCount,
      updated_count: updatedCount
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({
      detail: 'Internal server error'
    });
  }
});

app.get('/api/stats', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all user chats
    const chats = await Chat.findAll({
      where: { userId }
    });
    
    // Calculate statistics
    const totalChats = chats.length;
    const byProvider = {};
    const byCategory = {};
    const bySubject = {};
    
    chats.forEach(chat => {
      // Provider stats
      byProvider[chat.provider] = (byProvider[chat.provider] || 0) + 1;
      
      // Category stats
      const category = chat.category || 'Uncategorized';
      byCategory[category] = (byCategory[category] || 0) + 1;
      
      // Subject stats
      const subject = chat.subject || 'General';
      bySubject[subject] = (bySubject[subject] || 0) + 1;
    });
    
    // Get recent chats (last 10)
    const recentChats = await Chat.findAll({
      where: { userId },
      order: [['updatedAt', 'DESC']],
      limit: 10
    });
    
    res.json({
      total_chats: totalChats,
      by_provider: byProvider,
      by_category: byCategory,
      by_subject: bySubject,
      recent_chats: recentChats
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      detail: 'Internal server error'
    });
    }
});
// Search chats endpoint
app.get('/api/search', authenticate, validateQueryParams(searchQuerySchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { q } = req.query;

    // Build search term with wildcards
    const searchTerm = `%${q}%`;

    const chats = await Chat.findAll({
      where: {
        userId,
        [Op.or]: [
          { title: { [Op.iLike]: searchTerm } },
          { preview: { [Op.iLike]: searchTerm } },
          { description: { [Op.iLike]: searchTerm } }
        ]
      },
      order: [['updatedAt', 'DESC']]
    });

    res.json(chats);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      detail: 'Internal server error'
    });
  }
});
// Start server
const PORT = process.env.PORT || 3000;
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(error => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await closeDatabase();
  process.exit(0);
});