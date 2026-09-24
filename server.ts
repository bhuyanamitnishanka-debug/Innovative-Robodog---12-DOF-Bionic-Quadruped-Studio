import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize Gemini SDK with telemetry header per guidelines
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

// System spec data
const ROBOT_PROFILE = {
  name: 'CERBERUS-04 ALPHA',
  platform: '12-DOF Bionic Quadruped',
  creator: 'Amit Nishanka Bhuyan',
  date: '2026-07-23',
  battery: '48V 15Ah Li-Ion Smart BMS',
  mcu: 'Dual-Core STM32H7 (480MHz M7 + 240MHz M4)',
  actuators: '12x High-Torque Brushless Planetary Gearbox Actuators (1kHz bus)',
  perception: 'Dual-Depth LiDAR + Active Stereo Vision + 4x Ultrasonic',
};

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    system: ROBOT_PROFILE,
    hasGeminiKey: !!apiKey,
  });
});

// Gemini VLA (Vision-Language-Action) Endpoint
app.post('/api/gemini/vla', async (req, res) => {
  try {
    const { command, telemetry, environment } = req.body;

    if (!command) {
      return res.status(400).json({ error: 'Command string is required' });
    }

    if (!ai) {
      // Intelligent deterministic fallback simulation if no API key is set
      const simulatedResponse = generateSimulatedVLA(command, telemetry);
      return res.json(simulatedResponse);
    }

    const prompt = `You are the onboard Gemini Embedded Vision-Language-Action (VLA) AI engine for the "CERBERUS-04 ALPHA" 12-DOF bionic quadruped robot dog designed by Amit Nishanka Bhuyan.
Current Telemetry:
- Battery Voltage: ${telemetry?.voltage || 48.2}V (${telemetry?.batteryPercent || 88}%)
- Current Gait: ${telemetry?.gait || 'trot'}
- Linear Velocity: ${telemetry?.velocity || 1.4} m/s
- Heading Yaw: ${telemetry?.heading || 0}°
- Pitch / Roll: ${telemetry?.pitch || 0}° / ${telemetry?.roll || 0}°
- Active Joint Temps: Avg 38.4°C (Safe limit: 65°C)
- LiDAR Nearest Obstacle: ${telemetry?.nearestObstacleDist || '2.4m at 15° north-east'}
- Environment: ${environment || 'Research facility terrain with minor incline ramps and docking beacon in range'}

User / Mission Command:
"${command}"

Respond strictly in JSON matching the specified schema. Output tactical gait parameters, velocity vectors, joint compliance directives, safety status, and concise military/aerospace-grade operational reasoning.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a real-time robotic kinematics and VLA intelligence coprocessor. You analyze perception data, safety thresholds, and issue motor commands.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            missionSummary: {
              type: Type.STRING,
              description: 'Clear, concise 1-2 sentence mission execution summary',
            },
            recommendedGait: {
              type: Type.STRING,
              description: 'Selected gait mode: trot, pace, bound, crawl, stand, or gallop',
            },
            targetVelocity: {
              type: Type.OBJECT,
              properties: {
                linearX: { type: Type.NUMBER, description: 'Forward speed m/s between -1.0 and 3.8' },
                angularZ: { type: Type.NUMBER, description: 'Yaw turn rate rad/s between -2.0 and 2.0' },
                stanceHeight: { type: Type.NUMBER, description: 'Chassis ground clearance in mm (120 to 280)' },
              },
              required: ['linearX', 'angularZ', 'stanceHeight'],
            },
            spatialAssessment: {
              type: Type.STRING,
              description: 'LiDAR and visual SLAM spatial situational assessment',
            },
            tacticalActions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 sequential actions to execute',
            },
            jointTorqueBias: {
              type: Type.STRING,
              description: 'Torque distribution mode: high-traction, compliant, eco-cruising, or sprint',
            },
            safetyLockout: {
              type: Type.BOOLEAN,
              description: 'Whether safety emergency stop should engage',
            },
          },
          required: [
            'missionSummary',
            'recommendedGait',
            'targetVelocity',
            'spatialAssessment',
            'tacticalActions',
            'safetyLockout',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json(parsed);
  } catch (error: any) {
    console.error('Gemini VLA Error:', error);
    // Fallback on error to ensure uninterrupted application experience
    const fallback = generateSimulatedVLA(req.body.command || 'Execute mission', req.body.telemetry);
    return res.json({
      ...fallback,
      _note: 'Processed via onboard autonomous backup pipeline',
    });
  }
});

function generateSimulatedVLA(command: string, telemetry: any) {
  const lower = (command || '').toLowerCase();
  let gait = 'trot';
  let speed = 1.6;
  let yaw = 0.0;
  let height = 220;
  let summary = 'Command evaluated by CERBERUS-04 onboard neural accelerator.';
  let actions = ['Verify CAN-FD actuator telemetry', 'Initiate trajectory planning', 'Stream 400Hz IMU feedback'];

  if (lower.includes('stop') || lower.includes('halt') || lower.includes('freeze')) {
    gait = 'stand';
    speed = 0;
    summary = 'Emergency halt directive confirmed. Actuators locked in high-rigidity 4-point stance.';
    actions = ['Nullify linear velocity', 'Engage mechanical brake hold', 'Maintain 360° LiDAR perimeter watch'];
  } else if (lower.includes('crawl') || lower.includes('low') || lower.includes('stealth') || lower.includes('obstacle')) {
    gait = 'crawl';
    speed = 0.6;
    height = 140;
    summary = 'Low-profile crawl mode engaged. Center of gravity depressed for maximum terrain stability.';
    actions = ['Lower chassis to 140mm', 'Execute metachronal foot stepping', 'Increase torque dampening on knee joints'];
  } else if (lower.includes('sprint') || lower.includes('gallop') || lower.includes('fast') || lower.includes('run')) {
    gait = 'gallop';
    speed = 3.6;
    height = 240;
    summary = 'High-velocity gallop requested. Drawing 48V power bus surge for maximum BLDC output.';
    actions = ['Pre-heat lithium-ion cell thermal manifold', 'Switch CAN-FD rate to 1kHz priority', 'Amplify flight phase clearance'];
  } else if (lower.includes('bound') || lower.includes('jump') || lower.includes('leap')) {
    gait = 'bound';
    speed = 2.4;
    height = 250;
    summary = 'Bound mode loaded. Synchronizing front and rear actuator pairs for vertical impulse.';
    actions = ['Compress 4 leg struts', 'Release synchronized impulse torque', 'Compensate landing via strain gauges'];
  } else if (lower.includes('dock') || lower.includes('charge')) {
    gait = 'crawl';
    speed = 0.4;
    height = 160;
    summary = 'Autonomous docking routine activated. Aligning with magnetic collar and optical IR beacon.';
    actions = ['Lock onto optical homing lasers', 'Approach 80A copper contact pins', 'Trigger magnetic alignment collar'];
  } else if (lower.includes('scan') || lower.includes('patrol') || lower.includes('survey')) {
    gait = 'trot';
    speed = 1.2;
    yaw = 0.3;
    summary = 'Autonomous area surveillance in progress. Merging dual-depth LiDAR with active stereo SLAM.';
    actions = ['Sweep 360° point cloud', 'Register floor elevation delta', 'Flag potential perimeter obstacles'];
  }

  return {
    missionSummary: summary,
    recommendedGait: gait,
    targetVelocity: {
      linearX: speed,
      angularZ: yaw,
      stanceHeight: height,
    },
    spatialAssessment: 'Clear navigational vector detected with nominal 400Hz sensor fusion confidence.',
    tacticalActions: actions,
    jointTorqueBias: speed > 2.5 ? 'sprint' : 'compliant',
    safetyLockout: false,
  };
}

// Vite middleware in development or static serve in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`CERBERUS-04 Robotic Platform Server running on port ${PORT}`);
  });
}

startServer();
