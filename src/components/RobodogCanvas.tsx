import React, { useRef, useEffect, useState, useCallback } from 'react';
import { TelemetryState, GaitType, ViewMode, LegJoints } from '../types/robotics';
import { audioSynth } from '../utils/audioSynthesizer';
import { Eye, Layers, Zap, Compass, Target, RotateCcw, Flame, Thermometer, Navigation } from 'lucide-react';

// Converts actuator motor temperature (°C) to an RGB/RGBA thermal color string from Blue (20°C) to Red (60°C+)
export const getThermalColor = (tempC: number, alpha: number = 1.0): string => {
  // Clamped normalized t between 20°C (0.0) and 60°C (1.0)
  const t = Math.max(0, Math.min(1, (tempC - 20) / (60 - 20)));

  let r = 24, g = 60, b = 210;

  if (t < 0.20) {
    // 20°C to 28°C: Deep Royal Blue -> Cyan
    const k = t / 0.20;
    r = Math.round(24 + k * (6 - 24));
    g = Math.round(60 + k * (182 - 60));
    b = Math.round(210 + k * (212 - 210));
  } else if (t < 0.40) {
    // 28°C to 36°C: Cyan -> Emerald Green
    const k = (t - 0.20) / 0.20;
    r = Math.round(6 + k * (34 - 6));
    g = Math.round(182 + k * (197 - 182));
    b = Math.round(212 + k * (94 - 212));
  } else if (t < 0.65) {
    // 36°C to 46°C: Green -> Bright Yellow
    const k = (t - 0.40) / 0.25;
    r = Math.round(34 + k * (234 - 34));
    g = Math.round(197 + k * (179 - 197));
    b = Math.round(94 + k * (8 - 94));
  } else if (t < 0.85) {
    // 46°C to 54°C: Bright Yellow -> Vibrant Orange
    const k = (t - 0.65) / 0.20;
    r = Math.round(234 + k * (249 - 234));
    g = Math.round(179 + k * (115 - 179));
    b = Math.round(8 + k * (22 - 8));
  } else {
    // 54°C to 60°C+: Orange -> Glowing Red
    const k = (t - 0.85) / 0.15;
    r = Math.round(249 + k * (239 - 249));
    g = Math.round(115 + k * (68 - 115));
    b = Math.round(22 + k * (68 - 22));
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

interface RobodogCanvasProps {
  telemetry: TelemetryState;
  updateTelemetry: (partial: Partial<TelemetryState>) => void;
}

export const RobodogCanvas: React.FC<RobodogCanvasProps> = ({ telemetry, updateTelemetry }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameId = useRef<number | null>(null);

  // Internal visual state & camera
  const [cameraZoom, setCameraZoom] = useState(1.0);
  const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
  const [thermalOverlayEnabled, setThermalOverlayEnabled] = useState(false);
  const [thermalSimOffset, setThermalSimOffset] = useState(0); // °C thermal shift for test injection
  const [velocityVectorEnabled, setVelocityVectorEnabled] = useState(true);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const gaitCycleTime = useRef(0);
  const lastFootstepTime = useRef(0);

  const isThermalActive = telemetry.viewMode === 'thermal' || thermalOverlayEnabled;

  // 2-link Inverse Kinematics solver
  // Returns joint angles in radians: { hipPitch, kneePitch, kneeX, kneeY, footX, footY }
  const solveIK = (
    hipX: number,
    hipY: number,
    targetFootX: number,
    targetFootY: number,
    L1: number,
    L2: number,
    isFront: boolean
  ) => {
    const dx = targetFootX - hipX;
    const dy = targetFootY - hipY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Clamp to reachable envelope
    const maxReach = L1 + L2 - 2;
    const minReach = Math.abs(L1 - L2) + 2;
    const d = Math.max(minReach, Math.min(maxReach, dist));

    const angleToTarget = Math.atan2(dy, dx);
    const cosKnee = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
    const kneeAngle = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosKnee)));

    const cosHipDelta = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const hipDelta = Math.acos(Math.max(-1, Math.min(1, cosHipDelta)));

    // For canine anatomy, knees bend backwards on hind legs, forward/backward depending on joint configuration
    const bendSign = isFront ? 1 : -1;
    const hipAngle = angleToTarget + bendSign * hipDelta;

    const kneeX = hipX + L1 * Math.cos(hipAngle);
    const kneeY = hipY + L1 * Math.sin(hipAngle);

    const actualFootAngle = hipAngle - bendSign * kneeAngle;
    const footX = kneeX + L2 * Math.cos(actualFootAngle);
    const footY = kneeY + L2 * Math.sin(actualFootAngle);

    return {
      hipPitchRad: hipAngle,
      kneePitchRad: kneeAngle,
      kneeX,
      kneeY,
      footX,
      footY,
    };
  };

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTime = performance.now();

    const render = (currentTime: number) => {
      const dt = Math.min(0.05, (currentTime - lastTime) / 1000);
      lastTime = currentTime;

      const width = canvas.width;
      const height = canvas.height;

      // Handle autonomous waypoint steering
      if (telemetry.targetWaypoint && !telemetry.emergencyStop) {
        const dx = telemetry.targetWaypoint.x - telemetry.positionX;
        const dy = telemetry.targetWaypoint.y - telemetry.positionY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0.15) {
          const targetHeading = (Math.atan2(dy, dx) * 180) / Math.PI;
          let headingDiff = targetHeading - telemetry.heading;
          while (headingDiff > 180) headingDiff -= 360;
          while (headingDiff < -180) headingDiff += 360;

          const turnRate = Math.max(-2, Math.min(2, headingDiff * 0.05));
          const newHeading = (telemetry.heading + turnRate * dt * 50) % 360;
          const currentSpeed = telemetry.gait === 'stand' ? 1.4 : Math.max(0.8, telemetry.linearVelocity);

          const rad = (newHeading * Math.PI) / 180;
          const newPosX = telemetry.positionX + Math.cos(rad) * currentSpeed * dt;
          const newPosY = telemetry.positionY + Math.sin(rad) * currentSpeed * dt;

          updateTelemetry({
            heading: (newHeading + 360) % 360,
            positionX: newPosX,
            positionY: newPosY,
            angularVelocity: turnRate,
            gait: telemetry.gait === 'stand' ? 'trot' : telemetry.gait,
          });
        } else {
          // Reached waypoint
          updateTelemetry({ targetWaypoint: null, angularVelocity: 0 });
        }
      }

      // Gait phase frequency based on speed
      const effectiveSpeed = telemetry.emergencyStop
        ? 0
        : telemetry.gait === 'stand'
        ? 0
        : telemetry.linearVelocity;

      // Audio update
      audioSynth.setServoWhine(effectiveSpeed, telemetry.audioEnabled);

      let stepFrequency = telemetry.swingFrequency || 1.8; // Hz
      if (!telemetry.swingFrequency) {
        if (telemetry.gait === 'gallop') stepFrequency = 3.5;
        else if (telemetry.gait === 'bound') stepFrequency = 2.4;
        else if (telemetry.gait === 'trot') stepFrequency = 1.8;
        else if (telemetry.gait === 'walk') stepFrequency = 1.3;
        else if (telemetry.gait === 'crawl') stepFrequency = 1.0;
        else if (telemetry.gait === 'creep') stepFrequency = 0.75;
        else if (telemetry.gait === 'pace') stepFrequency = 1.6;
      }

      if (effectiveSpeed > 0.05) {
        gaitCycleTime.current += dt * stepFrequency * Math.PI * 2;
      }

      // Clear Canvas
      ctx.fillStyle = '#060a14';
      ctx.fillRect(0, 0, width, height);

      // Save context for camera transformation
      ctx.save();
      ctx.translate(width / 2 + cameraOffset.x, height / 2 + cameraOffset.y);
      ctx.scale(cameraZoom, cameraZoom);

      // 1. Draw Ground Plane & Perspective Grid
      drawGroundGrid(ctx, effectiveSpeed, gaitCycleTime.current);

      // 2. Draw Target Waypoint Marker
      if (telemetry.targetWaypoint) {
        drawWaypointMarker(ctx, telemetry.targetWaypoint, currentTime);
      }

      // 3. Draw Robot Dog Bionic Model
      drawRobotModel(ctx, effectiveSpeed, gaitCycleTime.current, currentTime);

      ctx.restore();

      // 4. Draw HUD Overlays (2D screen space)
      drawHUDOverlays(ctx, width, height);

      animFrameId.current = requestAnimationFrame(render);
    };

    animFrameId.current = requestAnimationFrame(render);

    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      audioSynth.stopServo();
    };
  }, [telemetry, cameraZoom, cameraOffset, updateTelemetry, velocityVectorEnabled, isThermalActive, thermalSimOffset]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.parentElement?.getBoundingClientRect();
      if (rect) {
        canvasRef.current.width = rect.width;
        canvasRef.current.height = rect.height;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Ground Grid Renderer
  const drawGroundGrid = (ctx: CanvasRenderingContext2D, speed: number, gaitTime: number) => {
    const groundY = 160;
    const gridSpan = 800;

    // Subtle horizon haze
    const grad = ctx.createLinearGradient(0, groundY - 80, 0, groundY + 200);
    grad.addColorStop(0, 'rgba(6, 182, 212, 0.0)');
    grad.addColorStop(0.3, 'rgba(6, 182, 212, 0.06)');
    grad.addColorStop(1, 'rgba(2, 6, 23, 0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(-gridSpan, groundY - 80, gridSpan * 2, 280);

    // Baseline ground line
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-gridSpan, groundY);
    ctx.lineTo(gridSpan, groundY);
    ctx.stroke();

    // Moving ground ticks to simulate traversal
    const scrollOffset = (gaitTime * 28) % 60;
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.15)';
    ctx.lineWidth = 1;
    for (let x = -gridSpan + scrollOffset; x <= gridSpan; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x - 20, groundY + 70);
      ctx.stroke();
    }

    // Distance tick markers with millimeter annotations
    ctx.fillStyle = 'rgba(148, 163, 184, 0.3)';
    ctx.font = '9px "JetBrains Mono"';
    for (let x = -600; x <= 600; x += 200) {
      ctx.fillText(`${x > 0 ? '+' : ''}${(x / 100).toFixed(1)}m`, x - 12, groundY + 20);
    }
  };

  // Draw Waypoint Marker
  const drawWaypointMarker = (
    ctx: CanvasRenderingContext2D,
    wp: { x: number; y: number },
    time: number
  ) => {
    const wpScreenX = (wp.x - telemetry.positionX) * 120;
    const wpScreenY = 160;
    const pulse = (Math.sin(time * 0.006) + 1) * 0.5;

    ctx.save();
    ctx.translate(wpScreenX, wpScreenY);

    // Pulse Ring
    ctx.strokeStyle = `rgba(6, 182, 212, ${0.4 + pulse * 0.5})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 24 + pulse * 14, 8 + pulse * 5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Core Beacon Pillar
    const beaconGrad = ctx.createLinearGradient(0, -90, 0, 0);
    beaconGrad.addColorStop(0, 'rgba(6, 182, 212, 0.0)');
    beaconGrad.addColorStop(1, 'rgba(6, 182, 212, 0.4)');
    ctx.fillStyle = beaconGrad;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(0, -80);
    ctx.lineTo(6, 0);
    ctx.closePath();
    ctx.fill();

    // Beacon Top Diamond
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(0, -82, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#67e8f9';
    ctx.font = '10px "JetBrains Mono"';
    ctx.fillText('NAV WAYPOINT', -35, -92);

    ctx.restore();
  };

  // Main Robot Kinematics & Rendering
  const drawRobotModel = (
    ctx: CanvasRenderingContext2D,
    speed: number,
    gaitTime: number,
    time: number
  ) => {
    // Dynamic body center of mass & breathing / bouncing motion
    const groundY = 160;
    const baseHeight = telemetry.stanceHeight * 0.8; // mm to canvas units

    let bodyBounceY = 0;
    let bodyPitchAngle = (telemetry.bodyPitch * Math.PI) / 180;
    let bodyRollAngle = (telemetry.bodyRoll * Math.PI) / 180;

    // Gait-specific body kinematics
    if (speed > 0.05 && !telemetry.emergencyStop) {
      if (telemetry.gait === 'trot') {
        bodyBounceY = Math.sin(gaitTime * 2) * 5;
        bodyPitchAngle += Math.sin(gaitTime * 2) * 0.03;
      } else if (telemetry.gait === 'walk') {
        bodyBounceY = Math.sin(gaitTime * 4) * 2.5;
        bodyPitchAngle += Math.sin(gaitTime * 2) * 0.02;
        bodyRollAngle += Math.sin(gaitTime * 2) * 0.025;
      } else if (telemetry.gait === 'creep') {
        bodyBounceY = Math.sin(gaitTime * 4) * 1.2;
        bodyPitchAngle += Math.sin(gaitTime * 2) * 0.01;
      } else if (telemetry.gait === 'bound') {
        bodyBounceY = Math.sin(gaitTime) * 16 - 4;
        bodyPitchAngle += Math.sin(gaitTime) * 0.18;
      } else if (telemetry.gait === 'pace') {
        bodyRollAngle += Math.sin(gaitTime) * 0.08;
        bodyBounceY = Math.sin(gaitTime * 2) * 3;
      } else if (telemetry.gait === 'crawl') {
        bodyBounceY = Math.sin(gaitTime * 4) * 2;
      } else if (telemetry.gait === 'gallop') {
        bodyBounceY = Math.sin(gaitTime) * 20 - 8;
        bodyPitchAngle += Math.sin(gaitTime) * 0.22;
      }
    } else {
      // Idle slight breathing oscillation
      bodyBounceY = Math.sin(time * 0.0025) * 1.5;
    }

    const bodyCenterX = 0;
    const bodyCenterY = groundY - baseHeight + bodyBounceY;

    // Body chassis dimensions
    const torsoLength = 220;
    const torsoHeight = 46;
    const frontHipX = bodyCenterX + torsoLength * 0.38;
    const rearHipX = bodyCenterX - torsoLength * 0.38;
    const hipYOffset = 6;

    const L1 = 78; // Upper leg length
    const L2 = 82; // Lower leg length
    const stepLength = telemetry.strideLength
      ? Math.max(16, Math.min(90, (telemetry.strideLength / 320) * 55))
      : Math.min(75, 25 + speed * 18);
    const stepHeight = telemetry.gait === 'creep' ? 16 : Math.min(42, 16 + speed * 10);

    // Compute leg phase offsets based on selected gait
    // 4 legs: FL (0), FR (1), RL (2), RR (3)
    let phases = [0, Math.PI, Math.PI, 0]; // Default Trot: diagonal pair
    if (telemetry.gait === 'walk') {
      // Lateral sequence walk: RH(RR) -> RF(FR) -> LH(RL) -> LF(FL)
      phases = [0, Math.PI * 0.5, Math.PI * 1.5, Math.PI];
    } else if (telemetry.gait === 'creep') {
      // Ultra-stable creeping pattern
      phases = [0, Math.PI * 0.5, Math.PI * 1.5, Math.PI];
    } else if (telemetry.gait === 'pace') {
      phases = [0, Math.PI, 0, Math.PI]; // Lateral pair
    } else if (telemetry.gait === 'bound') {
      phases = [0, 0, Math.PI, Math.PI]; // Front together, rear together
    } else if (telemetry.gait === 'crawl') {
      phases = [0, Math.PI * 0.5, Math.PI * 1.5, Math.PI]; // Metachronal crawl
    } else if (telemetry.gait === 'gallop') {
      phases = [0, 0.4, Math.PI * 1.1, Math.PI * 1.5]; // Asymmetrical gallop
    } else if (telemetry.gait === 'stand') {
      phases = [0, 0, 0, 0];
    }

    // Calculate foot positions and solve IK for all 4 legs
    const legConfigs = [
      { id: 'RL', isFront: false, isRight: false, hipX: rearHipX, phase: phases[2] },
      { id: 'FL', isFront: true, isRight: false, hipX: frontHipX, phase: phases[0] },
      { id: 'RR', isFront: false, isRight: true, hipX: rearHipX + 8, phase: phases[3] },
      { id: 'FR', isFront: true, isRight: true, hipX: frontHipX + 8, phase: phases[1] },
    ];

    const solvedLegs: any[] = [];
    const activeLegJoints: any = {};

    legConfigs.forEach((leg) => {
      let footX = leg.hipX;
      let footY = groundY;

      if (speed > 0.05 && !telemetry.emergencyStop && telemetry.gait !== 'stand') {
        const p = (gaitTime + leg.phase) % (Math.PI * 2);
        const normP = p / (Math.PI * 2); // 0 to 1

        // Swing limit adjusted by duty factor: creep has 0.25 swing (75% stance)
        const swingLimit = telemetry.gait === 'creep' ? 0.25 : telemetry.gait === 'walk' ? 0.35 : 0.5;

        if (normP < swingLimit) {
          const swingRatio = normP / swingLimit; // 0 to 1
          // Sinusoidal trajectory
          footX = leg.hipX - stepLength * 0.5 + swingRatio * stepLength;
          footY = groundY - Math.sin(swingRatio * Math.PI) * stepHeight;
        } else {
          const stanceRatio = (normP - swingLimit) / (1 - swingLimit);
          footX = leg.hipX + stepLength * 0.5 - stanceRatio * stepLength;
          footY = groundY;

          // Play footstep impact sound just after landing
          if (stanceRatio < 0.08 && time - lastFootstepTime.current > 180) {
            audioSynth.playFootstep(telemetry.audioEnabled);
            lastFootstepTime.current = time;
          }
        }
      } else {
        // Stationary stance
        footX = leg.isFront ? leg.hipX + 12 : leg.hipX - 16;
        footY = groundY;
      }

      const hipWorldX = leg.hipX;
      const hipWorldY = bodyCenterY + hipYOffset;
      const ik = solveIK(hipWorldX, hipWorldY, footX, footY, L1, L2, leg.isFront);

      solvedLegs.push({
        ...leg,
        hipX: hipWorldX,
        hipY: hipWorldY,
        ...ik,
      });

      // Save angles in degrees and actuator temperatures for telemetry
      const key = leg.id.toLowerCase() as 'fl' | 'fr' | 'rl' | 'rr';
      const existingJoint = telemetry.legs?.[key];
      const baseTemp = (existingJoint?.temperature || 38.0) + thermalSimOffset;
      const hipRollTemp = (existingJoint?.hipRollTemp ?? 32.4) + thermalSimOffset;
      const hipPitchTemp = (existingJoint?.hipPitchTemp ?? 38.2) + thermalSimOffset;
      const kneePitchTemp = (existingJoint?.kneePitchTemp ?? 43.8) + thermalSimOffset;

      activeLegJoints[key] = {
        hipAbduction: 0,
        hipPitch: Math.round((ik.hipPitchRad * 180) / Math.PI),
        kneePitch: Math.round((ik.kneePitchRad * 180) / Math.PI),
        torque: Math.min(35, Math.max(5, 12 + speed * 4 + Math.random() * 2)),
        temperature: parseFloat(baseTemp.toFixed(1)),
        hipRollTemp: parseFloat(hipRollTemp.toFixed(1)),
        hipPitchTemp: parseFloat(hipPitchTemp.toFixed(1)),
        kneePitchTemp: parseFloat(kneePitchTemp.toFixed(1)),
      };
    });

    // Draw background legs first (Right side)
    solvedLegs
      .filter((l) => l.isRight)
      .forEach((leg) => {
        drawLeg(ctx, leg, true, telemetry.viewMode, isThermalActive);
      });

    // Draw Central Body Chassis & Torso
    ctx.save();
    ctx.translate(bodyCenterX, bodyCenterY);
    ctx.rotate(bodyPitchAngle);

    drawChassis(ctx, torsoLength, torsoHeight, telemetry.viewMode, time, isThermalActive);

    ctx.restore();

    // Draw foreground legs (Left side)
    solvedLegs
      .filter((l) => !l.isRight)
      .forEach((leg) => {
        drawLeg(ctx, leg, false, telemetry.viewMode, isThermalActive);
      });

    // Draw Head, Eyes & Perception Sensor Array
    drawHeadAndSensors(
      ctx,
      bodyCenterX + torsoLength * 0.44,
      bodyCenterY - 14,
      bodyPitchAngle,
      telemetry.viewMode,
      time
    );

    // Draw Dynamic Velocity Vector Arrow Originating from Robot Center of Mass (CoM)
    if (velocityVectorEnabled) {
      drawVelocityVector(
        ctx,
        bodyCenterX,
        bodyCenterY,
        telemetry.linearVelocity,
        telemetry.angularVelocity,
        bodyPitchAngle,
        speed,
        time,
        telemetry.emergencyStop
      );
    }
  };

  // Render dynamic velocity vector arrow originating from the robot's center of mass (CoM)
  // Length and orientation represent linear velocity and angular velocity (yaw/steer/drift) state
  const drawVelocityVector = (
    ctx: CanvasRenderingContext2D,
    comX: number,
    comY: number,
    linearVel: number,
    angularVel: number,
    bodyPitchAngle: number,
    effectiveSpeed: number,
    time: number,
    emergencyStop: boolean
  ) => {
    ctx.save();

    const isEStopped = emergencyStop;
    const vLin = isEStopped ? 0 : linearVel;
    const vAng = isEStopped ? 0 : angularVel;
    const absLin = Math.abs(vLin);
    const absAng = Math.abs(vAng);

    // Dynamic resultant velocity magnitude combining linear speed and rotational yaw moment
    const vMag = Math.sqrt(vLin * vLin + (vAng * 0.45) * (vAng * 0.45));
    const isMoving = vMag > 0.03;

    // Dynamic arrow length scaling:
    // Stationary: 0 (resting reticle glyph)
    // 0.5 m/s -> ~58px
    // 1.5 m/s -> ~125px
    // 3.0 m/s -> ~220px
    const arrowLength = isMoving ? Math.min(240, Math.max(36, vMag * 65 + 24)) : 0;

    // Vector Orientation Angle:
    // Longitudinal axis is bodyPitchAngle (forward is +X).
    // If vLin < 0 (reverse), vector points backwards (+PI).
    // Lateral turning slip deflection caused by angular velocity vAng:
    // A positive yaw rate (turning right/clockwise in vehicle coordinates) deflects the vector downwards.
    const forwardDir = vLin >= 0 ? 0 : Math.PI;
    const lateralDeflection = Math.atan2(-vAng * 0.65, absLin + 0.12);
    const vectorAngle = bodyPitchAngle + forwardDir + lateralDeflection;

    const tipX = comX + Math.cos(vectorAngle) * arrowLength;
    const tipY = comY + Math.sin(vectorAngle) * arrowLength;

    // Dynamic color coding based on velocity & turning dynamics
    let primaryColor = '#06b6d4'; // Cyan
    let secondaryColor = '#10b981'; // Emerald
    let glowColor = 'rgba(6, 182, 212, 0.7)';

    if (isEStopped) {
      primaryColor = '#f43f5e';
      secondaryColor = '#e11d48';
      glowColor = 'rgba(244, 63, 94, 0.8)';
    } else if (vMag > 2.6 || absAng > 1.4) {
      primaryColor = '#f43f5e';
      secondaryColor = '#fbbf24';
      glowColor = 'rgba(244, 63, 94, 0.8)';
    } else if (vMag > 1.6 || absAng > 0.6) {
      primaryColor = '#fbbf24';
      secondaryColor = '#06b6d4';
      glowColor = 'rgba(251, 191, 36, 0.7)';
    }

    // -------------------------------------------------------------
    // 1. Center of Mass (CoM) Origin Reticle & Glyph
    // -------------------------------------------------------------
    const comPulse = Math.sin(time * 0.005) * 1.5;
    const comR = 10;

    // Outer glowing reticle ring
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(comX, comY, comR + comPulse, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair ticks
    ctx.beginPath();
    ctx.moveTo(comX - comR - 5, comY);
    ctx.lineTo(comX - comR + 1, comY);
    ctx.moveTo(comX + comR - 1, comY);
    ctx.lineTo(comX + comR + 5, comY);
    ctx.moveTo(comX, comY - comR - 5);
    ctx.lineTo(comX, comY - comR + 1);
    ctx.moveTo(comX, comY + comR - 1);
    ctx.lineTo(comX, comY + comR + 5);
    ctx.stroke();

    // Standard CoM quadrant disc
    ctx.shadowBlur = 0;
    // Quadrant 1 (top-right) & 3 (bottom-left): colored
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.moveTo(comX, comY);
    ctx.arc(comX, comY, comR - 2, 0, Math.PI * 0.5);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(comX, comY);
    ctx.arc(comX, comY, comR - 2, Math.PI, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();

    // Quadrant 2 (top-left) & 4 (bottom-right): dark slate
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.moveTo(comX, comY);
    ctx.arc(comX, comY, comR - 2, Math.PI * 0.5, Math.PI);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(comX, comY);
    ctx.arc(comX, comY, comR - 2, Math.PI * 1.5, Math.PI * 2);
    ctx.closePath();
    ctx.fill();

    // Center pivot dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(comX, comY, 2, 0, Math.PI * 2);
    ctx.fill();

    // CoM Label
    ctx.font = 'bold 8px "JetBrains Mono", monospace';
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'center';
    ctx.fillText('CoM', comX, comY + 22);

    // -------------------------------------------------------------
    // 2. Angular Velocity Gyro Arc around CoM (if rotating)
    // -------------------------------------------------------------
    if (absAng > 0.05 && !isEStopped) {
      const arcR = 30;
      const arcSpan = Math.min(Math.PI * 0.85, Math.max(0.4, absAng * 0.8));
      const isClockwise = vAng > 0;
      const arcMidAngle = vectorAngle - Math.PI * 0.5;
      const startA = arcMidAngle - arcSpan * 0.5;
      const endA = arcMidAngle + arcSpan * 0.5;

      ctx.save();
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(comX, comY, arcR, startA, endA);
      ctx.stroke();

      // Curved arrowhead on the rotation arc tip
      const arrowTipAngle = isClockwise ? endA : startA;
      const arcTipX = comX + Math.cos(arrowTipAngle) * arcR;
      const arcTipY = comY + Math.sin(arrowTipAngle) * arcR;
      const tangentAngle = arrowTipAngle + (isClockwise ? Math.PI * 0.5 : -Math.PI * 0.5);

      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(arcTipX, arcTipY);
      ctx.lineTo(
        arcTipX + Math.cos(tangentAngle - 2.5) * 8,
        arcTipY + Math.sin(tangentAngle - 2.5) * 8
      );
      ctx.lineTo(
        arcTipX + Math.cos(tangentAngle + 2.5) * 8,
        arcTipY + Math.sin(tangentAngle + 2.5) * 8
      );
      ctx.closePath();
      ctx.fill();

      // Gyro rate badge
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillStyle = '#fbbf24';
      ctx.textAlign = 'center';
      ctx.fillText(
        `ω:${vAng > 0 ? '+' : ''}${vAng.toFixed(2)} rad/s`,
        comX,
        comY - arcR - 6
      );
      ctx.restore();
    }

    // -------------------------------------------------------------
    // 3. Dynamic Velocity Vector Arrow Shaft & Aerodynamic Head
    // -------------------------------------------------------------
    if (isMoving) {
      // Linear gradient along vector shaft
      const shaftGrad = ctx.createLinearGradient(comX, comY, tipX, tipY);
      shaftGrad.addColorStop(0, primaryColor);
      shaftGrad.addColorStop(0.65, secondaryColor);
      shaftGrad.addColorStop(1, '#ffffff');

      // Shaft glow
      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = shaftGrad;
      ctx.lineWidth = Math.min(6, Math.max(3.2, 2.5 + vMag * 1.0));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(
        comX + Math.cos(vectorAngle) * (comR + 2),
        comY + Math.sin(vectorAngle) * (comR + 2)
      );
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.restore();

      // Animated kinetic energy flow dashes moving along the arrow
      ctx.save();
      const flowSpeed = (time * 0.05 * (vMag + 0.8)) % 20;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 9]);
      ctx.lineDashOffset = -flowSpeed;
      ctx.beginPath();
      ctx.moveTo(
        comX + Math.cos(vectorAngle) * (comR + 2),
        comY + Math.sin(vectorAngle) * (comR + 2)
      );
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.restore();

      // Aerodynamic Arrowhead
      const headLen = Math.min(22, Math.max(14, 12 + vMag * 3));
      const headWingAngle = 0.42; // ~24 deg
      const baseRecess = headLen * 0.35;

      const leftWingX = tipX - Math.cos(vectorAngle - headWingAngle) * headLen;
      const leftWingY = tipY - Math.sin(vectorAngle - headWingAngle) * headLen;
      const rightWingX = tipX - Math.cos(vectorAngle + headWingAngle) * headLen;
      const rightWingY = tipY - Math.sin(vectorAngle + headWingAngle) * headLen;
      const innerBaseX = tipX - Math.cos(vectorAngle) * (headLen - baseRecess);
      const innerBaseY = tipY - Math.sin(vectorAngle) * (headLen - baseRecess);

      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 16;
      ctx.fillStyle = secondaryColor;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(leftWingX, leftWingY);
      ctx.lineTo(innerBaseX, innerBaseY);
      ctx.lineTo(rightWingX, rightWingY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();

      // Velocity shockwave ripple at high speeds
      if (vMag > 1.8) {
        const shockOffset = (time * 0.06) % 18;
        const shockX = tipX + Math.cos(vectorAngle) * shockOffset;
        const shockY = tipY + Math.sin(vectorAngle) * shockOffset;
        const shockAlpha = Math.max(0, 1 - shockOffset / 18);
        ctx.save();
        ctx.strokeStyle = `rgba(34, 211, 238, ${shockAlpha * 0.7})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(shockX, shockY, 6 + shockOffset * 0.7, vectorAngle - 1.2, vectorAngle + 1.2);
        ctx.stroke();
        ctx.restore();
      }

      // -------------------------------------------------------------
      // 4. Floating Holographic Telemetry Flag / HUD Badge
      // -------------------------------------------------------------
      const normalAngle = vectorAngle + (vectorAngle > 0 ? -Math.PI * 0.5 : Math.PI * 0.5);
      const badgeDist = 28;
      const badgeCenterX = tipX + Math.cos(normalAngle) * badgeDist;
      const badgeCenterY = tipY + Math.sin(normalAngle) * badgeDist;

      const badgeW = 104;
      const badgeH = 46;
      const badgeX = badgeCenterX - badgeW / 2;
      const badgeY = badgeCenterY - badgeH / 2;

      // Connecting lead-line from arrow tip to badge
      ctx.save();
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(badgeCenterX, badgeCenterY);
      ctx.stroke();
      ctx.restore();

      // Badge Card
      ctx.save();
      ctx.fillStyle = 'rgba(4, 8, 20, 0.92)';
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

      // Header Tag
      ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
      ctx.fillRect(badgeX, badgeY, badgeW, 12);
      ctx.fillStyle = primaryColor;
      ctx.font = 'bold 8px "Chakra Petch", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('VELOCITY VECTOR', badgeX + 4, badgeY + 9);

      // Live Telemetry Readouts
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(
        `v: ${vLin >= 0 ? '+' : ''}${vLin.toFixed(2)} m/s`,
        badgeX + 4,
        badgeY + 23
      );
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(
        `(${(absLin * 3.6).toFixed(1)}km/h)`,
        badgeX + 56,
        badgeY + 23
      );

      ctx.fillStyle = absAng > 0.05 ? '#fbbf24' : '#64748b';
      ctx.fillText(
        `ω: ${vAng >= 0 ? '+' : ''}${vAng.toFixed(2)} rad/s`,
        badgeX + 4,
        badgeY + 34
      );

      const tiltDeg = Math.round((lateralDeflection * 180) / Math.PI);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(
        `∠:${tiltDeg > 0 ? '+' : ''}${tiltDeg}°`,
        badgeX + 4,
        badgeY + 43
      );
      const ekJoules = (0.5 * 15.0 * (vMag * vMag)).toFixed(1);
      ctx.fillStyle = '#10b981';
      ctx.fillText(
        `Ek:${ekJoules}J`,
        badgeX + 48,
        badgeY + 43
      );
      ctx.restore();
    } else {
      // Stationary Idle CoM Badge
      ctx.save();
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillStyle = isEStopped ? '#f43f5e' : '#64748b';
      ctx.textAlign = 'center';
      ctx.fillText(
        isEStopped ? 'E-STOP HALT' : 'STATIONARY (0.00 m/s)',
        comX,
        comY - 16
      );
      ctx.restore();
    }

    ctx.restore();
  };

  // Helper to render the 3 brushless actuators on each leg with thermal intensity and badges
  const renderActuators = (
    ctx: CanvasRenderingContext2D,
    leg: any,
    hipRollT: number,
    hipPitchT: number,
    kneePitchT: number,
    rollColor: string,
    hipColor: string,
    kneeColor: string,
    isBackground: boolean,
    isFullThermal: boolean
  ) => {
    // Actuator 1: Hip Roll / Abduction Servo (proximal root joint)
    const rollX = leg.hipX + (leg.isFront ? -9 : 9);
    const rollY = leg.hipY - 10;

    ctx.save();
    ctx.shadowColor = rollColor;
    ctx.shadowBlur = isBackground ? 4 : 10;
    const rollGrad = ctx.createRadialGradient(rollX, rollY, 1.5, rollX, rollY, 7);
    rollGrad.addColorStop(0, '#ffffff');
    rollGrad.addColorStop(0.35, rollColor);
    rollGrad.addColorStop(1, getThermalColor(hipRollT, 0.4));
    ctx.fillStyle = rollGrad;
    ctx.beginPath();
    ctx.arc(rollX, rollY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rollColor;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    // Actuator 2: Hip Pitch Servo (main thigh pivot)
    ctx.save();
    ctx.shadowColor = hipColor;
    ctx.shadowBlur = isBackground ? 6 : 14;
    const hipGrad = ctx.createRadialGradient(leg.hipX, leg.hipY, 2, leg.hipX, leg.hipY, 12);
    hipGrad.addColorStop(0, '#ffffff');
    hipGrad.addColorStop(0.3, hipColor);
    hipGrad.addColorStop(1, getThermalColor(hipPitchT, 0.35));
    ctx.fillStyle = hipGrad;
    ctx.beginPath();
    ctx.arc(leg.hipX, leg.hipY, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hipColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Motor armature notches
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(leg.hipX + Math.cos(a) * 4, leg.hipY + Math.sin(a) * 4);
      ctx.lineTo(leg.hipX + Math.cos(a) * 9, leg.hipY + Math.sin(a) * 9);
      ctx.stroke();
    }
    ctx.restore();

    // Actuator 3: Knee Pitch Servo (knee planetary gearbox)
    ctx.save();
    ctx.shadowColor = kneeColor;
    ctx.shadowBlur = kneePitchT > 46 ? 18 : isBackground ? 6 : 12;
    const kneeGrad = ctx.createRadialGradient(leg.kneeX, leg.kneeY, 2, leg.kneeX, leg.kneeY, 10);
    kneeGrad.addColorStop(0, '#ffffff');
    kneeGrad.addColorStop(0.35, kneeColor);
    kneeGrad.addColorStop(1, getThermalColor(kneePitchT, 0.35));
    ctx.fillStyle = kneeGrad;
    ctx.beginPath();
    ctx.arc(leg.kneeX, leg.kneeY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = kneeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Critical thermal pulsing warning halo if T > 46°C
    if (kneePitchT > 46) {
      const pulseR = 12 + Math.sin(Date.now() * 0.008) * 3;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(leg.kneeX, leg.kneeY, pulseR, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Display direct telemetry temperature callout tags on foreground legs
    if (!isBackground) {
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';

      // 1. Hip Roll Badge
      ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
      ctx.fillRect(rollX - 44, rollY - 14, 46, 12);
      ctx.strokeStyle = rollColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(rollX - 44, rollY - 14, 46, 12);
      ctx.fillStyle = rollColor;
      ctx.fillText(`${leg.id}-R ${hipRollT.toFixed(0)}°C`, rollX - 41, rollY - 5);

      // 2. Hip Pitch Badge
      ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
      ctx.fillRect(leg.hipX + 13, leg.hipY - 12, 48, 12);
      ctx.strokeStyle = hipColor;
      ctx.strokeRect(leg.hipX + 13, leg.hipY - 12, 48, 12);
      ctx.fillStyle = hipColor;
      ctx.fillText(`${leg.id}-HP ${hipPitchT.toFixed(0)}°C`, leg.hipX + 15, leg.hipY - 3);

      // 3. Knee Pitch Badge
      ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
      ctx.fillRect(leg.kneeX + 12, leg.kneeY - 6, 48, 12);
      ctx.strokeStyle = kneeColor;
      ctx.strokeRect(leg.kneeX + 12, leg.kneeY - 6, 48, 12);
      ctx.fillStyle = kneeColor;
      ctx.fillText(`${leg.id}-KP ${kneePitchT.toFixed(0)}°C`, leg.kneeX + 14, leg.kneeY + 3);
    }
  };

  // Draw Robotic Leg (Femur + Tibia + Foot + Brushless Actuator Servos)
  const drawLeg = (
    ctx: CanvasRenderingContext2D,
    leg: any,
    isBackground: boolean,
    viewMode: ViewMode,
    isThermal: boolean
  ) => {
    ctx.save();
    const alpha = isBackground ? 0.6 : 1.0;
    ctx.globalAlpha = alpha;

    const boneColor = isBackground ? '#1e293b' : '#334155';
    const accentColor = '#06b6d4';
    const darkPlate = isBackground ? '#0f172a' : '#1e293b';

    // Retrieve specific temperature telemetry for this leg's 3 actuators
    const legKey = leg.id.toLowerCase() as 'fl' | 'fr' | 'rl' | 'rr';
    const legTelemetry = telemetry.legs?.[legKey];
    const hipRollT = Math.max(20, Math.min(75, (legTelemetry?.hipRollTemp ?? 32.4) + thermalSimOffset));
    const hipPitchT = Math.max(20, Math.min(75, (legTelemetry?.hipPitchTemp ?? 38.2) + thermalSimOffset));
    const kneePitchT = Math.max(20, Math.min(75, (legTelemetry?.kneePitchTemp ?? 43.8) + thermalSimOffset));

    const rollThermalColor = getThermalColor(hipRollT, alpha);
    const hipThermalColor = getThermalColor(hipPitchT, alpha);
    const kneeThermalColor = getThermalColor(kneePitchT, alpha);
    const footColdColor = getThermalColor(22.0, alpha); // Cool foot contact with floor

    if (viewMode === 'thermal') {
      // -------------------------------------------------------------
      // FULL INFRARED FALSE-COLOR FLIR THERMAL CAMERA MODE
      // -------------------------------------------------------------

      // 1. Upper Leg Link (Thigh / Femur) Thermal Heat Gradient
      const thighGrad = ctx.createLinearGradient(leg.hipX, leg.hipY, leg.kneeX, leg.kneeY);
      thighGrad.addColorStop(0, hipThermalColor);
      thighGrad.addColorStop(1, kneeThermalColor);

      ctx.save();
      ctx.shadowColor = kneeThermalColor;
      ctx.shadowBlur = isBackground ? 8 : 16;
      ctx.strokeStyle = thighGrad;
      ctx.lineWidth = isBackground ? 11 : 15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(leg.hipX, leg.hipY);
      ctx.lineTo(leg.kneeX, leg.kneeY);
      ctx.stroke();
      ctx.restore();

      // Structural skeleton center core
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(leg.hipX, leg.hipY);
      ctx.lineTo(leg.kneeX, leg.kneeY);
      ctx.stroke();

      // 2. Lower Leg Link (Shank / Tibia) Thermal Heat Gradient
      const shankGrad = ctx.createLinearGradient(leg.kneeX, leg.kneeY, leg.footX, leg.footY);
      shankGrad.addColorStop(0, kneeThermalColor);
      shankGrad.addColorStop(1, footColdColor);

      ctx.save();
      ctx.shadowColor = kneeThermalColor;
      ctx.shadowBlur = isBackground ? 6 : 14;
      ctx.strokeStyle = shankGrad;
      ctx.lineWidth = isBackground ? 9 : 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(leg.kneeX, leg.kneeY);
      ctx.lineTo(leg.footX, leg.footY);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(leg.kneeX, leg.kneeY);
      ctx.lineTo(leg.footX, leg.footY);
      ctx.stroke();

      // 3. Render the 3 Actuators (Hip Roll, Hip Pitch, Knee Pitch)
      renderActuators(
        ctx,
        leg,
        hipRollT,
        hipPitchT,
        kneePitchT,
        rollThermalColor,
        hipThermalColor,
        kneeThermalColor,
        isBackground,
        true
      );

      // Foot contact pad
      ctx.fillStyle = footColdColor;
      ctx.beginPath();
      ctx.arc(leg.footX, leg.footY - 2, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      return;
    }

    if (viewMode === 'kinematic') {
      // Kinematics X-Ray: precise centerline vectors, torque arrows, angle tags
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(leg.hipX, leg.hipY);
      ctx.lineTo(leg.kneeX, leg.kneeY);
      ctx.lineTo(leg.footX, leg.footY);
      ctx.stroke();

      // Joint pivot circles
      ctx.fillStyle = '#0284c7';
      [
        [leg.hipX, leg.hipY],
        [leg.kneeX, leg.kneeY],
        [leg.footX, leg.footY],
      ].forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Monospace Angle HUD
      if (!isBackground) {
        ctx.fillStyle = '#7dd3fc';
        ctx.font = '8px "JetBrains Mono"';
        const hipDeg = Math.round((leg.hipPitchRad * 180) / Math.PI);
        const kneeDeg = Math.round((leg.kneePitchRad * 180) / Math.PI);
        ctx.fillText(`θh:${hipDeg}°`, leg.hipX + 10, leg.hipY);
        ctx.fillText(`θk:${kneeDeg}°`, leg.kneeX + 10, leg.kneeY);
      }
    } else if (viewMode === 'electrical') {
      // Electrical & CAN-FD Bus: pulsating glow wires to brushless motor
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(leg.hipX, leg.hipY);
      ctx.lineTo(leg.kneeX, leg.kneeY);
      ctx.stroke();
      ctx.strokeStyle = '#06b6d4';
      ctx.beginPath();
      ctx.moveTo(leg.kneeX, leg.kneeY);
      ctx.lineTo(leg.footX, leg.footY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Brushless motor coil indicator
      ctx.fillStyle = '#b45309';
      ctx.beginPath();
      ctx.arc(leg.hipX, leg.hipY, 8, 0, Math.PI * 2);
      ctx.arc(leg.kneeX, leg.kneeY, 7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Standard Bionic mode: carbon-fiber armor, anodized aluminum joints

      // 1. Upper Leg Link (Thigh / Femur)
      ctx.save();
      const upperAngle = Math.atan2(leg.kneeY - leg.hipY, leg.kneeX - leg.hipX);
      ctx.translate(leg.hipX, leg.hipY);
      ctx.rotate(upperAngle);

      const upperLen = Math.sqrt(
        (leg.kneeX - leg.hipX) ** 2 + (leg.kneeY - leg.hipY) ** 2
      );

      // Carbon Fiber Bone Polygon
      ctx.fillStyle = boneColor;
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(upperLen, -6);
      ctx.lineTo(upperLen, 6);
      ctx.lineTo(0, 9);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Aluminum cutouts & lightweight trusses
      ctx.fillStyle = darkPlate;
      ctx.fillRect(upperLen * 0.25, -3.5, upperLen * 0.45, 7);

      ctx.restore();

      // 2. Lower Leg Link (Shank / Tibia)
      ctx.save();
      const lowerAngle = Math.atan2(leg.footY - leg.kneeY, leg.footX - leg.kneeX);
      ctx.translate(leg.kneeX, leg.kneeY);
      ctx.rotate(lowerAngle);

      const lowerLen = Math.sqrt(
        (leg.footX - leg.kneeX) ** 2 + (leg.footY - leg.kneeY) ** 2
      );

      ctx.fillStyle = boneColor;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(lowerLen, -3.5);
      ctx.lineTo(lowerLen, 3.5);
      ctx.lineTo(0, 7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();

      // 3. Actuator Motor Housings (High-Torque Brushless Planetary Drives)
      // Hip Actuator
      ctx.fillStyle = darkPlate;
      ctx.beginPath();
      ctx.arc(leg.hipX, leg.hipY, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Central core screw
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(leg.hipX, leg.hipY, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Knee Actuator
      ctx.fillStyle = darkPlate;
      ctx.beginPath();
      ctx.arc(leg.kneeX, leg.kneeY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isBackground ? '#38bdf8' : '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 4. Compliant Rubber Foot Pad
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(leg.footX, leg.footY - 3, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Ground contact indicator ring if touching floor
      if (leg.footY >= 158) {
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(leg.footX, 160, 10, 3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // -------------------------------------------------------------
    // THERMAL HEAT MAP OVERLAY ON TOP OF BIONIC / KINEMATIC LIMB
    // -------------------------------------------------------------
    if (isThermal) {
      // 1. Femur / Thigh Thermal Overlay
      const thighGrad = ctx.createLinearGradient(leg.hipX, leg.hipY, leg.kneeX, leg.kneeY);
      thighGrad.addColorStop(0, getThermalColor(hipPitchT, 0.6));
      thighGrad.addColorStop(1, getThermalColor(kneePitchT, 0.7));

      ctx.save();
      ctx.shadowColor = kneeThermalColor;
      ctx.shadowBlur = isBackground ? 6 : 14;
      ctx.strokeStyle = thighGrad;
      ctx.lineWidth = isBackground ? 10 : 14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(leg.hipX, leg.hipY);
      ctx.lineTo(leg.kneeX, leg.kneeY);
      ctx.stroke();
      ctx.restore();

      // 2. Shank / Tibia Thermal Overlay
      const shankGrad = ctx.createLinearGradient(leg.kneeX, leg.kneeY, leg.footX, leg.footY);
      shankGrad.addColorStop(0, getThermalColor(kneePitchT, 0.7));
      shankGrad.addColorStop(1, getThermalColor(22.0, 0.45));

      ctx.save();
      ctx.shadowColor = kneeThermalColor;
      ctx.shadowBlur = isBackground ? 5 : 12;
      ctx.strokeStyle = shankGrad;
      ctx.lineWidth = isBackground ? 8 : 11;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(leg.kneeX, leg.kneeY);
      ctx.lineTo(leg.footX, leg.footY);
      ctx.stroke();
      ctx.restore();

      // 3. Draw 3 Actuators with exact thermal glow & temperature tags
      renderActuators(
        ctx,
        leg,
        hipRollT,
        hipPitchT,
        kneePitchT,
        rollThermalColor,
        hipThermalColor,
        kneeThermalColor,
        isBackground,
        false
      );
    }

    ctx.restore();
  };

  // Draw Robot Torso & Carbon Exoskeleton
  const drawChassis = (
    ctx: CanvasRenderingContext2D,
    len: number,
    h: number,
    viewMode: ViewMode,
    time: number,
    isThermal: boolean
  ) => {
    const halfL = len / 2;
    const halfH = h / 2;

    if (viewMode === 'electrical') {
      // Show internal 48V Battery Core & Dual CAN bus routing
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-halfL, -halfH, len, h);

      // Battery pack cell grid
      ctx.fillStyle = '#0369a1';
      ctx.fillRect(-halfL + 25, -halfH + 8, len * 0.55, h - 16);
      ctx.fillStyle = '#38bdf8';
      ctx.font = '9px "JetBrains Mono"';
      ctx.fillText('48V 15Ah Li-Ion Core', -halfL + 30, 2);

      // Microcontroller board
      ctx.fillStyle = '#065f46';
      ctx.fillRect(halfL * 0.25, -halfH + 8, 45, h - 16);
      ctx.fillStyle = '#34d399';
      ctx.fillText('STM32', halfL * 0.25 + 6, 2);
      return;
    }

    if (viewMode === 'thermal') {
      // Thermal false-color infrared visualization of main chassis
      const bmsT = (telemetry.bmsTemp || 31.6) + thermalSimOffset;
      const bmsColor = getThermalColor(bmsT, 0.85);
      const ambColor = getThermalColor(25.0, 0.75);

      const torsoGrad = ctx.createLinearGradient(-halfL, 0, halfL, 0);
      torsoGrad.addColorStop(0, ambColor);
      torsoGrad.addColorStop(0.5, bmsColor);
      torsoGrad.addColorStop(1, ambColor);

      ctx.save();
      ctx.shadowColor = bmsColor;
      ctx.shadowBlur = 12;
      ctx.fillStyle = torsoGrad;
      ctx.beginPath();
      ctx.moveTo(-halfL + 12, -halfH);
      ctx.lineTo(halfL - 25, -halfH);
      ctx.lineTo(halfL, -halfH + 12);
      ctx.lineTo(halfL - 10, halfH);
      ctx.lineTo(-halfL + 20, halfH);
      ctx.lineTo(-halfL, halfH - 15);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = bmsColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Battery pack core thermal radiation
      ctx.fillStyle = getThermalColor(bmsT + 3, 0.9);
      ctx.fillRect(-halfL + 30, -halfH + 10, len * 0.5, h - 20);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(-halfL + 30, -halfH + 10, len * 0.5, h - 20);

      ctx.fillStyle = '#ffffff';
      ctx.font = '8px "JetBrains Mono"';
      ctx.fillText(`BMS CORE: ${bmsT.toFixed(1)}°C`, -halfL + 34, 2);
      ctx.restore();
      return;
    }

    // Standard Bionic Exoskeleton
    // Carbon-fiber composite body shell
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.moveTo(-halfL + 12, -halfH);
    ctx.lineTo(halfL - 25, -halfH);
    ctx.lineTo(halfL, -halfH + 12);
    ctx.lineTo(halfL - 10, halfH);
    ctx.lineTo(-halfL + 20, halfH);
    ctx.lineTo(-halfL, halfH - 15);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.stroke();

    // High-tech Carbon Fiber Texture Strip
    ctx.fillStyle = '#141c2e';
    ctx.beginPath();
    ctx.moveTo(-halfL + 30, -halfH + 7);
    ctx.lineTo(halfL - 35, -halfH + 7);
    ctx.lineTo(halfL - 25, halfH - 12);
    ctx.lineTo(-halfL + 40, halfH - 12);
    ctx.closePath();
    ctx.fill();

    // Thermal overlay on bionic chassis if thermal is toggled
    if (isThermal) {
      const bmsT = (telemetry.bmsTemp || 31.6) + thermalSimOffset;
      const bmsColor = getThermalColor(bmsT, 0.45);
      ctx.save();
      ctx.fillStyle = bmsColor;
      ctx.fillRect(-halfL + 35, -halfH + 10, len * 0.45, h - 20);
      ctx.strokeStyle = getThermalColor(bmsT, 0.8);
      ctx.lineWidth = 1;
      ctx.strokeRect(-halfL + 35, -halfH + 10, len * 0.45, h - 20);
      ctx.restore();
    }

    // Spine LED Telemetry Strip (Battery indicator)
    const batPercent = telemetry.batteryPercent;
    const stripWidth = 100;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-stripWidth / 2, -halfH + 3, stripWidth, 4);

    const activeWidth = (stripWidth * batPercent) / 100;
    ctx.fillStyle = batPercent > 20 ? '#06b6d4' : '#ef4444';
    ctx.fillRect(-stripWidth / 2, -halfH + 3, activeWidth, 4);

    // Lateral Ventilation Gills & Decals
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    for (let x = -halfL + 55; x <= halfL - 60; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, -6);
      ctx.lineTo(x - 8, 8);
      ctx.stroke();
    }

    // Platform Wordmark & Creator Credit on Flank
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.font = 'bold 9px "Chakra Petch"';
    ctx.fillText('CERBERUS-04', -35, 12);
    ctx.font = '7px "JetBrains Mono"';
    ctx.fillStyle = 'rgba(100, 116, 139, 0.6)';
    ctx.fillText('AMIT NISHANKA BHUYAN', -45, -12);
  };

  // Draw Head, Visor Eyes & Dual-Depth LiDAR Unit
  const drawHeadAndSensors = (
    ctx: CanvasRenderingContext2D,
    neckBaseX: number,
    neckBaseY: number,
    pitch: number,
    viewMode: ViewMode,
    time: number
  ) => {
    ctx.save();
    ctx.translate(neckBaseX, neckBaseY);
    ctx.rotate(pitch * 0.5);

    // Neck linkage
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(28, -14);
    ctx.lineTo(34, -4);
    ctx.lineTo(6, 12);
    ctx.closePath();
    ctx.fill();

    // Head Unit Exoskeleton
    const headX = 26;
    const headY = -12;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(headX, headY - 14);
    ctx.lineTo(headX + 44, headY - 8);
    ctx.lineTo(headX + 54, headY + 5);
    ctx.lineTo(headX + 38, headY + 16);
    ctx.lineTo(headX + 2, headY + 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Glowing Cyan Visor (Stereo Depth Cameras)
    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.moveTo(headX + 34, headY - 4);
    ctx.lineTo(headX + 48, headY);
    ctx.lineTo(headX + 44, headY + 8);
    ctx.lineTo(headX + 32, headY + 4);
    ctx.closePath();
    ctx.fill();

    // Dual-Depth Spinning LiDAR Turret on top of head
    const lidarX = headX + 16;
    const lidarY = headY - 18;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(lidarX - 8, lidarY, 16, 6);

    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(lidarX, lidarY - 4, 7, Math.PI, 0);
    ctx.fill();

    // Animated Rotating LiDAR Beam in LiDAR view mode or standard
    const beamAngle = (time * 0.005) % (Math.PI * 2);
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lidarX, lidarY - 4);
    ctx.lineTo(lidarX + Math.cos(beamAngle) * 9, lidarY - 4 + Math.sin(beamAngle) * 5);
    ctx.stroke();

    if (viewMode === 'lidar') {
      // Draw 360° expanding LiDAR scan waves
      const sweepRad = (time * 0.003) % (Math.PI * 2);
      ctx.save();
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
      ctx.lineWidth = 1;
      for (let r = 50; r <= 320; r += 70) {
        ctx.beginPath();
        ctx.arc(lidarX, lidarY, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Sweeping cone
      const coneGrad = ctx.createRadialGradient(lidarX, lidarY, 10, lidarX, lidarY, 300);
      coneGrad.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
      coneGrad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(lidarX, lidarY);
      ctx.arc(lidarX, lidarY, 300, sweepRad - 0.35, sweepRad + 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  };

  // Draw 2D HUD Overlays (Coordinates, Speedometer, Kinematics Readout)
  const drawHUDOverlays = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    // Top-left platform status
    const hudBoxH = velocityVectorEnabled ? 88 : 68;
    ctx.fillStyle = 'rgba(8, 13, 26, 0.85)';
    ctx.fillRect(16, 16, 260, hudBoxH);
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(16, 16, 260, hudBoxH);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px "Chakra Petch"';
    ctx.fillText('12-DOF BIONIC QUADRUPED', 28, 36);

    ctx.font = '11px "JetBrains Mono"';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(
      `SPEED: ${telemetry.emergencyStop ? '0.00' : telemetry.linearVelocity.toFixed(2)} m/s`,
      28,
      54
    );
    ctx.fillText(`GAIT: ${telemetry.gait.toUpperCase()}`, 150, 54);

    ctx.fillStyle = telemetry.emergencyStop ? '#f43f5e' : '#34d399';
    ctx.fillText(
      `STATUS: ${telemetry.emergencyStop ? 'E-STOP LOCKED' : 'NOMINAL 400Hz'}`,
      28,
      72
    );

    if (velocityVectorEnabled) {
      ctx.font = '10px "JetBrains Mono"';
      ctx.fillStyle = '#22d3ee';
      const rotSign = telemetry.angularVelocity >= 0 ? '+' : '';
      ctx.fillText(
        `V_VEC: v=${telemetry.linearVelocity.toFixed(2)}m/s  ω=${rotSign}${telemetry.angularVelocity.toFixed(2)}rad/s`,
        28,
        85
      );
    }

    // Top-right view mode badge
    ctx.fillStyle = 'rgba(8, 13, 26, 0.85)';
    ctx.fillRect(w - 180, 16, 164, 40);
    ctx.strokeStyle = isThermalActive ? 'rgba(244, 63, 94, 0.8)' : 'rgba(30, 41, 59, 0.8)';
    ctx.lineWidth = isThermalActive ? 1.5 : 1;
    ctx.strokeRect(w - 180, 16, 164, 40);

    ctx.fillStyle = isThermalActive ? '#f43f5e' : '#06b6d4';
    ctx.font = 'bold 11px "Chakra Petch"';
    ctx.fillText(
      isThermalActive ? 'VIEW: THERMAL FLIR' : `VIEW: ${telemetry.viewMode.toUpperCase()} MODE`,
      w - 168,
      40
    );

    // If Thermal Heat Map or Thermal Mode is active, draw vertical FLIR color calibration legend
    if (isThermalActive) {
      const allTemps: number[] = [];
      (['fl', 'fr', 'rl', 'rr'] as const).forEach((id) => {
        const j = telemetry.legs?.[id];
        allTemps.push(
          Math.max(20, Math.min(75, (j?.hipRollTemp ?? 32.4) + thermalSimOffset)),
          Math.max(20, Math.min(75, (j?.hipPitchTemp ?? 38.2) + thermalSimOffset)),
          Math.max(20, Math.min(75, (j?.kneePitchTemp ?? 43.8) + thermalSimOffset))
        );
      });
      const peakTemp = Math.max(...allTemps);
      const minTemp = Math.min(...allTemps);

      // Vertical FLIR Thermal Palette Scale Bar on right edge
      const barX = w - 38;
      const barY = 80;
      const barW = 12;
      const barH = 160;

      // Card backdrop
      ctx.fillStyle = 'rgba(8, 13, 26, 0.92)';
      ctx.fillRect(barX - 74, barY - 20, 100, barH + 54);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(barX - 74, barY - 20, 100, barH + 54);

      // Title
      ctx.fillStyle = '#f43f5e';
      ctx.font = 'bold 9px "Chakra Petch"';
      ctx.fillText('FLIR CALIBRATION', barX - 68, barY - 8);

      // Vertical gradient from Red (60°C) down to Blue (20°C)
      const flirGrad = ctx.createLinearGradient(0, barY, 0, barY + barH);
      flirGrad.addColorStop(0.0, getThermalColor(60));
      flirGrad.addColorStop(0.2, getThermalColor(52));
      flirGrad.addColorStop(0.4, getThermalColor(44));
      flirGrad.addColorStop(0.65, getThermalColor(36));
      flirGrad.addColorStop(0.85, getThermalColor(28));
      flirGrad.addColorStop(1.0, getThermalColor(20));

      ctx.fillStyle = flirGrad;
      ctx.fillRect(barX, barY, barW, barH);
      ctx.strokeStyle = '#475569';
      ctx.strokeRect(barX, barY, barW, barH);

      // Ticks and scale labels
      ctx.font = '8px "JetBrains Mono"';
      ctx.textAlign = 'right';
      const stops = [
        { t: 60, y: barY + 3, color: getThermalColor(60) },
        { t: 50, y: barY + barH * 0.25, color: getThermalColor(50) },
        { t: 40, y: barY + barH * 0.5, color: getThermalColor(40) },
        { t: 30, y: barY + barH * 0.75, color: getThermalColor(30) },
        { t: 20, y: barY + barH - 3, color: getThermalColor(20) },
      ];

      stops.forEach((stop) => {
        ctx.fillStyle = stop.color;
        ctx.fillText(`${stop.t}°C`, barX - 6, stop.y + 3);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.moveTo(barX - 4, stop.y);
        ctx.lineTo(barX, stop.y);
        ctx.stroke();
      });

      // 12-actuator summary metrics
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f43f5e';
      ctx.font = 'bold 8px "JetBrains Mono"';
      ctx.fillText(`MAX: ${peakTemp.toFixed(1)}°C`, barX - 68, barY + barH + 14);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`MIN: ${minTemp.toFixed(1)}°C`, barX - 68, barY + barH + 26);
    }
  };

  // Handle Canvas Click to place target waypoint
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Transform screen coords to world coords
    const worldX = (clickX - canvas.width / 2 - cameraOffset.x) / cameraZoom;
    const worldDistMeters = worldX / 120;
    const newTargetX = telemetry.positionX + worldDistMeters;
    const newTargetY = telemetry.positionY;

    updateTelemetry({
      targetWaypoint: { x: newTargetX, y: newTargetY },
      gait: telemetry.gait === 'stand' ? 'trot' : telemetry.gait,
    });
  };

  // Mouse pan and zoom handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX - cameraOffset.x, y: e.clientY - cameraOffset.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setCameraOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
    setCameraZoom((prev) => Math.max(0.6, Math.min(2.2, prev + zoomDelta)));
  };

  const resetCamera = () => {
    setCameraZoom(1.0);
    setCameraOffset({ x: 0, y: 0 });
  };

  return (
    <div className="relative w-full h-[520px] bg-[#060a14] rounded-xl border border-slate-800/90 overflow-hidden shadow-2xl">
      {/* Interactive Canvas */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-crosshair block"
      />

      {/* Floating Thermal Mode & Heat Simulation Controls (Top-Right) */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {isThermalActive && (
          <div className="flex items-center gap-1.5 bg-[#090e1c]/90 backdrop-blur border border-slate-800/90 rounded-lg px-2.5 py-1.5 text-xs font-mono shadow-lg">
            <span className="text-slate-400 flex items-center gap-1 text-[11px]">
              <Thermometer className="w-3.5 h-3.5 text-rose-400" />
              <span>Load:</span>
            </span>
            <button
              onClick={() => setThermalSimOffset((prev) => Math.max(-15, prev - 5))}
              className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 hover:bg-slate-800 text-cyan-300 cursor-pointer text-[11px]"
              title="Cool down actuators (-5°C)"
            >
              -5°C (Cool)
            </button>
            <button
              onClick={() => setThermalSimOffset((prev) => Math.min(25, prev + 5))}
              className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 hover:bg-slate-800 text-rose-300 cursor-pointer text-[11px]"
              title="Heat up actuators (+5°C)"
            >
              +5°C (Heat)
            </button>
            {thermalSimOffset !== 0 && (
              <button
                onClick={() => setThermalSimOffset(0)}
                className="px-1.5 py-0.5 text-slate-400 hover:text-slate-200 text-[10px] cursor-pointer underline"
                title="Reset simulation offset"
              >
                Reset
              </button>
            )}
          </div>
        )}

        <button
          onClick={() => setThermalOverlayEnabled((prev) => !prev)}
          className={`px-3 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-2 cursor-pointer transition-all shadow-lg backdrop-blur-md ${
            isThermalActive
              ? 'bg-rose-950/80 border-rose-500 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
              : 'bg-[#090e1c]/80 border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <Flame className={`w-3.5 h-3.5 ${isThermalActive ? 'text-rose-400 animate-pulse' : 'text-slate-400'}`} />
          <span>{isThermalActive ? 'THERMAL OVERLAY: ACTIVE' : 'OVERLAY THERMAL MAP'}</span>
        </button>

        {/* Velocity Vector Arrow Toggle */}
        <button
          onClick={() => setVelocityVectorEnabled((prev) => !prev)}
          className={`px-3 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-2 cursor-pointer transition-all shadow-lg backdrop-blur-md ${
            velocityVectorEnabled
              ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
              : 'bg-[#090e1c]/80 border-slate-800 text-slate-400 hover:border-slate-700'
          }`}
          title="Toggle dynamic center-of-mass velocity vector arrow"
        >
          <Navigation className={`w-3.5 h-3.5 ${velocityVectorEnabled ? 'text-cyan-400' : 'text-slate-400'}`} />
          <span>{velocityVectorEnabled ? 'VELOCITY VECTOR: ON' : 'VELOCITY VECTOR: OFF'}</span>
        </button>

        {/* Quick Velocity & Yaw Vector Test Controls */}
        {velocityVectorEnabled && (
          <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-[#090e1c]/90 border border-slate-800/90 text-xs font-mono backdrop-blur shadow-md">
            <span className="text-[10px] text-slate-400 font-bold uppercase pl-1">Vector Test:</span>
            <button
              onClick={() =>
                updateTelemetry({
                  linearVelocity: Math.min(3.5, Math.max(0, telemetry.linearVelocity) + 0.5),
                  gait: telemetry.gait === 'stand' ? 'trot' : telemetry.gait,
                })
              }
              className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 hover:bg-slate-800 text-cyan-300 cursor-pointer text-[11px]"
              title="Increase forward linear velocity (+0.5 m/s)"
            >
              +0.5 m/s
            </button>
            <button
              onClick={() =>
                updateTelemetry({
                  angularVelocity: Math.max(-2.0, telemetry.angularVelocity - 0.5),
                })
              }
              className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 hover:bg-slate-800 text-amber-300 cursor-pointer text-[11px]"
              title="Steer counter-clockwise / left (Yaw -0.5 rad/s)"
            >
              ⟲ -ω
            </button>
            <button
              onClick={() =>
                updateTelemetry({
                  angularVelocity: Math.min(2.0, telemetry.angularVelocity + 0.5),
                })
              }
              className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 hover:bg-slate-800 text-amber-300 cursor-pointer text-[11px]"
              title="Steer clockwise / right (Yaw +0.5 rad/s)"
            >
              ⟳ +ω
            </button>
            {(telemetry.linearVelocity !== 0 || telemetry.angularVelocity !== 0) && (
              <button
                onClick={() =>
                  updateTelemetry({
                    linearVelocity: 0,
                    angularVelocity: 0,
                  })
                }
                className="px-1.5 py-0.5 text-slate-400 hover:text-slate-200 text-[10px] cursor-pointer underline"
                title="Halt motion (0 m/s, 0 rad/s)"
              >
                Halt
              </button>
            )}
          </div>
        )}
      </div>

      {/* Floating View Mode & Camera Toolbars */}
      <div className="absolute bottom-4 left-4 z-10 flex flex-wrap items-center gap-1.5 p-1 bg-[#090e1c]/90 backdrop-blur border border-slate-800/90 rounded-lg">
        <button
          onClick={() => updateTelemetry({ viewMode: 'bionic' })}
          className={`px-3 py-1.5 text-xs font-mono rounded flex items-center gap-1.5 cursor-pointer transition-colors ${
            telemetry.viewMode === 'bionic'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Bionic</span>
        </button>

        <button
          onClick={() => updateTelemetry({ viewMode: 'kinematic' })}
          className={`px-3 py-1.5 text-xs font-mono rounded flex items-center gap-1.5 cursor-pointer transition-colors ${
            telemetry.viewMode === 'kinematic'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>12-DOF X-Ray</span>
        </button>

        <button
          onClick={() => updateTelemetry({ viewMode: 'electrical' })}
          className={`px-3 py-1.5 text-xs font-mono rounded flex items-center gap-1.5 cursor-pointer transition-colors ${
            telemetry.viewMode === 'electrical'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>Power Bus</span>
        </button>

        <button
          onClick={() => updateTelemetry({ viewMode: 'lidar' })}
          className={`px-3 py-1.5 text-xs font-mono rounded flex items-center gap-1.5 cursor-pointer transition-colors ${
            telemetry.viewMode === 'lidar'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>LiDAR SLAM</span>
        </button>

        <button
          onClick={() => updateTelemetry({ viewMode: 'thermal' })}
          className={`px-3 py-1.5 text-xs font-mono rounded flex items-center gap-1.5 cursor-pointer transition-colors ${
            telemetry.viewMode === 'thermal'
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Flame className="w-3.5 h-3.5 text-rose-400" />
          <span>Thermal Map</span>
        </button>
      </div>

      {/* Floating Camera Controls */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 p-1 bg-[#090e1c]/90 backdrop-blur border border-slate-800/90 rounded-lg">
        <button
          onClick={() => setCameraZoom((z) => Math.min(2.2, z + 0.2))}
          title="Zoom In"
          className="px-2.5 py-1 text-xs font-mono text-slate-300 hover:text-cyan-300 cursor-pointer"
        >
          +
        </button>
        <span className="text-[11px] font-mono text-slate-400 w-10 text-center">
          {Math.round(cameraZoom * 100)}%
        </span>
        <button
          onClick={() => setCameraZoom((z) => Math.max(0.6, z - 0.2))}
          title="Zoom Out"
          className="px-2.5 py-1 text-xs font-mono text-slate-300 hover:text-cyan-300 cursor-pointer"
        >
          -
        </button>
        <button
          onClick={resetCamera}
          title="Reset Camera View"
          className="px-2 py-1 text-slate-400 hover:text-slate-200 cursor-pointer border-l border-slate-800"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Click instructions banner */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none hidden sm:flex items-center gap-2 text-xs font-mono text-slate-400/80 bg-slate-950/70 px-3 py-1 rounded-full border border-slate-800/50">
        <Target className="w-3 h-3 text-cyan-400" />
        <span>Click anywhere on ground to set autonomous navigation target</span>
      </div>
    </div>
  );
};
