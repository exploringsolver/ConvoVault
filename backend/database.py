from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from databases import Database
import os
from models import Base

# Database configuration
DATABASE_URL = os.getenv("sqlite:///./chatsync.db")

# Create database engine
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create async database instance
database = Database(DATABASE_URL)

# Create tables
def create_tables():
    Base.metadata.create_all(bind=engine)

# Dependency to get database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Async database connection management
async def connect_database():
    await database.connect()

async def disconnect_database():
    await database.disconnect()
