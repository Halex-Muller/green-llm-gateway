import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const ENV = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  HOST: process.env.HOST || '0.0.0.0',
  UPSTREAM_API_URL: process.env.UPSTREAM_API_URL || 'https://api.openai.com/v1',
  UPSTREAM_API_KEY: process.env.UPSTREAM_API_KEY || '',
};
