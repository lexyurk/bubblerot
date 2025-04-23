import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// Create bot with your token from BotFather
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Welcome message
bot.start((ctx) => ctx.reply('Send me a bubble (circular) video and I\'ll add a brainrot overlay to it!'));

// Helper function to process videos
async function processVideo(ctx, fileId, messageType) {
  try {
    // Let user know we're processing
    const processingMessage = await ctx.reply('Processing your video...');
    
    // Get file ID and download info
    const fileInfo = await ctx.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
    
    // Create unique filenames for this user/session
    const userId = ctx.from.id;
    const timestamp = Date.now();
    const inputFilePath = path.join('temp', `input_${userId}_${timestamp}.mp4`);
    const outputFilePath = path.join('temp', `output_${userId}_${timestamp}.mp4`);
    
    // Ensure temp directory exists
    if (!fs.existsSync('temp')) {
      fs.mkdirSync('temp');
    }
    
    // Download the video file
    const download = spawn('curl', ['-o', inputFilePath, fileUrl]);
    
    // When download is complete, process the video
    download.on('close', async (code) => {
      if (code !== 0) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, 
          processingMessage.message_id, 
          null, 
          'Error downloading your video.'
        );
        return;
      }
      
      // Process the video with our overlay generator
      const processor = spawn('node', ['generateOverlay.js', inputFilePath, outputFilePath]);
      
      processor.stderr.on('data', (data) => {
        console.log(`Processing log: ${data}`);
      });
      
      processor.on('close', async (code) => {
        try {
          if (code !== 0) {
            await ctx.telegram.editMessageText(
              ctx.chat.id, 
              processingMessage.message_id, 
              null, 
              'Error processing your video.'
            );
            return;
          }
          
          // Send processed video back to user
          await ctx.telegram.editMessageText(
            ctx.chat.id, 
            processingMessage.message_id, 
            null, 
            'Here\'s your processed video!'
          );
          
          // Send as video note if original was a video note, otherwise as regular video
          if (messageType === 'video_note') {
            await ctx.replyWithVideoNote({ source: outputFilePath });
          } else {
            await ctx.replyWithVideo({ source: outputFilePath });
          }
          
          // Clean up temporary files immediately after sending
          try {
            fs.unlinkSync(inputFilePath);
            fs.unlinkSync(outputFilePath);
            console.log(`Cleaned up temporary files for user ${userId}`);
          } catch (err) {
            console.error('Error cleaning up files:', err);
          }
          
        } catch (error) {
          console.error('Error sending processed video:', error);
          await ctx.reply('Sorry, there was an error sending your processed video.');
        }
      });
    });
    
    download.on('error', async (err) => {
      console.error('Download error:', err);
      await ctx.reply('Sorry, there was an error downloading your video.');
    });
    
  } catch (error) {
    console.error('Error handling video:', error);
    await ctx.reply('Sorry, something went wrong while processing your video.');
  }
}

// Handler for regular video messages
bot.on(message('video'), async (ctx) => {
  await processVideo(ctx, ctx.message.video.file_id, 'video');
});

// Handler for bubble videos (video notes)
bot.on(message('video_note'), async (ctx) => {
  await processVideo(ctx, ctx.message.video_note.file_id, 'video_note');
});

// Launch the bot
bot.launch().then(() => {
  console.log('Bot is running!');
}).catch((err) => {
  console.error('Error starting bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 