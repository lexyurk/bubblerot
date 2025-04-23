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
const BASE_RING_RADIUS = SHORTER * 0.35; // Even larger central gap
const RING_SPACING = SHORTER * 0.016;
const RING_WIDTH = SHORTER * 0.005; // Thinner rings
const HOLE_ARC = Math.PI / 3;
const BALL_RADIUS = SHORTER * 0.008; // Smaller ball
const BALL_SPEED = SHORTER * 0.5;
const SUB_STEPS = 2;
const BOUNCE_RANDOMNESS = 0.2;
// --- Bounce energy parameters ---
const MIN_ENERGY_FACTOR = 0.85;        // Minimum energy factor (slowdown)
const MAX_ENERGY_FACTOR = 1.15;        // Maximum energy factor (speedup)
const ENERGY_CHANCE_BOOST = 0.6;       // Chance of getting a speed boost
const MIN_BALL_SPEED = SHORTER * 0.2;  // Minimum allowed ball speed
const MAX_BALL_SPEED = SHORTER * 0.8;  // Maximum allowed ball speed
const SPARKLE_COUNT = 18;              // number of particles when a ring is destroyed
const SPARKLE_SPEED = SHORTER * 0.35;  // initial speed of sparkles
const SPARKLE_LIFE = 0.7;              // seconds
const RING_SHRINK_RATE = SHORTER * 0.008; // pixels per second each ring shrinks (reduced to slow down)

// --------- Visual Configuration Options ---------
// Different color schemes
const GRADIENT_SCHEMES = [
  {
    name: 'rainbow',
    getRingColor: (i, total) => `hsla(${i * 360 / total}, 75%, 65%, 0.4)`, // More transparent
    getBallColor: () => '#ff6666'
  },
  {
    name: 'cool',
    getRingColor: (i, total) => `hsla(${180 + i * 60 / total}, 70%, 60%, 0.4)`, // More transparent
    getBallColor: () => '#66ffff'
  },
  {
    name: 'warm',
    getRingColor: (i, total) => `hsla(${i * 60 / total}, 80%, 65%, 0.4)`, // More transparent
    getBallColor: () => '#ffcc00'
  },
  {
    name: 'neon',
    getRingColor: (i, total) => {
      const hues = [320, 260, 180, 120, 40]; // Purple, blue, cyan, green, yellow
      const hue = hues[i % hues.length];
      return `hsla(${hue}, 100%, 65%, 0.4)`; // More transparent
    },
    getBallColor: () => '#ff00ff'
  }
];

// Different ring configurations
const RING_CONFIGURATIONS = [
  {
    name: 'random',
    setupRings: (rings) => {
      rings.forEach(r => {
        r.angle = rand(0, Math.PI*2);
        r.speed = (Math.random() > 0.5 ? 1 : -1) * rand(0.3, 0.8);
      });
    }
  },
  {
    name: 'aligned',
    setupRings: (rings) => {
      // All holes aligned initially at same angle
      const baseAngle = rand(0, Math.PI*2);
      rings.forEach((r, i) => {
        r.angle = baseAngle;
        // Speed inversely proportional to radius
        const speedFactor = 1 - (i / RING_COUNT) * 0.8; // Outer rings are slower
        r.speed = (i % 2 === 0 ? 1 : -1) * rand(0.2, 0.5) * speedFactor;
      });
    }
  },
  {
    name: 'alternating',
    setupRings: (rings) => {
      const baseAngle = rand(0, Math.PI*2);
      rings.forEach((r, i) => {
        // Alternate between 0 and PI to create a checkerboard pattern of holes
        r.angle = baseAngle + (i % 2 === 0 ? 0 : Math.PI);
        r.speed = (i % 2 === 0 ? 1 : -1) * rand(0.4, 0.7);
      });
    }
  }
];

// Different ball effects
const BALL_EFFECTS = [
  {
    name: 'solid',
    initBall: (ball) => {
      ball.colorStyle = 'solid';
      ball.color = currentConfig.colorScheme.getBallColor();
    },
    updateBallColor: (ball, dt) => {
      // No change for solid color
    },
    drawBall: (ctx, ball) => {
      // Make the ball slightly transparent
      ctx.fillStyle = ball.color.startsWith('hsl') 
        ? ball.color.replace(')', ', 0.7)').replace('hsl', 'hsla')
        : ball.color.startsWith('rgb') 
          ? ball.color.replace(')', ', 0.7)').replace('rgb', 'rgba')
          : ball.color + 'B3'; // Hex with opacity (~0.7)
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI*2);
      ctx.fill();
    }
  },
  {
    name: 'cycling',
    initBall: (ball) => {
      ball.colorStyle = 'cycling';
      ball.hue = Math.random() * 360;
      ball.hueSpeed = rand(30, 120); // Degrees per second
    },
    updateBallColor: (ball, dt) => {
      ball.hue = (ball.hue + ball.hueSpeed * dt) % 360;
      ball.color = `hsl(${ball.hue}, 80%, 60%)`;
    },
    drawBall: (ctx, ball) => {
      ctx.fillStyle = ball.color;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI*2);
      ctx.fill();
    }
  },
  {
    name: 'glowing',
    initBall: (ball) => {
      ball.colorStyle = 'glowing';
      ball.hue = Math.random() * 360;
      ball.brightness = 60;
      ball.brightnessDelta = rand(20, 40);
      ball.brightnessFactor = 1;
    },
    updateBallColor: (ball, dt) => {
      ball.brightnessFactor = (ball.brightnessFactor > 0) ? 
                              ball.brightnessFactor - dt * 1.5 : 
                              ball.brightnessFactor - dt * 1.5;
      if (ball.brightnessFactor < -1) ball.brightnessFactor = 1;
      
      const brightnessValue = ball.brightness + ball.brightnessDelta * Math.abs(ball.brightnessFactor);
      ball.color = `hsl(${ball.hue}, 90%, ${brightnessValue}%)`;
    },
    drawBall: (ctx, ball) => {
      // Glow effect
      const gradient = ctx.createRadialGradient(
        ball.x, ball.y, 0,
        ball.x, ball.y, ball.radius * 2.5
      );
      gradient.addColorStop(0, ball.color);
      gradient.addColorStop(0.4, `hsla(${ball.hue}, 90%, 60%, 0.2)`); // More subtle glow
      gradient.addColorStop(1, `hsla(${ball.hue}, 90%, 60%, 0)`);
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius * 2.5, 0, Math.PI*2);
      ctx.fill();
      
      // Main ball
      ctx.fillStyle = ball.color.replace(')', ', 0.7)').replace('hsl', 'hsla');
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI*2);
      ctx.fill();
    }
  }
];

// Different destruction effects
const DESTRUCTION_EFFECTS = [
  {
    name: 'sparkles',
    createEffect: (x, y, ring) => {
      spawnSparkles(x, y, ring.color);
    }
  },
  {
    name: 'explosion',
    createEffect: (x, y, ring) => {
      spawnExplosion(x, y, ring.color);
    }
  },
  {
    name: 'shockwave',
    createEffect: (x, y, ring) => {
      spawnShockwave(x, y, ring.color);
    }
  },
  {
    name: 'combined',
    createEffect: (x, y, ring) => {
      spawnSparkles(x, y, ring.color);
      spawnShockwave(x, y, ring.color);
      if (Math.random() < 0.3) { // occasionally add explosion too
        spawnExplosion(x, y, ring.color);
      }
    }
  }
];

// Randomly choose a configuration
const currentConfig = {
  colorScheme: GRADIENT_SCHEMES[Math.floor(Math.random() * GRADIENT_SCHEMES.length)],
  ringConfig: RING_CONFIGURATIONS[Math.floor(Math.random() * RING_CONFIGURATIONS.length)],
  ballEffect: BALL_EFFECTS[Math.floor(Math.random() * BALL_EFFECTS.length)],
  destructionEffect: DESTRUCTION_EFFECTS[Math.floor(Math.random() * DESTRUCTION_EFFECTS.length)]
};

console.log(`Using configuration:
  Color scheme: ${currentConfig.colorScheme.name}
  Ring configuration: ${currentConfig.ringConfig.name}
  Ball effect: ${currentConfig.ballEffect.name}
  Destruction effect: ${currentConfig.destructionEffect.name}`);

function rand(min, max) { return Math.random()*(max-min)+min; }

const rings = [];
function initializeRings() {
  rings.length = 0;
  for (let i=0;i<RING_COUNT;i++) {
    const baseRadius = BASE_RING_RADIUS + i*RING_SPACING;
    rings.push({
      radius: baseRadius, // Use baseRadius directly, no center factor needed
      width: RING_WIDTH,
      holeSize: HOLE_ARC,
      angle: 0, // Will be set by configuration
      speed: 0, // Will be set by configuration
      color: currentConfig.colorScheme.getRingColor(i, RING_COUNT),
      visible: true
    });
  }
  
  // Apply the selected ring configuration
  currentConfig.ringConfig.setupRings(rings);
}

const ball = {
  x: WIDTH/2, 
  y: HEIGHT/2, 
  radius: BALL_RADIUS, 
  vx: rand(-1,1)*BALL_SPEED, 
  vy: rand(-1,1)*BALL_SPEED,
  color: '#ff6666' // Will be set by configuration
};

function resetBall() {
  ball.x = WIDTH/2; ball.y=HEIGHT/2;
  const angle = rand(0,Math.PI*2);
  ball.vx = Math.cos(angle)*BALL_SPEED;
  ball.vy = Math.sin(angle)*BALL_SPEED;
  rings.forEach(r => r.visible = true);
  
  // Initialize ball color according to configuration
  currentConfig.ballEffect.initBall(ball);
}

// ---------------- Sparkles -----------------
const sparkles = [];
function spawnSparkles(x, y, color = 'rgba(255,220,150,'){
  for(let i=0;i<SPARKLE_COUNT;i++){
    const ang = rand(0,Math.PI*2);
    const spd = rand(0.4,1)*SPARKLE_SPEED;
    sparkles.push({
      x,y,
      vx: Math.cos(ang)*spd,
      vy: Math.sin(ang)*spd,
      life: SPARKLE_LIFE,
      maxLife: SPARKLE_LIFE,
      color: color.replace('a(', '').replace(',0.65)', ''),
      type: 'sparkle'
    });
  }
}
// -------------------------------------------

// ---------------- Explosion -----------------
const explosions = [];
function spawnExplosion(x, y, color = 'rgba(255,220,150,'){
  const baseHue = parseInt(color.match(/hsla\((\d+),/)?.[1] || "30");
  
  // Add central flash
  explosions.push({
    x, y,
    radius: BALL_RADIUS * 2,
    maxRadius: SHORTER * 0.04, // Smaller explosion radius
    life: 0.5,
    maxLife: 0.5,
    color: `hsla(${baseHue}, 100%, 80%, 0.7)`, // More transparent flash
    type: 'flash'
  });
  
  // Add debris particles
  const debrisCount = 5 + Math.floor(Math.random() * 5); // Fewer debris particles
  for (let i = 0; i < debrisCount; i++) {
    const ang = rand(0, Math.PI * 2);
    const spd = rand(0.3, 0.7) * SPARKLE_SPEED * 1.5;
    const size = rand(BALL_RADIUS * 0.5, BALL_RADIUS * 1.2);
    const life = rand(0.3, 0.8);
    
    explosions.push({
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      radius: size,
      life,
      maxLife: life,
      rotation: rand(0, Math.PI * 2),
      rotationSpeed: rand(-Math.PI, Math.PI) * 2,
      color: `hsla(${baseHue + rand(-20, 20)}, 90%, 65%, 1)`,
      type: 'debris'
    });
  }
}
// -------------------------------------------

// ---------------- Shockwave -----------------
const shockwaves = [];
function spawnShockwave(x, y, color = 'rgba(255,220,150,'){
  const baseHue = parseInt(color.match(/hsla\((\d+),/)?.[1] || "30");
  const life = 0.6;
  
  shockwaves.push({
    x, y,
    radius: BALL_RADIUS * 2,
    maxRadius: SHORTER * 0.1, // Smaller shockwave
    life,
    maxLife: life,
    color: `hsla(${baseHue}, 80%, 70%, 0.6)`, // More transparent shockwave
    type: 'shockwave'
  });
}
// -------------------------------------------

function update(dt) {
  // Update ring rotations
  rings.forEach(r=> r.angle += r.speed*dt);
  
  // Update ball color
  currentConfig.ballEffect.updateBallColor(ball, dt);
  
  // Divide the time step into smaller substeps for more accurate collision detection
  const subDt = dt / SUB_STEPS;
  
  let passedThroughHoleInFrame = false; // Flag to track if a hole pass-through occurred in any substep

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
    
    let hasCollided = false; // Track if a bounce collision happened in this substep
    let passedThroughHoleInSubstep = false; // Track if a hole pass-through happened in this substep
    
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
      
      // Check if the ball *entered* the zone during this substep
      const enteredCollisionZone =
          (prevDist < ballCollisionZoneInner && dist >= ballCollisionZoneInner) || // Crossed inner boundary moving out
          (prevDist > ballCollisionZoneOuter && dist <= ballCollisionZoneOuter);   // Crossed outer boundary moving in
      
      // Only perform angular check if the ball is in the zone or just entered it
      if (inCollisionZone || enteredCollisionZone) {
        // Current angle relative to ring's rotation
        let rel = Math.atan2(dy,dx) - ring.angle;
        rel = (rel + Math.PI * 2) % (Math.PI * 2);
        
        // Calculate the angular width of the ball at this distance (with safety margin)
        const safetyMargin = 1.1; // Slightly increase the effective ball radius
        const angularBallRadius = Math.asin(Math.min(0.99, (ball.radius * safetyMargin) / (dist + 1e-6)));
        
        // Define the angles that mark the solid part of the ring
        const solidPartStartAngle = (ring.holeSize / 2) + angularBallRadius;
        const solidPartEndAngle = (Math.PI * 2 - ring.holeSize / 2) - angularBallRadius;
        
        const isInHole = (rel <= solidPartStartAngle || rel >= solidPartEndAngle);
        
        if (!isInHole) {
          // COLLISION DETECTED - Bounce logic
          hasCollided = true;
                    
          // Calculate reflection normal (from center to ball)
          const nx = dx/dist, ny = dy/dist;
          const dot = ball.vx*nx + ball.vy*ny;
          
          // Reflect velocity
          ball.vx -= 2*dot*nx;
          ball.vy -= 2*dot*ny;
          
          // Apply dynamic energy change - sometimes speed up, sometimes slow down
          const energyFactor = rand(MIN_ENERGY_FACTOR, MAX_ENERGY_FACTOR);
          // Apply energy bias - more likely to speed up if going slow, more likely to slow down if going fast
          const currentSpeed = Math.hypot(ball.vx, ball.vy);
          const speedRatio = currentSpeed / MAX_BALL_SPEED; // 0 to 1 ratio of current to max speed
          
          // Determine if we should boost (more likely for slow balls, less likely for fast ones)
          const shouldBoost = Math.random() < (ENERGY_CHANCE_BOOST * (1 - speedRatio * 0.8));
          
          // Apply final energy change: boost or slow down
          const finalFactor = shouldBoost ? Math.max(1.0, energyFactor) : Math.min(1.0, energyFactor);
          
          ball.vx *= finalFactor;
          ball.vy *= finalFactor;
          
          // Ensure the ball doesn't get too slow or too fast
          const newSpeed = Math.hypot(ball.vx, ball.vy);
          if (newSpeed < MIN_BALL_SPEED) {
            // Scale up to minimum speed
            const scale = MIN_BALL_SPEED / newSpeed;
            ball.vx *= scale;
            ball.vy *= scale;
          } else if (newSpeed > MAX_BALL_SPEED) {
            // Scale down to maximum speed
            const scale = MAX_BALL_SPEED / newSpeed;
            ball.vx *= scale;
            ball.vy *= scale;
          }
          
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
        } else if (enteredCollisionZone) {
          // Ball is passing through the hole
          ring.visible = false;
          currentConfig.destructionEffect.createEffect(ball.x, ball.y, ring); // dynamic destruction effect
          passedThroughHoleInSubstep = true; // Mark that a pass-through happened
          passedThroughHoleInFrame = true; // Mark for the whole frame
          break;
        }
      }
    }
    
    // If a bounce OR a pass-through happened in this substep, stop processing substeps for this frame
    if (hasCollided || passedThroughHoleInSubstep) {
        break;
    }
  }
  
  // Check if ball is outside bounds to reset
  const cx = WIDTH/2, cy=HEIGHT/2;
  const dx = ball.x-cx, dy = ball.y-cy;
  const dist = Math.hypot(dx,dy);
  const maxR = rings.length > 0 ? (rings[rings.length-1].radius+RING_WIDTH+ball.radius+20) : (SHORTER/2);
  if (dist > maxR) resetBall();

  // --- Shrink rings and spawn new outer rings ---
  rings.forEach(r => {
    if(!r.visible) return;
    r.radius -= RING_SHRINK_RATE * dt;
  });

  // Remove rings that became too small
  const MIN_VISUAL_RADIUS = SHORTER * 0.01; // Define a small absolute radius for removal
  while(rings.length && rings[0].visible && rings[0].radius < MIN_VISUAL_RADIUS){
    rings.shift();
  }

  // Ensure we keep at least RING_COUNT rings by adding new ones outside
  while(rings.length < RING_COUNT){
    const last = rings[rings.length-1];
    const newRadius = (last ? last.radius + RING_SPACING : BASE_RING_RADIUS);
    rings.push({
      radius:newRadius,
      width:RING_WIDTH,
      holeSize:HOLE_ARC,
      angle:rand(0,Math.PI*2),
      speed:(rings.length%2===0?1:-1)*rand(0.3,0.8),
      color:`hsla(${rand(0,360)}, 75%, 65%, 0.65)`,
      visible:true
    });
  }

  // -------------- Update Sparkles ---------------
  for(let i=sparkles.length-1;i>=0;i--){
    const s = sparkles[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if(s.life<=0) sparkles.splice(i,1);
  }
  
  // -------------- Update Explosions ---------------
  for (let i = explosions.length-1; i >= 0; i--) {
    const e = explosions[i];
    e.life -= dt;
    
    if (e.type === 'flash') {
      // Expand the flash
      e.radius = e.maxRadius * (1 - e.life/e.maxLife);
    } else if (e.type === 'debris') {
      // Move debris
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      
      // Add gravity
      e.vy += SHORTER * 0.2 * dt;
      
      // Rotate debris
      e.rotation += e.rotationSpeed * dt;
    }
    
    if (e.life <= 0) explosions.splice(i, 1);
  }
  
  // -------------- Update Shockwaves ---------------
  for (let i = shockwaves.length-1; i >= 0; i--) {
    const s = shockwaves[i];
    s.life -= dt;
    
    // Expand the shockwave
    s.radius = s.maxRadius * (1 - s.life/s.maxLife);
    
    if (s.life <= 0) shockwaves.splice(i, 1);
  }
  // -----------------------------------------------
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

  // Draw ball using the selected effect
  currentConfig.ballEffect.drawBall(ctx, ball);

  // Draw sparkles
  sparkles.forEach(s => {
    const alpha = Math.max(0, s.life / s.maxLife);
    ctx.fillStyle = `rgba(${s.color},${alpha})`;
    ctx.beginPath();
    ctx.arc(s.x,s.y,ball.radius*0.5,0,Math.PI*2);
    ctx.fill();
  });
  
  // Draw explosions
  explosions.forEach(e => {
    const alpha = Math.max(0, e.life / e.maxLife);
    
    if (e.type === 'flash') {
      // Draw expanding flash
      const gradient = ctx.createRadialGradient(
        e.x, e.y, 0,
        e.x, e.y, e.radius
      );
      gradient.addColorStop(0, e.color.replace('1)', `${alpha})`));
      gradient.addColorStop(0.7, e.color.replace('1)', `${alpha * 0.7})`));
      gradient.addColorStop(1, e.color.replace('1)', '0)'));
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI*2);
      ctx.fill();
    } else if (e.type === 'debris') {
      // Draw debris particles
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.rotation);
      
      ctx.fillStyle = e.color.replace('1)', `${alpha})`);
      ctx.beginPath();
      
      // Randomize debris shape - sometimes square, sometimes triangle
      if (e.shapeType === undefined) {
        e.shapeType = Math.random() > 0.5 ? 'square' : 'triangle';
      }
      
      if (e.shapeType === 'square') {
        ctx.rect(-e.radius/2, -e.radius/2, e.radius, e.radius);
      } else {
        ctx.moveTo(0, -e.radius/2);
        ctx.lineTo(-e.radius/2, e.radius/2);
        ctx.lineTo(e.radius/2, e.radius/2);
        ctx.closePath();
      }
      
      ctx.fill();
      ctx.restore();
    }
  });
  
  // Draw shockwaves
  shockwaves.forEach(s => {
    const alpha = Math.max(0, s.life / s.maxLife) * 0.4; // Reduced alpha
    ctx.strokeStyle = s.color.replace('1)', `${alpha})`);
    ctx.lineWidth = RING_WIDTH * 1.2 * (s.life / s.maxLife); // Even thinner
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI*2);
    ctx.stroke();
  });
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
  '-filter_complex', `[0:v]scale=${WIDTH}:${HEIGHT},format=rgba[bg]; [1:v]format=rgba,colorchannelmixer=aa=0.6[ov]; [bg][ov]overlay=format=auto`,
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