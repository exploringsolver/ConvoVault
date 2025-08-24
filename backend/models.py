from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List

Base = declarative_base()

# SQLAlchemy Models
class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    
    # Relationship to chats
    chats = relationship("Chat", back_populates="user")

class Chat(Base):
    __tablename__ = "chats"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Core chat data
    provider = Column(String, nullable=False, index=True)  # chatgpt, claude, perplexity, user
    title = Column(String, nullable=False)
    link = Column(String, nullable=False)
    
    # Optional metadata
    preview = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    last_message = Column(String, nullable=True)
    date = Column(String, nullable=True)  # Provider-specific date string
    
    # User organization
    category = Column(String, nullable=True, index=True)
    subject = Column(String, nullable=True, index=True)
    
    # System fields
    timestamp = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Unique constraint on provider + link per user
    __table_args__ = (
        UniqueConstraint('user_id', 'provider', 'link', name='unique_user_chat'),
    )
    
    # Relationship to user
    user = relationship("User", back_populates="chats")

# Pydantic Models for API
class ChatBase(BaseModel):
    provider: str = Field(..., description="AI provider: chatgpt, claude, perplexity, or user")
    title: str = Field(..., description="Chat title")
    link: str = Field(..., description="Chat URL")
    preview: Optional[str] = Field(None, description="Chat preview/summary")
    description: Optional[str] = Field(None, description="Chat description")
    last_message: Optional[str] = Field(None, description="Last message timestamp")
    date: Optional[str] = Field(None, description="Provider-specific date")
    category: Optional[str] = Field(None, description="User-assigned category")
    subject: Optional[str] = Field(None, description="User-assigned subject")
    timestamp: Optional[datetime] = Field(None, description="ISO timestamp when first seen")
    
class ChatCreate(ChatBase):
    pass

class ChatUpdate(BaseModel):
    title: Optional[str] = None
    preview: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    subject: Optional[str] = None

class ChatResponse(ChatBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime

    # Updated to modern Pydantic V2 style
    model_config = ConfigDict(from_attributes=True)

class UserBase(BaseModel):
    email: str = Field(..., description="User email address")

class UserCreate(UserBase):
    password: str = Field(..., min_length=6, description="Password (min 6 characters)")

class UserResponse(UserBase):
    id: int
    created_at: datetime
    is_active: bool

    # Updated to modern Pydantic V2 style
    model_config = ConfigDict(from_attributes=True)

class UserLogin(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

class SyncRequest(BaseModel):
    chats: List[ChatCreate] = Field(..., description="List of chats to sync")

class SyncResponse(BaseModel):
    message: str
    synced_count: int
    created_count: int
    updated_count: int

class ChatStats(BaseModel):
    total_chats: int
    by_provider: dict
    by_category: dict
    by_subject: dict
    recent_chats: List[ChatResponse]
