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
async function processVideo(ctx, fileId, messageType, deleteOriginal = false) {
  try {
    // Store the original message ID if we need to delete it
    const originalMessageId = deleteOriginal ? ctx.message.message_id : null;
    
    // Skip sending "Processing your video..." message if deleteOriginal is true
    let processingMessage = null;
    if (!deleteOriginal) {
      processingMessage = await ctx.reply('Processing your video...');
    }
    
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
        if (processingMessage) {
          await ctx.telegram.editMessageText(
            ctx.chat.id, 
            processingMessage.message_id, 
            null, 
            'Error downloading your video.'
          );
        }
        return;
      }
      
      // Process the video with retries
      await processVideoWithRetries(
        inputFilePath,
        outputFilePath,
        async (success) => {
          try {
            if (!success) {
              if (processingMessage) {
                await ctx.telegram.editMessageText(
                  ctx.chat.id, 
                  processingMessage.message_id, 
                  null, 
                  'Error processing your video.'
                );
              }
              return;
            }
            
            // Update processing message if we're not deleting the original
            if (processingMessage) {
              await ctx.telegram.editMessageText(
                ctx.chat.id, 
                processingMessage.message_id, 
                null, 
                'Here\'s your processed video!'
              );
            }
            
            // Delete the original message if requested
            if (deleteOriginal && originalMessageId) {
              try {
                await ctx.telegram.deleteMessage(ctx.chat.id, originalMessageId);
              } catch (deleteError) {
                console.error('Error deleting original message:', deleteError);
                // Continue with the rest of the processing regardless
              }
            }
            
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
            if (!deleteOriginal) {
              await ctx.reply('Sorry, there was an error sending your processed video.');
            }
          }
        }
      );
    });
    
    download.on('error', async (err) => {
      console.error('Download error:', err);
      if (!deleteOriginal) {
        await ctx.reply('Sorry, there was an error downloading your video.');
      }
    });
    
  } catch (error) {
    console.error('Error handling video:', error);
    if (!deleteOriginal) {
      await ctx.reply('Sorry, something went wrong while processing your video.');
    }
  }
}

// Helper function to process video with retries
async function processVideoWithRetries(inputFilePath, outputFilePath, callback, retryCount = 0) {
  const MAX_RETRIES = 2;
  
  return new Promise((resolve) => {
    // Process the video with our overlay generator
    const processor = spawn('node', ['generateOverlay.js', inputFilePath, outputFilePath]);
    
    processor.stderr.on('data', (data) => {
      console.log(`Processing log (attempt ${retryCount + 1}): ${data}`);
    });
    
    processor.on('close', async (code) => {
      if (code !== 0) {
        console.log(`Processing failed on attempt ${retryCount + 1}`);
        
        if (retryCount < MAX_RETRIES) {
          console.log(`Retrying... Attempt ${retryCount + 2}`);
          // Retry processing without notifying the user
          return resolve(processVideoWithRetries(inputFilePath, outputFilePath, callback, retryCount + 1));
        } else {
          console.log(`All ${MAX_RETRIES + 1} attempts failed, giving up`);
          // All retries failed
          await callback(false);
          return resolve();
        }
      }
      
      // Processing succeeded
      console.log('Processing succeeded');
      await callback(true);
      resolve();
    });
  });
}

// Handler for regular video messages
bot.on(message('video'), async (ctx) => {
  // Process normal videos with the regular flow (with text messages)
  await processVideo(ctx, ctx.message.video.file_id, 'video');
});

// Handler for bubble videos (video notes)
bot.on(message('video_note'), async (ctx) => {
  // Check if message is from a group
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  
  if (isGroup) {
    // In groups: delete original and don't send text messages
    await processVideo(ctx, ctx.message.video_note.file_id, 'video_note', true);
  } else {
    // In private chats: use the regular flow with text messages
    await processVideo(ctx, ctx.message.video_note.file_id, 'video_note');
  }
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