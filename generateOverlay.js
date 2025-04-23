/*
Generate MP4 with animated overlay on top of an input Telegram bubble mp4.
Usage: node generateOverlay.js input.mp4 output.mp4
*/

import { createCanvas } from '@napi-rs/canvas';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const [,, inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node generateOverlay.js input.mp4 output.mp4');
  process.exit(1);
}

function probeVideo(path) {
  const res = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,r_frame_rate:format=duration', '-of', 'json', path], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error('ffprobe failed', res.stderr);
    process.exit(1);
  }
  const info = JSON.parse(res.stdout);
  const stream = info.streams[0];
  const [num, den] = stream.r_frame_rate.split('/').map(Number);
  return {
    width: stream.width,
    height: stream.height,
    fps: den ? num / den : 30,
    duration: parseFloat(info.format.duration)
  };
}

const meta = probeVideo(inputPath);
const WIDTH = meta.width;
const HEIGHT = meta.height;
const FPS = Math.round(meta.fps);

// Re‑compute animation constants based on size
const SHORTER = Math.min(WIDTH, HEIGHT);
const RING_COUNT = 25;
const BASE_RING_RADIUS = SHORTER * 0.08;
const RING_SPACING = SHORTER * 0.016;
const RING_WIDTH = SHORTER * 0.008;
const HOLE_ARC = Math.PI / 3;
const BALL_RADIUS = SHORTER * 0.01;
const BALL_SPEED = SHORTER * 0.5;
const SUB_STEPS = 2;
const BOUNCE_RANDOMNESS = 0.2;

function rand(min, max) { return Math.random()*(max-min)+min; }

const rings = [];
function initializeRings() {
  rings.length = 0;
  for (let i=0;i<RING_COUNT;i++) {
    rings.push({
      radius: BASE_RING_RADIUS + i*RING_SPACING,
      width: RING_WIDTH,
      holeSize: HOLE_ARC,
      angle: rand(0, Math.PI*2),
      speed: (i%2===0?1:-1) * rand(0.3, 0.8),
      color: `hsla(${i * 360 / RING_COUNT}, 75%, 65%, 0.65)`,
      visible: true
    });
  }
}

const ball = {x: WIDTH/2, y: HEIGHT/2, radius: BALL_RADIUS, vx: rand(-1,1)*BALL_SPEED, vy: rand(-1,1)*BALL_SPEED};

function resetBall() {
  ball.x = WIDTH/2; ball.y=HEIGHT/2;
  const angle = rand(0,Math.PI*2);
  ball.vx = Math.cos(angle)*BALL_SPEED;
  ball.vy = Math.sin(angle)*BALL_SPEED;
  rings.forEach(r => r.visible = true);
}

function update(dt) {
  // Update ring rotations
  rings.forEach(r=> r.angle += r.speed*dt);
  
  // Divide the time step into smaller substeps for more accurate collision detection
  const subDt = dt / SUB_STEPS;
  
  for (let step = 0; step < SUB_STEPS; step++) {
    // Save previous position for line segment intersection tests
    const prevX = ball.x;
    const prevY = ball.y;
    
    // Update ball position for this substep
    ball.x += ball.vx * subDt;
    ball.y += ball.vy * subDt;
    
    const cx = WIDTH/2, cy=HEIGHT/2;
    let dx = ball.x-cx, dy = ball.y-cy;
    let dist = Math.hypot(dx,dy);
    
    let hasCollided = false; // Track if a collision happened in this substep
    
    for (const ring of rings) {
      if (!ring.visible) continue;
      
      const ringInnerRadius = ring.radius - ring.width / 2;
      const ringOuterRadius = ring.radius + ring.width / 2;
      const ballCollisionZoneInner = ringInnerRadius - ball.radius;
      const ballCollisionZoneOuter = ringOuterRadius + ball.radius;
      
      // STEP 1: Check if ball's current position is in collision zone
      const inCollisionZone = (dist >= ballCollisionZoneInner && dist <= ballCollisionZoneOuter);
      
      // STEP 2: If not in zone now, check if ball path crossed the ring boundaries
      const prevDx = prevX - cx;
      const prevDy = prevY - cy;
      const prevDist = Math.hypot(prevDx, prevDy);
      
      // Ball path crossed into or out of the ring's radial boundaries?
      const crossedRingBoundary = 
        (prevDist < ballCollisionZoneInner && dist >= ballCollisionZoneInner) ||
        (prevDist > ballCollisionZoneOuter && dist <= ballCollisionZoneOuter) ||
        (prevDist >= ballCollisionZoneInner && prevDist <= ballCollisionZoneOuter);
      
      if (inCollisionZone || crossedRingBoundary) {
        // Current angle relative to ring's rotation
        let rel = Math.atan2(dy,dx) - ring.angle;
        rel = (rel + Math.PI * 2) % (Math.PI * 2);
        
        // Calculate the angular width of the ball at this distance (with safety margin)
        const safetyMargin = 1.1; // Slightly increase the effective ball radius
        const angularBallRadius = Math.asin(Math.min(0.99, (ball.radius * safetyMargin) / (dist + 1e-6)));
        
        // Define the angles that mark the solid part of the ring
        const solidPartStartAngle = (ring.holeSize / 2) + angularBallRadius;
        const solidPartEndAngle = (Math.PI * 2 - ring.holeSize / 2) - angularBallRadius;
        
        if (rel > solidPartStartAngle && rel < solidPartEndAngle) {
          // COLLISION DETECTED - Bounce logic
          hasCollided = true;
                    
          // Calculate reflection normal (from center to ball)
          const nx = dx/dist, ny = dy/dist;
          const dot = ball.vx*nx + ball.vy*ny;
          
          // Reflect velocity
          ball.vx -= 2*dot*nx;
          ball.vy -= 2*dot*ny;
          
          // Calculate current velocity angle and magnitude
          const curSpeed = Math.hypot(ball.vx, ball.vy);
          const curAngle = Math.atan2(ball.vy, ball.vx);
          
          // Add a random angle deviation
          const randomAngle = curAngle + rand(-BOUNCE_RANDOMNESS, BOUNCE_RANDOMNESS);
          
          // Set new velocity with same speed but slightly different direction
          ball.vx = Math.cos(randomAngle) * curSpeed;
          ball.vy = Math.sin(randomAngle) * curSpeed;
          
          // Determine if we hit inner or outer edge
          const hitInner = dist < ring.radius;
          const penetration = hitInner
              ? ringInnerRadius - (dist - ball.radius)
              : (dist + ball.radius) - ringOuterRadius;
              
          // Push ball out of collision more aggressively
          const pushFactor = penetration + ball.radius * 0.6; 
          const pushDir = hitInner ? -1 : 1;
          ball.x += nx * pushFactor * pushDir;
          ball.y += ny * pushFactor * pushDir;
          
          // Update for next collision check
          dx = ball.x-cx;
          dy = ball.y-cy;
          dist = Math.hypot(dx,dy);
          
          // Only check one collision per substep
          break;
        } else if (inCollisionZone) {
          // Ball is passing through the hole
          ring.visible = false;
        }
      }
    }
    
    // If a collision occurred, no need to check the remaining substeps
    if (hasCollided) break;
  }
  
  // Check if ball is outside bounds to reset
  const cx = WIDTH/2, cy=HEIGHT/2;
  const dx = ball.x-cx, dy = ball.y-cy;
  const dist = Math.hypot(dx,dy);
  const maxR = rings.length > 0 ? (rings[rings.length-1].radius+RING_WIDTH+ball.radius+20) : (SHORTER/2);
  if (dist > maxR) resetBall();
}

function draw(ctx) {
  ctx.clearRect(0,0,WIDTH,HEIGHT);
  const cx = WIDTH/2, cy=HEIGHT/2;

  rings.forEach(r=>{
    if (!r.visible) return;
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(r.angle);
    ctx.strokeStyle = r.color;
    ctx.lineWidth=r.width;
    ctx.beginPath();
    ctx.arc(0,0,r.radius,r.holeSize/2,Math.PI*2-r.holeSize/2);
    ctx.stroke();
    ctx.restore();
  });

  ctx.fillStyle='#ff6666';
  ctx.beginPath();
  ctx.arc(ball.x,ball.y,ball.radius,0,Math.PI*2);
  ctx.fill();
}

// Create canvas
const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext('2d');
ctx.antialias = 'subpixel';

// Prepare ffmpeg process: accept raw frames via pipe, overlay onto input video
const ffmpeg = spawn('ffmpeg', [
  '-y',
  '-i', inputPath,
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${WIDTH}x${HEIGHT}`, '-r', `${FPS}`, '-i', '-',
  '-filter_complex', `[0:v]scale=${WIDTH}:${HEIGHT},format=rgba[bg]; [1:v]format=rgba,colorchannelmixer=aa=0.8[ov]; [bg][ov]overlay=format=auto`,
  '-pix_fmt', 'yuv420p',
  '-c:v', 'libx264', '-profile:v', 'high', '-crf', '18', '-preset', 'veryfast',
  '-movflags', '+faststart',
  outputPath
]);

ffmpeg.stderr.on('data', d=> process.stderr.write(d));

let frame = 0;
const frameCount = Math.ceil(meta.duration * FPS);

function sendFrame() {
  const now = frame/FPS;
  update(1/FPS);
  draw(ctx);

  // Get raw RGBA data using getImageData
  const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  const buf = Buffer.from(imageData.data.buffer); // Convert Uint8ClampedArray to Buffer

  ffmpeg.stdin.write(buf);
  frame++;
  if (frame<frameCount) setImmediate(sendFrame);
  else ffmpeg.stdin.end();
}

initializeRings();
resetBall();
sendFrame(); 