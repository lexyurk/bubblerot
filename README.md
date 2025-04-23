# Brainrot Bubble Generator Bot

A Telegram bot that adds animated "brainrot" overlays to videos, creating an engaging visual effect with spinning rings and a bouncing ball.

## Requirements

- Node.js 16+ 
- FFmpeg installed and available in PATH
- Telegram Bot Token from BotFather

## Setup

### Standard Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Set your Telegram bot token as an environment variable:
   ```
   export TELEGRAM_BOT_TOKEN=your_bot_token_here
   ```

3. Start the bot:
   ```
   npm start
   ```

### Docker Setup (Recommended for Deployment)

1. Set your Telegram bot token as an environment variable:
   ```
   export TELEGRAM_BOT_TOKEN=your_bot_token_here
   ```

2. Build and start the Docker container:
   ```
   docker-compose up -d
   ```

3. View logs:
   ```
   docker-compose logs -f
   ```

## Resource Requirements

The bot requires these approximate resources:
- CPU: 1 core (more for faster processing)
- RAM: 1GB minimum
- Storage: Depends on video traffic, but at least 1GB for temporary files
- Network: Sufficient bandwidth for video uploads/downloads

## How to Use

1. Start a chat with your bot on Telegram
2. Send either:
   - A video note (circular bubble video) - record by holding the microphone button in Telegram
   - OR a regular video
3. The bot will process the video, adding the animated overlay
4. The processed video will be sent back to you in the same format you sent it

## Technical Details

- The bot uses the `telegraf` library to handle Telegram interactions
- Both regular videos and video notes (bubble videos) are supported
- Video processing is done with the existing `generateOverlay.js` script
- Temporary files are stored in a `temp` folder and cleaned up after processing

## Customization

You can adjust the overlay animation parameters in `generateOverlay.js`:
- `RING_COUNT`: Number of spinning rings
- `RING_WIDTH`: Thickness of rings
- `BALL_SPEED`: Speed of the bouncing ball
- `BOUNCE_RANDOMNESS`: Randomness factor for ball bounces 