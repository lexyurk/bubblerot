FROM node:18-slim

# Install FFmpeg and other dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Create temp directory for video processing
RUN mkdir -p temp && chmod 777 temp

# Set environment variable for bot token (will be overridden at runtime)
ENV TELEGRAM_BOT_TOKEN=""

# Run the bot
CMD ["npm", "start"] 