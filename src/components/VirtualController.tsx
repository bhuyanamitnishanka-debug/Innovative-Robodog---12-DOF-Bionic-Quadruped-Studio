import React, { useState, useRef, useEffect, useMemo } from 'react';
import { TelemetryState, GaitType, DiagnosticEvent } from '../types/robotics';
import { audioSynth } from '../utils/audioSynthesizer';
import {
  BatteryCharging,
  Radio,
  Play,
  Square,
  Footprints,
  Zap,
  Activity,
  Gauge,
  Sliders,
  Sparkles,
  ChevronRight,
  TrendingUp,
  Flame,
  Mountain,
  AlertTriangle,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';

interface VirtualControllerProps {
  telemetry: TelemetryState;
  updateTelemetry: (partial: Partial<TelemetryState>) => void;
  onLogDiagnosticEvent?: (event: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'>) => void;
}

interface GaitPatternConfig {
  id: GaitType;
  label: string;
  category: 'core' | 'auxiliary';
  subtitle: string;
  patternType: string;
  dutyFactor: string;
  dutyRatio: number;
  speedRange: string;
  minSpeed: number;
  maxSpeed: number;
  defaultSpeed: number;
  minStrideMm: number;
  maxStrideMm: number;
  minFreqHz: number;
  maxFreqHz: number;
  stabilityMargin: string;
  energyCost: string;
  description: string;
  footfallSequence: { leg: string; phase: string }[];
}

export const VirtualController: React.FC<VirtualControllerProps> = ({
  telemetry,
  updateTelemetry,
  onLogDiagnosticEvent,
}) => {
  const stickRef = useRef<HTMLDivElement | null>(null);
  const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
  const isDraggingStick = useRef(false);

  // Power Burst & Maximum Climbing Torque Override State
  const [isPowerBurstActive, setIsPowerBurstActive] = useState<boolean>(false);
  const [burstDuration, setBurstDuration] = useState<number>(8.0); // seconds: 5s, 8s, 12s
  const [burstRemainingSec, setBurstRemainingSec] = useState<number>(0);
  const [burstCooldownSec, setBurstCooldownSec] = useState<number>(0);
  const [climbInclineAngle, setClimbInclineAngle] = useState<number>(35); // degrees
  const savedNominalRef = useRef<{
    power: number;
    current: number;
    totalTorqueOutput: number;
    linearVelocity: number;
    bodyPitch: number;
    stanceHeight: number;
    legs: any;
  } | null>(null);

  // Comprehensive Gait Selection Matrix Configurations with Kinematic Bounds
  const gaitMatrix: GaitPatternConfig[] = [
    {
      id: 'walk',
      label: 'WALK',
      category: 'core',
      subtitle: 'Lateral Sequence Pacing',
      patternType: 'RH → RF → LH → LF',
      dutyFactor: '65% Stance',
      dutyRatio: 0.65,
      speedRange: '0.4 - 1.8 m/s',
      minSpeed: 0.2,
      maxSpeed: 1.8,
      defaultSpeed: 1.1,
      minStrideMm: 140,
      maxStrideMm: 310,
      minFreqHz: 0.8,
      maxFreqHz: 1.7,
      stabilityMargin: '94% (High Margin)',
      energyCost: '142 J/m',
      description: 'Smooth 4-phase sequential pacing with steady ground adhesion, compliant joint damping, and minimal battery drain.',
      footfallSequence: [
        { leg: 'FL', phase: '0.00' },
        { leg: 'FR', phase: '0.25' },
        { leg: 'RL', phase: '0.75' },
        { leg: 'RR', phase: '0.50' },
      ],
    },
    {
      id: 'trot',
      label: 'TROT',
      category: 'core',
      subtitle: 'Diagonal Synchronization',
      patternType: 'FL+RR ⟷ FR+RL',
      dutyFactor: '50% Stance',
      dutyRatio: 0.50,
      speedRange: '0.6 - 2.8 m/s',
      minSpeed: 0.4,
      maxSpeed: 2.8,
      defaultSpeed: 1.6,
      minStrideMm: 180,
      maxStrideMm: 380,
      minFreqHz: 1.1,
      maxFreqHz: 2.6,
      stabilityMargin: '78% (Dynamic Balance)',
      energyCost: '115 J/m (Optimal)',
      description: 'Standard agile patrol gait featuring diagonal limb pairing with harmonic kinetic energy recapture and mid-level compliance.',
      footfallSequence: [
        { leg: 'FL', phase: '0.00 (Pair 1)' },
        { leg: 'FR', phase: '0.50 (Pair 2)' },
        { leg: 'RL', phase: '0.50 (Pair 2)' },
        { leg: 'RR', phase: '0.00 (Pair 1)' },
      ],
    },
    {
      id: 'gallop',
      label: 'GALLOP',
      category: 'core',
      subtitle: 'Transverse Sprint & Flight',
      patternType: 'Rotary Ballistic Leap',
      dutyFactor: '35% Stance (Aerial)',
      dutyRatio: 0.35,
      speedRange: '1.4 - 3.8 m/s',
      minSpeed: 0.8,
      maxSpeed: 3.8,
      defaultSpeed: 3.2,
      minStrideMm: 240,
      maxStrideMm: 480,
      minFreqHz: 1.8,
      maxFreqHz: 3.9,
      stabilityMargin: '45% (Ballistic Flight)',
      energyCost: '260 J/m',
      description: 'High-speed athletic sprint with full airborne suspension phase, delivering maximum forward acceleration and hurdle clearance.',
      footfallSequence: [
        { leg: 'FL', phase: '0.00' },
        { leg: 'FR', phase: '0.12' },
        { leg: 'RL', phase: '0.55' },
        { leg: 'RR', phase: '0.75' },
      ],
    },
    {
      id: 'creep',
      label: 'CREEP',
      category: 'core',
      subtitle: 'Hyper-Static Crawling',
      patternType: '3-Leg Constant Support',
      dutyFactor: '75% Stance',
      dutyRatio: 0.75,
      speedRange: '0.1 - 0.7 m/s',
      minSpeed: 0.1,
      maxSpeed: 0.7,
      defaultSpeed: 0.4,
      minStrideMm: 60,
      maxStrideMm: 160,
      minFreqHz: 0.4,
      maxFreqHz: 1.1,
      stabilityMargin: '99% (Max Static Margin)',
      energyCost: '185 J/m',
      description: 'Ultra-low velocity, maximum stability crawling pattern ensuring 3 limbs firmly planted at all times for loose rubble and steep grades.',
      footfallSequence: [
        { leg: 'FL', phase: '0.00' },
        { leg: 'FR', phase: '0.25' },
        { leg: 'RL', phase: '0.75' },
        { leg: 'RR', phase: '0.50' },
      ],
    },
    {
      id: 'pace',
      label: 'PACE',
      category: 'auxiliary',
      subtitle: 'Lateral Synchronized',
      patternType: 'FL+RL ⟷ FR+RR',
      dutyFactor: '50% Stance',
      dutyRatio: 0.50,
      speedRange: '0.6 - 2.4 m/s',
      minSpeed: 0.4,
      maxSpeed: 2.4,
      defaultSpeed: 1.4,
      minStrideMm: 160,
      maxStrideMm: 340,
      minFreqHz: 1.0,
      maxFreqHz: 2.2,
      stabilityMargin: '68% (Lateral Sway)',
      energyCost: '130 J/m',
      description: 'Lateral pair synchronization with characteristic horizontal pendulum sway, ideal for wide corridors and flat surfaces.',
      footfallSequence: [
        { leg: 'FL', phase: '0.00' },
        { leg: 'FR', phase: '0.50' },
        { leg: 'RL', phase: '0.00' },
        { leg: 'RR', phase: '0.50' },
      ],
    },
    {
      id: 'bound',
      label: 'BOUND',
      category: 'auxiliary',
      subtitle: 'Paired Front/Rear Leaps',
      patternType: 'FL+FR ⟷ RL+RR',
      dutyFactor: '40% Stance',
      dutyRatio: 0.40,
      speedRange: '0.8 - 3.2 m/s',
      minSpeed: 0.6,
      maxSpeed: 3.2,
      defaultSpeed: 2.2,
      minStrideMm: 200,
      maxStrideMm: 420,
      minFreqHz: 1.4,
      maxFreqHz: 2.8,
      stabilityMargin: '55% (Sagittal Bound)',
      energyCost: '220 J/m',
      description: 'Paired front and rear leg actuation producing pronounced body pitch oscillations for bounding over hurdles and ditches.',
      footfallSequence: [
        { leg: 'FL', phase: '0.00' },
        { leg: 'FR', phase: '0.00' },
        { leg: 'RL', phase: '0.50' },
        { leg: 'RR', phase: '0.50' },
      ],
    },
    {
      id: 'stand',
      label: 'STAND',
      category: 'auxiliary',
      subtitle: 'Compliant Balance Stance',
      patternType: '4-Point Locked Stance',
      dutyFactor: '100% Stance',
      dutyRatio: 1.0,
      speedRange: '0.0 m/s',
      minSpeed: 0.0,
      maxSpeed: 0.0,
      defaultSpeed: 0.0,
      minStrideMm: 0,
      maxStrideMm: 0,
      minFreqHz: 0.0,
      maxFreqHz: 0.0,
      stabilityMargin: '100% (Static Hold)',
      energyCost: '48 W (Holding)',
      description: 'All 4 footpads planted firmly with compliant joint impedance absorption, ready for immediate kinematic transition.',
      footfallSequence: [
        { leg: 'FL', phase: 'Static' },
        { leg: 'FR', phase: 'Static' },
        { leg: 'RL', phase: 'Static' },
        { leg: 'RR', phase: 'Static' },
      ],
    },
  ];

  const activeGaitConfig = useMemo(() => {
    return gaitMatrix.find((g) => g.id === telemetry.gait) || gaitMatrix[1];
  }, [telemetry.gait]);

  // Compute Stride Length & Swing Frequency Dynamically from Gait Velocity
  const computeKinematicsFromVelocity = (
    gaitConfig: GaitPatternConfig,
    velocity: number,
    forcePowerBurst: boolean = false
  ) => {
    const burstEffective = forcePowerBurst || isPowerBurstActive;

    if (gaitConfig.id === 'stand' || velocity <= 0.02) {
      return {
        frequency: 0,
        stride: 0,
        contactDurationMs: 0,
        cadenceStepsPerMin: 0,
      };
    }

    // Power Burst expands velocity ceiling by +60%
    const maxSpeedLimit = burstEffective ? gaitConfig.maxSpeed * 1.6 : gaitConfig.maxSpeed;
    const clampedVelocity = Math.max(0, Math.min(maxSpeedLimit, velocity));
    const k = Math.min(1.0, clampedVelocity / Math.max(0.1, maxSpeedLimit));

    // Stride length scales broader in Power Burst for climbing ledges & boulders (+35%)
    const maxStrideLimit = burstEffective
      ? Math.round(gaitConfig.maxStrideMm * 1.35)
      : gaitConfig.maxStrideMm;
    const stride = Math.round(
      gaitConfig.minStrideMm + k * (maxStrideLimit - gaitConfig.minStrideMm)
    );

    // Swing frequency scales with cadence (+25% headroom in burst)
    const maxFreqLimit = burstEffective
      ? parseFloat((gaitConfig.maxFreqHz * 1.25).toFixed(2))
      : gaitConfig.maxFreqHz;
    const frequency = parseFloat(
      (gaitConfig.minFreqHz + k * (maxFreqLimit - gaitConfig.minFreqHz)).toFixed(2)
    );

    // Ground contact duration in milliseconds: (dutyRatio / frequency) * 1000
    const contactDurationMs =
      frequency > 0 ? Math.round((gaitConfig.dutyRatio / frequency) * 1000) : 0;

    const cadenceStepsPerMin = Math.round(frequency * 60 * 2); // 2 steps per limb cycle

    return {
      frequency,
      stride,
      contactDurationMs,
      cadenceStepsPerMin,
    };
  };

  // Live Computed Kinematics based on current telemetry state
  const liveKinematics = useMemo(() => {
    return computeKinematicsFromVelocity(activeGaitConfig, telemetry.linearVelocity);
  }, [activeGaitConfig, telemetry.linearVelocity, isPowerBurstActive]);

  // Handle Gait Velocity Slider Drag / Input
  const handleVelocitySliderChange = (newVelocity: number) => {
    const isStationary = activeGaitConfig.id === 'stand' || newVelocity <= 0.02;
    const computed = computeKinematicsFromVelocity(activeGaitConfig, newVelocity);

    updateTelemetry({
      linearVelocity: parseFloat(newVelocity.toFixed(2)),
      strideLength: computed.stride,
      swingFrequency: computed.frequency,
      gait: !isStationary && telemetry.gait === 'stand' ? 'trot' : telemetry.gait,
    });
  };

  // Apply Gait Selection with Speed & Kinematic Modulation Adaptation
  const handleSelectGait = (gaitConfig: GaitPatternConfig) => {
    const isStationary = gaitConfig.id === 'stand';
    const targetSpeed = isStationary ? 0 : gaitConfig.defaultSpeed;
    const computed = computeKinematicsFromVelocity(gaitConfig, targetSpeed);

    updateTelemetry({
      gait: gaitConfig.id,
      linearVelocity: targetSpeed,
      strideLength: computed.stride,
      swingFrequency: computed.frequency,
      angularVelocity: isStationary ? 0 : telemetry.angularVelocity,
    });

    if (telemetry.audioEnabled) {
      audioSynth.playFootstep(true);
    }
  };

  // Engage Power Burst: Overrides current gait limits to provide maximum torque for climbing
  const engagePowerBurst = () => {
    if (isPowerBurstActive || burstCooldownSec > 0 || telemetry.emergencyStop) return;

    // Snapshot pre-burst baseline
    savedNominalRef.current = {
      power: telemetry.power,
      current: telemetry.current,
      totalTorqueOutput: telemetry.totalTorqueOutput,
      linearVelocity: telemetry.linearVelocity,
      bodyPitch: telemetry.bodyPitch,
      stanceHeight: telemetry.stanceHeight,
      legs: JSON.parse(JSON.stringify(telemetry.legs)),
    };

    setIsPowerBurstActive(true);
    setBurstRemainingSec(burstDuration);

    const overdrivenVelocity = Math.min(
      activeGaitConfig.maxSpeed * 1.6,
      Math.max(telemetry.linearVelocity * 1.3, activeGaitConfig.defaultSpeed * 1.25)
    );
    const overdrivenKinematics = computeKinematicsFromVelocity(
      activeGaitConfig,
      overdrivenVelocity,
      true
    );

    // Maximum joint torque override for climbing (nominal ~14-16 N·m overridden to ~43-45 N·m)
    const peakLegs = {
      fl: { ...telemetry.legs.fl, torque: 43.5, hipPitch: telemetry.legs.fl.hipPitch + 6 },
      fr: { ...telemetry.legs.fr, torque: 42.8, hipPitch: telemetry.legs.fr.hipPitch + 6 },
      rl: { ...telemetry.legs.rl, torque: 45.0, hipPitch: telemetry.legs.rl.hipPitch + 8 },
      rr: { ...telemetry.legs.rr, torque: 44.6, hipPitch: telemetry.legs.rr.hipPitch + 8 },
    };

    // Calculate pitch trim based on climbInclineAngle: steeper incline -> more forward pitch trim
    const climbPitchTrim = climbInclineAngle >= 40 ? -12 : climbInclineAngle >= 30 ? -8 : -5;
    const climbStanceHeight = 255; // Raised stance height for obstacle & incline clearance

    updateTelemetry({
      powerBurstActive: true,
      powerBurstRemainingSec: burstDuration,
      totalTorqueOutput: 172.0, // Overriding total torque output to 172.0 N·m maximum!
      legs: peakLegs,
      power: 785.0, // Spikes bus power to 785W peak
      current: 16.3, // Spikes inverter current draw to 16.3A
      bodyPitch: climbPitchTrim,
      stanceHeight: climbStanceHeight,
      linearVelocity: parseFloat(overdrivenVelocity.toFixed(2)),
      strideLength: overdrivenKinematics.stride,
      swingFrequency: overdrivenKinematics.frequency,
      gait: telemetry.gait === 'stand' ? 'trot' : telemetry.gait,
    });

    if (telemetry.audioEnabled) {
      audioSynth.playPowerBurst(true);
    }

    // Log high-intensity event to diagnostic panel
    const highIntensityEvent: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'> = {
      severity: 'critical',
      subsystem: 'ACTUATORS',
      code: 'PWR_BURST_MAX_TORQUE_OVERRIDE',
      message: `HIGH-INTENSITY EVENT: Power Burst engaged! Inverter current limits overridden to 280% (45.0 N·m peak joint torque). Gait kinematic boundaries bypassed for ${climbInclineAngle}° climbing ascent.`,
      metric: `Peak Torque: 172.0 N·m | Inverter: 785W / 16.3A | Incline: ${climbInclineAngle}°`,
    };

    if (onLogDiagnosticEvent) {
      onLogDiagnosticEvent(highIntensityEvent);
    }
    window.dispatchEvent(
      new CustomEvent('robodog:log-diagnostic-event', { detail: highIntensityEvent })
    );
  };

  // Disengage Power Burst: Restores nominal closed-loop limits
  const disengagePowerBurst = (isTimeout: boolean = false) => {
    setIsPowerBurstActive(false);
    setBurstRemainingSec(0);
    setBurstCooldownSec(4.0); // 4 seconds thermal recovery cooldown

    const nominal = savedNominalRef.current;
    const normalMaxSpeed = activeGaitConfig.maxSpeed;
    const targetVelocity = Math.min(normalMaxSpeed, telemetry.linearVelocity);
    const normalKinematics = computeKinematicsFromVelocity(
      activeGaitConfig,
      targetVelocity,
      false
    );

    updateTelemetry({
      powerBurstActive: false,
      powerBurstRemainingSec: 0,
      totalTorqueOutput: nominal ? nominal.totalTorqueOutput : 60.4,
      legs: nominal ? nominal.legs : telemetry.legs,
      power: nominal ? nominal.power : 234.0,
      current: nominal ? nominal.current : 4.85,
      bodyPitch: nominal ? nominal.bodyPitch : 0,
      stanceHeight: nominal ? nominal.stanceHeight : 220,
      linearVelocity: parseFloat(targetVelocity.toFixed(2)),
      strideLength: normalKinematics.stride,
      swingFrequency: normalKinematics.frequency,
    });

    const recoveryEvent: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'> = {
      severity: 'info',
      subsystem: 'ACTUATORS',
      code: 'PWR_BURST_DISENGAGED',
      message: `Power Burst cycle concluded (${isTimeout ? 'auto-timer expired' : 'operator disengaged'}). Inverter gate drivers restored to nominal closed-loop FOC limits (60.4 N·m total). Actuator thermal recovery engaged.`,
      metric: `Torque: 60.4 N·m | Power: 234W / 4.85A | Limits: RESTORED`,
    };

    if (onLogDiagnosticEvent) {
      onLogDiagnosticEvent(recoveryEvent);
    }
    window.dispatchEvent(
      new CustomEvent('robodog:log-diagnostic-event', { detail: recoveryEvent })
    );
  };

  // Power Burst Countdown & Thermal Cooldown Loop
  useEffect(() => {
    if (!isPowerBurstActive && burstCooldownSec <= 0) return;

    const interval = setInterval(() => {
      if (isPowerBurstActive) {
        setBurstRemainingSec((prev) => {
          const next = Math.max(0, prev - 0.1);
          if (next <= 0.05) {
            disengagePowerBurst(true);
            return 0;
          }
          return parseFloat(next.toFixed(1));
        });

        updateTelemetry({
          powerBurstRemainingSec: Math.max(0, burstRemainingSec - 0.1),
          avgMotorTemp: parseFloat((telemetry.avgMotorTemp + 0.02).toFixed(2)),
        });
      } else if (burstCooldownSec > 0) {
        setBurstCooldownSec((prev) => Math.max(0, parseFloat((prev - 0.1).toFixed(1))));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isPowerBurstActive, burstCooldownSec, burstRemainingSec, telemetry.avgMotorTemp]);

  // Handle Virtual Joystick Drag
  const handleStickPointerDown = (e: React.PointerEvent) => {
    isDraggingStick.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateStickFromEvent(e);
  };

  const handleStickPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingStick.current) return;
    updateStickFromEvent(e);
  };

  const handleStickPointerUp = (e: React.PointerEvent) => {
    if (!isDraggingStick.current) return;
    isDraggingStick.current = false;
    setStickPos({ x: 0, y: 0 });
    if (telemetry.gait === 'stand') {
      updateTelemetry({
        linearVelocity: 0,
        angularVelocity: 0,
        strideLength: 0,
        swingFrequency: 0,
      });
    }
  };

  const updateStickFromEvent = (e: React.PointerEvent) => {
    if (!stickRef.current) return;
    const rect = stickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const maxRadius = rect.width / 2 - 18;

    const dist = Math.sqrt(dx * dx + dy * dy);
    const clampedDist = Math.min(maxRadius, dist);
    const angle = Math.atan2(dy, dx);

    const normX = clampedDist === 0 ? 0 : (Math.cos(angle) * clampedDist) / maxRadius;
    const normY = clampedDist === 0 ? 0 : (Math.sin(angle) * clampedDist) / maxRadius;

    setStickPos({ x: normX * maxRadius, y: normY * maxRadius });

    // Scale joystick deflection up to the maximum speed envelope of current gait (overridden in Power Burst)
    const maxAllowedSpeed = isPowerBurstActive ? activeGaitConfig.maxSpeed * 1.6 : activeGaitConfig.maxSpeed;
    const forwardSpeed = Math.max(-0.6, Math.min(maxAllowedSpeed, -normY * maxAllowedSpeed));
    const yawSpeed = Math.max(-2.0, Math.min(2.0, normX * 1.8));

    const finalLinearSpeed = Math.abs(forwardSpeed) < 0.05 ? 0 : forwardSpeed;
    const computed = computeKinematicsFromVelocity(activeGaitConfig, Math.abs(finalLinearSpeed));

    updateTelemetry({
      linearVelocity: finalLinearSpeed,
      angularVelocity: Math.abs(yawSpeed) < 0.05 ? 0 : yawSpeed,
      strideLength: computed.stride,
      swingFrequency: computed.frequency,
      gait: Math.abs(finalLinearSpeed) > 0.08 && telemetry.gait === 'stand' ? 'trot' : telemetry.gait,
    });
  };

  // Keyboard navigation support (WASD / Arrow Keys / Numbers / B for Power Burst)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['input', 'textarea'].includes((e.target as HTMLElement).tagName.toLowerCase())) return;

      const maxSpeedCap = isPowerBurstActive ? activeGaitConfig.maxSpeed * 1.6 : activeGaitConfig.maxSpeed;

      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        const nextSpeed = Math.min(maxSpeedCap, telemetry.linearVelocity + 0.2);
        handleVelocitySliderChange(nextSpeed);
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        const nextSpeed = Math.max(0, telemetry.linearVelocity - 0.2);
        handleVelocitySliderChange(nextSpeed);
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        updateTelemetry({ angularVelocity: Math.max(-2.0, telemetry.angularVelocity - 0.3) });
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        updateTelemetry({ angularVelocity: Math.min(2.0, telemetry.angularVelocity + 0.3) });
      } else if (e.key === '1') {
        handleSelectGait(gaitMatrix[0]); // Walk
      } else if (e.key === '2') {
        handleSelectGait(gaitMatrix[1]); // Trot
      } else if (e.key === '3') {
        handleSelectGait(gaitMatrix[2]); // Gallop
      } else if (e.key === '4') {
        handleSelectGait(gaitMatrix[3]); // Creep
      } else if (e.key === 'b' || e.key === 'B') {
        if (isPowerBurstActive) {
          disengagePowerBurst(false);
        } else if (burstCooldownSec <= 0 && !telemetry.emergencyStop) {
          engagePowerBurst();
        }
      } else if (e.key === ' ') {
        updateTelemetry({
          linearVelocity: 0,
          angularVelocity: 0,
          strideLength: 0,
          swingFrequency: 0,
          gait: telemetry.gait === 'stand' ? 'trot' : 'stand',
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [telemetry, activeGaitConfig, updateTelemetry, isPowerBurstActive, burstCooldownSec]);

  const coreGaits = gaitMatrix.filter((g) => g.category === 'core');
  const auxGaits = gaitMatrix.filter((g) => g.category === 'auxiliary');

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-5 shadow-xl select-none space-y-6">
      {/* Top Controller Ribbon */}
      <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-800/80 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-cyan-950/60 border border-cyan-700/60 flex items-center justify-center">
            <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
          </div>
          <div>
            <h3 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider">
              RD-C1 Telemetry Controller & Gait Velocity Modulator
            </h3>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span>Dual-Axis Hall Effect</span>
              <span aria-hidden="true">·</span>
              <span>Sub-GHz 915MHz RF</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400">LINK: 100% (-42 dBm)</span>
            </div>
          </div>
        </div>

        {/* Controller Battery & Mode readout */}
        <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-1.5">
            <BatteryCharging className="w-3.5 h-3.5 text-cyan-400" />
            <span>48V BMS: {telemetry.batteryPercent}%</span>
          </div>
          <div className="px-2.5 py-1 rounded bg-slate-900 border border-cyan-600/60 text-cyan-300 font-bold">
            GAIT: {telemetry.gait.toUpperCase()}
          </div>
        </div>
      </div>

      {/* DEDICATED GAIT VELOCITY & KINEMATIC MODULATION PANEL */}
      <div className="bg-gradient-to-r from-[#060c1d] to-[#040816] rounded-xl border border-cyan-900/60 p-4 sm:p-5 shadow-lg space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Gauge className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                <span>Gait Velocity & Kinematic Stride Modulator</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-700/60 font-mono font-normal">
                  v = f_swing × L_stride
                </span>
              </h4>
              <p className="text-[11px] text-slate-400 font-mono">
                Dynamically modulates leg swing frequency (Hz) and stride length (mm) based on {activeGaitConfig.label} gait dynamics.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">
              {isPowerBurstActive ? 'Gait Limit Overridden:' : 'Max Envelope:'}
            </span>
            <span
              className={`text-xs font-mono font-bold ${
                isPowerBurstActive ? 'text-amber-300 animate-pulse' : 'text-cyan-300'
              }`}
            >
              {isPowerBurstActive
                ? `${(activeGaitConfig.maxSpeed * 1.6).toFixed(1)} m/s (CLIMBING TORQUE OVERDRIVE)`
                : `${activeGaitConfig.maxSpeed.toFixed(1)} m/s (${(activeGaitConfig.maxSpeed * 3.6).toFixed(1)} km/h)`}
            </span>
          </div>
        </div>

        {/* Master Gait Velocity Slider Row */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-300 font-semibold flex items-center gap-1.5">
              <span>GAIT VELOCITY SLIDER</span>
              <span className={isPowerBurstActive ? 'text-amber-400 font-bold' : 'text-slate-500 font-normal'}>
                ({isPowerBurstActive ? '⚡ POWER BURST CLIMB OVERDRIVE' : `${activeGaitConfig.label} Regime`})
              </span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Target Speed:</span>
              <span className={`text-sm font-bold tabular-nums ${isPowerBurstActive ? 'text-amber-300' : 'text-cyan-300'}`}>
                {telemetry.linearVelocity.toFixed(2)} m/s
              </span>
              <span className="text-slate-500">
                ({(telemetry.linearVelocity * 3.6).toFixed(1)} km/h)
              </span>
            </div>
          </div>

          <div className="relative flex items-center">
            <input
              type="range"
              min="0"
              max={
                isPowerBurstActive
                  ? parseFloat((activeGaitConfig.maxSpeed * 1.6).toFixed(2))
                  : activeGaitConfig.maxSpeed
              }
              step="0.05"
              value={telemetry.linearVelocity}
              onChange={(e) => handleVelocitySliderChange(parseFloat(e.target.value))}
              className={`w-full cursor-pointer h-2 rounded-lg appearance-none shadow-inner transition-colors ${
                isPowerBurstActive
                  ? 'accent-amber-400 bg-amber-950/70'
                  : 'accent-cyan-400 bg-slate-800'
              }`}
            />
          </div>

          {/* Quick Velocity Presets Bar */}
          <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-500 pt-1">
            <div className="flex items-center gap-1.5">
              <span>Presets:</span>
              <button
                onClick={() => handleVelocitySliderChange(activeGaitConfig.minSpeed)}
                className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-cyan-300 cursor-pointer transition-colors"
              >
                Min ({activeGaitConfig.minSpeed.toFixed(1)} m/s)
              </button>
              <button
                onClick={() => handleVelocitySliderChange(activeGaitConfig.defaultSpeed)}
                className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/80 text-cyan-300 hover:bg-cyan-900/60 cursor-pointer transition-colors font-semibold"
              >
                Optimal ({activeGaitConfig.defaultSpeed.toFixed(1)} m/s)
              </button>
              <button
                onClick={() =>
                  handleVelocitySliderChange(
                    isPowerBurstActive ? activeGaitConfig.maxSpeed * 1.6 : activeGaitConfig.maxSpeed
                  )
                }
                className={`px-2 py-0.5 rounded border cursor-pointer transition-colors font-semibold ${
                  isPowerBurstActive
                    ? 'bg-amber-950 border-amber-600 text-amber-300 hover:bg-amber-900'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-300 hover:text-cyan-300'
                }`}
              >
                {isPowerBurstActive ? 'Overdrive Max' : 'Sprint Max'} (
                {(isPowerBurstActive ? activeGaitConfig.maxSpeed * 1.6 : activeGaitConfig.maxSpeed).toFixed(1)} m/s)
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-2">
              {isPowerBurstActive ? (
                <span className="text-amber-400 font-bold flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 animate-pulse" />
                  <span>OVERRIDE: Peak 45.0 N·m Torque Limits Disengaged</span>
                </span>
              ) : (
                <span className="text-emerald-400 font-semibold">● FOC Closed-Loop Synchronized</span>
              )}
            </div>
          </div>
        </div>

        {/* Dynamically Modulated Output Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          {/* 1. Leg Swing Frequency Card */}
          <div className="p-3 rounded-lg bg-[#070d1e] border border-cyan-800/40 relative overflow-hidden">
            <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400 uppercase">
              <span>Leg Swing Frequency</span>
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono text-slate-100 tabular-nums">
                {liveKinematics.frequency.toFixed(2)}
              </span>
              <span className="text-xs font-mono text-cyan-300">Hz</span>
              <span className="text-[10px] font-mono text-slate-500 ml-auto">
                {liveKinematics.cadenceStepsPerMin} steps/min
              </span>
            </div>
            <div className="mt-2 w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-150 ${isPowerBurstActive ? 'bg-amber-400' : 'bg-cyan-400'}`}
                style={{
                  width: `${Math.min(
                    100,
                    (liveKinematics.frequency /
                      Math.max(1, isPowerBurstActive ? activeGaitConfig.maxFreqHz * 1.25 : activeGaitConfig.maxFreqHz)) *
                      100
                  )}%`,
                }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-500">
              <span>Min: {activeGaitConfig.minFreqHz} Hz</span>
              <span>
                Max: {isPowerBurstActive ? (activeGaitConfig.maxFreqHz * 1.25).toFixed(1) : activeGaitConfig.maxFreqHz} Hz
              </span>
            </div>
          </div>

          {/* 2. Stride Length Card */}
          <div className="p-3 rounded-lg bg-[#070d1e] border border-cyan-800/40 relative overflow-hidden">
            <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400 uppercase">
              <span>Kinematic Stride Length</span>
              <Footprints className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono text-slate-100 tabular-nums">
                {liveKinematics.stride}
              </span>
              <span className="text-xs font-mono text-cyan-300">mm</span>
              <span className="text-[10px] font-mono text-slate-500 ml-auto">
                {(liveKinematics.stride / 10).toFixed(1)} cm
              </span>
            </div>
            <div className="mt-2 w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-150 ${isPowerBurstActive ? 'bg-amber-400' : 'bg-cyan-400'}`}
                style={{
                  width: `${Math.min(
                    100,
                    (liveKinematics.stride /
                      Math.max(1, isPowerBurstActive ? Math.round(activeGaitConfig.maxStrideMm * 1.35) : activeGaitConfig.maxStrideMm)) *
                      100
                  )}%`,
                }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-500">
              <span>Min: {activeGaitConfig.minStrideMm} mm</span>
              <span>
                Max: {isPowerBurstActive ? Math.round(activeGaitConfig.maxStrideMm * 1.35) : activeGaitConfig.maxStrideMm} mm
              </span>
            </div>
          </div>

          {/* 3. Ground Contact Time Card */}
          <div className="p-3 rounded-lg bg-[#070d1e] border border-cyan-800/40 relative overflow-hidden">
            <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400 uppercase">
              <span>Ground Stance Duration</span>
              <Zap className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono text-slate-100 tabular-nums">
                {liveKinematics.contactDurationMs}
              </span>
              <span className="text-xs font-mono text-amber-300">ms</span>
              <span className="text-[10px] font-mono text-slate-500 ml-auto">
                Duty: {activeGaitConfig.dutyFactor}
              </span>
            </div>
            <div className="mt-2 w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-150"
                style={{
                  width: `${Math.min(100, (liveKinematics.contactDurationMs / 1000) * 100)}%`,
                }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-500">
              <span>{isPowerBurstActive ? 'Compliance: STIFFENED' : 'Compliance: High'}</span>
              <span>{isPowerBurstActive ? 'PWM: 100% OVERDRIVE' : 'FOC Loop: 1kHz'}</span>
            </div>
          </div>

          {/* 4. Real-time Locomotion Balance Equation */}
          <div className="p-3 rounded-lg bg-[#070d1e] border border-cyan-800/40 relative overflow-hidden">
            <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400 uppercase">
              <span>{isPowerBurstActive ? 'Climbing Powertrain Output' : 'Locomotion Verification'}</span>
              {isPowerBurstActive ? (
                <Flame className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              )}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span
                className={`text-sm font-bold font-mono ${
                  isPowerBurstActive ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {isPowerBurstActive
                  ? `${telemetry.totalTorqueOutput.toFixed(1)} N·m PEAK`
                  : `${(liveKinematics.frequency * (liveKinematics.stride / 1000)).toFixed(2)} m/s`}
              </span>
              <span className="text-[10px] font-mono text-slate-400 ml-1">
                {isPowerBurstActive ? 'Climbing Overdrive' : 'Kinematic Output'}
              </span>
            </div>
            <div className="mt-2 text-[10px] font-mono text-slate-400 leading-tight">
              {isPowerBurstActive
                ? `Torque: 45.0 N·m/joint · Bus: ${telemetry.power.toFixed(0)}W`
                : `Formula: ${liveKinematics.frequency.toFixed(2)} Hz × ${(liveKinematics.stride / 1000).toFixed(3)} m`}
            </div>
            <div
              className={`mt-1 text-[9px] font-mono ${
                isPowerBurstActive ? 'text-amber-300 font-semibold' : 'text-emerald-300/80'
              }`}
            >
              {isPowerBurstActive
                ? `Climb Incline Grade: ${climbInclineAngle}° Active`
                : 'Steady-state kinematic error: < 2.4%'}
            </div>
          </div>
        </div>
      </div>

      {/* Primary Gait Selection Matrix (Walk, Trot, Gallop, Creep) */}
      <div className="bg-[#050811] rounded-lg border border-slate-800/90 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/70">
          <div className="flex items-center gap-2">
            <Footprints className="w-4 h-4 text-cyan-400" />
            <span className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider">
              Gait Selection Matrix: Movement Patterns
            </span>
          </div>
          <span className="text-xs font-mono text-cyan-400">
            Hotkey: [1] Walk · [2] Trot · [3] Gallop · [4] Creep
          </span>
        </div>

        {/* 4 Core Movement Patterns Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {coreGaits.map((g, idx) => {
            const isActive = telemetry.gait === g.id;
            return (
              <button
                key={g.id}
                onClick={() => handleSelectGait(g)}
                className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between relative overflow-hidden group ${
                  isActive
                    ? 'bg-cyan-950/70 border-cyan-400 text-cyan-100 shadow-[0_0_16px_rgba(6,182,212,0.3)] ring-1 ring-cyan-400/50'
                    : 'bg-[#090e1c] border-slate-800/90 text-slate-400 hover:border-cyan-700/60 hover:text-slate-200'
                }`}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                        0{idx + 1}
                      </span>
                      <span className="font-['Chakra_Petch'] text-sm font-bold tracking-wider text-slate-100">
                        {g.label}
                      </span>
                    </div>
                    {isActive ? (
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                    ) : (
                      <span className="text-[10px] font-mono text-slate-500 group-hover:text-cyan-400">
                        Select
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] font-mono text-cyan-400/90 font-medium">
                    {g.subtitle}
                  </div>

                  <p className="text-[11px] text-slate-400 mt-2 leading-relaxed line-clamp-2">
                    {g.description}
                  </p>
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-800/70 space-y-1 text-[10px] font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Pattern:</span>
                    <span className="text-slate-300 font-semibold">{g.patternType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Duty Factor:</span>
                    <span className="text-cyan-300 font-semibold">{g.dutyFactor}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Speed Envelope:</span>
                    <span className="text-slate-300 font-semibold">{g.speedRange}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Nominal Stride:</span>
                    <span className="text-emerald-300 font-semibold">
                      {g.minStrideMm}-{g.maxStrideMm} mm
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Gait Footfall Timing Inspector & Phase Offsets */}
        <div className="pt-3 border-t border-slate-800/70 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-4">
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1">
              Active Movement Pattern Telemetry
            </div>
            <div className="font-['Chakra_Petch'] text-base font-bold text-cyan-300">
              {activeGaitConfig.label} · {activeGaitConfig.patternType}
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-0.5">
              Stability: <strong className="text-emerald-400">{activeGaitConfig.stabilityMargin}</strong> · Energy Cost: <strong className="text-amber-300">{activeGaitConfig.energyCost}</strong>
            </div>
          </div>

          {/* 4-Limb Phase Timing Matrix Diagram */}
          <div className="lg:col-span-8 bg-[#090e1c] p-3 rounded border border-slate-800/80">
            <div className="text-[10px] font-mono text-slate-500 uppercase mb-2 flex items-center justify-between">
              <span>Footfall Phase Stance Matrix (Normalized 0.00 → 1.00 Cycle)</span>
              <span className="text-cyan-400">Duty: {activeGaitConfig.dutyFactor}</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {activeGaitConfig.footfallSequence.map((f, i) => (
                <div key={i} className="p-2 rounded bg-slate-950 border border-slate-800 text-center">
                  <div className="text-[10px] font-mono font-bold text-slate-300">{f.leg} Limb</div>
                  <div className="text-[11px] font-mono text-cyan-300 font-semibold mt-1">
                    {f.phase}
                  </div>
                  <div className="w-full h-1.5 bg-slate-900 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="h-full bg-cyan-400"
                      style={{
                        width:
                          telemetry.gait === 'creep'
                            ? '75%'
                            : telemetry.gait === 'walk'
                            ? '65%'
                            : telemetry.gait === 'gallop'
                            ? '35%'
                            : '50%',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Secondary / Auxiliary Movement Modes */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <span className="text-slate-500 uppercase">Auxiliary Gaits:</span>
          <div className="flex flex-wrap gap-2">
            {auxGaits.map((g) => {
              const isActive = telemetry.gait === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => handleSelectGait(g)}
                  className={`px-3 py-1 rounded border cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-500/70 font-bold'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {g.label} ({g.subtitle})
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* HIGH-INTENSITY POWER BURST: CLIMBING OVERDRIVE & MAX TORQUE OVERRIDE PANEL */}
      <div
        className={`rounded-xl border p-4 sm:p-5 transition-all duration-300 relative overflow-hidden ${
          isPowerBurstActive
            ? 'bg-gradient-to-r from-[#200d08] via-[#1a0c08] to-[#170908] border-amber-500 shadow-[0_0_35px_rgba(245,158,11,0.3)] ring-1 ring-amber-400/50'
            : burstCooldownSec > 0
            ? 'bg-[#090d18] border-slate-700/80'
            : 'bg-gradient-to-r from-[#0d1326] via-[#090e1c] to-[#0c1426] border-amber-700/40 hover:border-amber-500/60'
        }`}
      >
        {/* Glow ambient background indicator */}
        {isPowerBurstActive && (
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
        )}

        {/* Header Ribbon */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-all ${
                isPowerBurstActive
                  ? 'bg-rose-500/20 border-rose-500 text-rose-400 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.5)]'
                  : burstCooldownSec > 0
                  ? 'bg-slate-800 border-slate-700 text-slate-400'
                  : 'bg-amber-500/10 border-amber-500/40 text-amber-400'
              }`}
            >
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider">
                  Power Burst: Climbing Overdrive & Max Torque Override
                </h4>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold tracking-wide uppercase border bg-amber-950/80 text-amber-300 border-amber-600/70">
                  ACTUATOR OVERDRIVE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Overrides nominal gait limits to command maximum joint torque (45.0 N·m/joint, 172.0 N·m powertrain peak) for steep incline ascents, rock scaling, and high-traction obstacle clearing.
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2">
            {isPowerBurstActive ? (
              <div className="px-3 py-1.5 rounded-lg bg-rose-950/90 border border-rose-500/80 text-rose-200 text-xs font-mono font-bold flex items-center gap-2 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.4)]">
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                <span>OVERDRIVE ACTIVE: {burstRemainingSec.toFixed(1)}s</span>
              </div>
            ) : burstCooldownSec > 0 ? (
              <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 text-xs font-mono flex items-center gap-2">
                <RotateCcw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                <span>THERMAL COOLDOWN: {burstCooldownSec.toFixed(1)}s</span>
              </div>
            ) : (
              <div className="px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-700/60 text-emerald-400 text-xs font-mono flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>ARMED & READY · HOTKEY [B]</span>
              </div>
            )}
          </div>
        </div>

        {/* Main Controls & Selectors Row */}
        <div className="pt-4 flex flex-col lg:flex-row items-stretch gap-4">
          {/* Main Tactical Button */}
          <div className="flex-1 flex flex-col justify-between">
            {!isPowerBurstActive ? (
              <button
                onClick={engagePowerBurst}
                disabled={burstCooldownSec > 0 || telemetry.emergencyStop}
                className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-amber-600 via-orange-600 to-rose-600 hover:from-amber-500 hover:via-orange-500 hover:to-rose-500 active:scale-[0.99] text-white font-['Chakra_Petch'] font-bold text-sm tracking-wider uppercase flex items-center justify-between shadow-[0_0_25px_rgba(245,158,11,0.45)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all border border-amber-400/50 group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center border border-white/20 group-hover:scale-110 transition-transform">
                    <Zap className="w-5 h-5 text-yellow-200 fill-yellow-200 animate-bounce" />
                  </div>
                  <div className="text-left">
                    <div className="text-base font-extrabold tracking-wide text-white leading-tight">
                      ⚡ ENGAGE POWER BURST
                    </div>
                    <div className="text-[11px] font-mono text-yellow-100/90 font-normal">
                      Override Gait Limits · Max Torque for Incline Climb (Hotkey: [B])
                    </div>
                  </div>
                </div>
                <div className="hidden sm:flex items-center gap-2 text-xs font-mono font-bold bg-black/30 px-3 py-1.5 rounded-lg border border-white/10">
                  <span>MAX TORQUE</span>
                  <ChevronRight className="w-4 h-4 text-yellow-200" />
                </div>
              </button>
            ) : (
              <div className="w-full flex flex-col sm:flex-row gap-3">
                <div className="flex-1 py-3.5 px-5 rounded-xl bg-gradient-to-r from-rose-900 via-rose-800 to-amber-900 border border-rose-400 text-white font-['Chakra_Petch'] font-bold text-sm tracking-wider uppercase flex items-center justify-between shadow-[0_0_30px_rgba(244,63,94,0.6)] animate-pulse">
                  <div className="flex items-center gap-3">
                    <Flame className="w-6 h-6 text-amber-200 fill-amber-300 animate-bounce" />
                    <div>
                      <div className="leading-tight text-white font-black text-base">
                        POWER BURST ACTIVE (MAX TORQUE)
                      </div>
                      <div className="text-[11px] font-mono text-amber-200 font-normal">
                        45.0 N·m/joint (172.0 N·m Powertrain Peak) · Bypassing Kinematic Limits
                      </div>
                    </div>
                  </div>
                  <div className="text-right font-mono text-lg font-bold text-amber-100 tabular-nums">
                    {burstRemainingSec.toFixed(1)}s
                  </div>
                </div>

                <button
                  onClick={() => disengagePowerBurst(false)}
                  className="py-3.5 px-5 rounded-xl bg-rose-950/90 hover:bg-rose-900 border border-rose-500 text-rose-200 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-lg"
                >
                  <RotateCcw className="w-4 h-4 text-rose-300" />
                  <span>DISENGAGE</span>
                </button>
              </div>
            )}

            {/* Countdown / Cooldown Progress Bar */}
            <div className="mt-3">
              <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
                <span>
                  {isPowerBurstActive
                    ? 'Active Overdrive Depletion:'
                    : burstCooldownSec > 0
                    ? 'Inverter Gate Driver Thermal Cooldown:'
                    : 'Burst Duration / Duty Configuration:'}
                </span>
                <span className="font-bold text-slate-200">
                  {isPowerBurstActive
                    ? `${burstRemainingSec.toFixed(1)}s / ${burstDuration}s`
                    : burstCooldownSec > 0
                    ? `${burstCooldownSec.toFixed(1)}s remaining`
                    : `${burstDuration}s Duration Armed`}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                <div
                  className={`h-full transition-all duration-150 ${
                    isPowerBurstActive
                      ? 'bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]'
                      : burstCooldownSec > 0
                      ? 'bg-cyan-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{
                    width: isPowerBurstActive
                      ? `${(burstRemainingSec / burstDuration) * 100}%`
                      : burstCooldownSec > 0
                      ? `${(burstCooldownSec / 4.0) * 100}%`
                      : '100%',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Configuration Matrix: Incline Angle & Duration Selectors */}
          <div className="lg:w-80 flex flex-col gap-2.5 bg-[#050914] p-3 rounded-xl border border-slate-800">
            {/* Climbing Incline Presets */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1.5">
                <span className="flex items-center gap-1">
                  <Mountain className="w-3.5 h-3.5 text-amber-400" />
                  <span>Climbing Incline Grade:</span>
                </span>
                <span className="text-amber-300 font-bold">{climbInclineAngle}° Slope</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { angle: 25, label: '25° Mod' },
                  { angle: 35, label: '35° Steep' },
                  { angle: 45, label: '45° Wall' },
                ].map((preset) => (
                  <button
                    key={preset.angle}
                    onClick={() => setClimbInclineAngle(preset.angle)}
                    disabled={isPowerBurstActive}
                    className={`py-1.5 px-2 rounded text-xs font-mono transition-colors cursor-pointer border ${
                      climbInclineAngle === preset.angle
                        ? 'bg-amber-950/80 border-amber-600 text-amber-300 font-bold'
                        : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Burst Duration Selector */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1.5">
                <span>Duration Limit:</span>
                <span className="text-cyan-300 font-bold">{burstDuration} seconds</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { sec: 5.0, label: '5s Pulse' },
                  { sec: 8.0, label: '8s Std' },
                  { sec: 12.0, label: '12s Climb' },
                ].map((preset) => (
                  <button
                    key={preset.sec}
                    onClick={() => setBurstDuration(preset.sec)}
                    disabled={isPowerBurstActive}
                    className={`py-1.5 px-2 rounded text-xs font-mono transition-colors cursor-pointer border ${
                      burstDuration === preset.sec
                        ? 'bg-cyan-950/80 border-cyan-600 text-cyan-300 font-bold'
                        : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Real-time Overdrive Telemetry Display Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 mt-3 border-t border-slate-800/80">
          {/* Card 1: Total Powertrain Torque */}
          <div className="p-3 rounded-lg bg-[#060b19] border border-slate-800 relative">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 uppercase">
              <span>Total Powertrain Torque</span>
              <Gauge className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={`text-xl font-bold font-mono tabular-nums ${isPowerBurstActive ? 'text-amber-400 animate-pulse' : 'text-slate-100'}`}>
                {isPowerBurstActive ? '172.0' : telemetry.totalTorqueOutput.toFixed(1)}
              </span>
              <span className="text-xs font-mono text-amber-300">N·m</span>
              <span className={`text-[10px] font-mono ml-auto font-bold px-1.5 py-0.2 rounded border ${
                isPowerBurstActive
                  ? 'bg-rose-950 text-rose-300 border-rose-600'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}>
                {isPowerBurstActive ? '+285% PEAK' : 'NOMINAL 100%'}
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-1">
              {isPowerBurstActive ? 'Actuator limits bypassed' : 'FOC Closed-Loop Limited (60.4 N·m max)'}
            </div>
          </div>

          {/* Card 2: Peak Joint Torque */}
          <div className="p-3 rounded-lg bg-[#060b19] border border-slate-800 relative">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 uppercase">
              <span>Peak Joint Torque</span>
              <Zap className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={`text-xl font-bold font-mono tabular-nums ${isPowerBurstActive ? 'text-rose-400 animate-pulse' : 'text-slate-100'}`}>
                {isPowerBurstActive ? '45.0' : '16.0'}
              </span>
              <span className="text-xs font-mono text-rose-300">N·m/joint</span>
              <span className={`text-[10px] font-mono ml-auto font-bold px-1.5 py-0.2 rounded border ${
                isPowerBurstActive
                  ? 'bg-rose-950 text-rose-300 border-rose-600'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}>
                {isPowerBurstActive ? 'OVERRIDDEN' : 'RESTRICTED'}
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-1">
              Max climb torque to RL/RR knee actuators
            </div>
          </div>

          {/* Card 3: Inverter Power & Current */}
          <div className="p-3 rounded-lg bg-[#060b19] border border-slate-800 relative">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 uppercase">
              <span>Inverter Power Bus</span>
              <BatteryCharging className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={`text-xl font-bold font-mono tabular-nums ${isPowerBurstActive ? 'text-amber-300' : 'text-slate-100'}`}>
                {isPowerBurstActive ? '785.0' : telemetry.power.toFixed(1)}
              </span>
              <span className="text-xs font-mono text-cyan-300">W</span>
              <span className="text-[10px] font-mono text-slate-400 ml-auto tabular-nums">
                {isPowerBurstActive ? '16.3' : telemetry.current.toFixed(1)} A Draw
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-1">
              48V BMS Inverter bus draw
            </div>
          </div>

          {/* Card 4: Climbing Stance Trim */}
          <div className="p-3 rounded-lg bg-[#060b19] border border-slate-800 relative">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 uppercase">
              <span>Climbing Pitch & Clearance</span>
              <Mountain className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono text-slate-100 tabular-nums">
                {isPowerBurstActive ? '255' : telemetry.stanceHeight}
              </span>
              <span className="text-xs font-mono text-emerald-300">mm</span>
              <span className="text-[10px] font-mono text-amber-300 ml-auto font-bold">
                {isPowerBurstActive ? `${climbInclineAngle >= 40 ? '-12°' : climbInclineAngle >= 30 ? '-8°' : '-5°'} Pitch Trim` : `${telemetry.bodyPitch}° Trim`}
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-1">
              High ground clearance & forward nose-down lean
            </div>
          </div>
        </div>

        {/* Diagnostic Logging Notice */}
        <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              <span className="text-slate-300 font-semibold">Diagnostic Event Dispatch:</span> Engaging Power Burst logs a high-intensity event to the Diagnostic Event Log panel (Code: <code className="text-amber-300">PWR_BURST_MAX_TORQUE_OVERRIDE</code>, Severity: <code className="text-rose-400">CRITICAL</code>).
            </span>
          </div>
          <span className="hidden md:inline-block text-emerald-400 font-semibold">
            Telemetry Hook Active
          </span>
        </div>
      </div>

      {/* Lower Row: Hall-Effect Joystick, Operational Directives, Clearance / Pitch Trim */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
        {/* Left: Interactive Virtual Joystick */}
        <div className="lg:col-span-4 flex flex-col items-center justify-center p-4 bg-[#050811] rounded-lg border border-slate-800/80">
          <span className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-2">
            Dual-Axis Hall Effect Stick
          </span>

          <div
            ref={stickRef}
            onPointerDown={handleStickPointerDown}
            onPointerMove={handleStickPointerMove}
            onPointerUp={handleStickPointerUp}
            className="relative w-44 h-44 rounded-full bg-[#0a1020] border-2 border-slate-700/70 flex items-center justify-center shadow-inner cursor-grab active:cursor-grabbing touch-none"
          >
            {/* Crosshair guidelines */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-full h-px bg-slate-800/80" />
              <div className="h-full w-px bg-slate-800/80 absolute" />
              <div className="w-24 h-24 rounded-full border border-slate-800/50 absolute" />
            </div>

            {/* Draggable Stick Handle */}
            <div
              style={{
                transform: `translate(${stickPos.x}px, ${stickPos.y}px)`,
                transition: isDraggingStick.current ? 'none' : 'transform 0.15s ease-out',
              }}
              className="w-14 h-14 rounded-full bg-gradient-to-b from-slate-700 to-slate-900 border-2 border-cyan-400/80 shadow-[0_0_15px_rgba(6,182,212,0.4)] flex items-center justify-center relative pointer-events-none"
            >
              <div className="w-6 h-6 rounded-full bg-cyan-400/20 border border-cyan-400/40" />
            </div>
          </div>

          <div className="mt-3 text-[11px] font-mono text-slate-500 text-center">
            Drag stick or use <kbd className="px-1 py-0.5 bg-slate-900 rounded border border-slate-800">W</kbd>{' '}
            <kbd className="px-1 py-0.5 bg-slate-900 rounded border border-slate-800">A</kbd>{' '}
            <kbd className="px-1 py-0.5 bg-slate-900 rounded border border-slate-800">S</kbd>{' '}
            <kbd className="px-1 py-0.5 bg-slate-900 rounded border border-slate-800">D</kbd> / Arrow keys
          </div>
        </div>

        {/* Center: Real-Time Operational Directives */}
        <div className="lg:col-span-4 flex flex-col justify-between p-4 bg-[#050811] rounded-lg border border-slate-800/80">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                Kinematic Loop Directives
              </span>
              <span className="text-[11px] font-mono text-emerald-400">400Hz Closed Loop</span>
            </div>

            <div className="space-y-3 pt-2 text-xs font-mono">
              <div className="p-2.5 rounded bg-slate-950 border border-slate-900 flex justify-between">
                <span className="text-slate-400">Gait State</span>
                <span className="text-cyan-300 font-bold uppercase">{telemetry.gait}</span>
              </div>
              <div className="p-2.5 rounded bg-slate-950 border border-slate-900 flex justify-between">
                <span className="text-slate-400">Modulated Swing Freq</span>
                <span className="text-cyan-300 font-bold tabular-nums">
                  {liveKinematics.frequency.toFixed(2)} Hz
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-950 border border-slate-900 flex justify-between">
                <span className="text-slate-400">Modulated Stride Length</span>
                <span className="text-cyan-300 font-bold tabular-nums">
                  {liveKinematics.stride} mm
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-950 border border-slate-900 flex justify-between">
                <span className="text-slate-400">Yaw Turning Rate</span>
                <span className="text-cyan-300 font-bold tabular-nums">
                  {telemetry.angularVelocity.toFixed(2)} rad/s
                </span>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="pt-3 border-t border-slate-800/80 mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (telemetry.gait === 'stand') {
                  handleSelectGait(gaitMatrix[1]); // Trot
                } else {
                  handleSelectGait(gaitMatrix[6]); // Stand
                }
              }}
              className="flex-1 py-2 px-3 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-mono text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              {telemetry.gait === 'stand' ? (
                <>
                  <Play className="w-3 h-3 text-emerald-400" />
                  <span>ENGAGE TROT</span>
                </>
              ) : (
                <>
                  <Square className="w-3 h-3 text-amber-400" />
                  <span>HALT / STAND</span>
                </>
              )}
            </button>

            <button
              onClick={() => {
                const trotGait = gaitMatrix[1];
                const computed = computeKinematicsFromVelocity(trotGait, 1.6);
                updateTelemetry({
                  targetWaypoint: { x: 4.5, y: 0 },
                  gait: 'trot',
                  linearVelocity: 1.6,
                  strideLength: computed.stride,
                  swingFrequency: computed.frequency,
                });
              }}
              className="py-2 px-3 rounded bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-700/60 text-xs font-mono text-cyan-300 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Radio className="w-3 h-3 text-cyan-400" />
              <span>PATROL WAYPOINT</span>
            </button>

            <button
              onClick={() => {
                if (isPowerBurstActive) {
                  disengagePowerBurst(false);
                } else if (burstCooldownSec <= 0 && !telemetry.emergencyStop) {
                  engagePowerBurst();
                }
              }}
              disabled={burstCooldownSec > 0 && !isPowerBurstActive}
              className={`py-2 px-3 rounded text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-all ${
                isPowerBurstActive
                  ? 'bg-rose-950 border border-rose-500 text-amber-300 animate-pulse font-bold'
                  : burstCooldownSec > 0
                  ? 'bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-amber-950/60 hover:bg-amber-900/60 border border-amber-600/70 text-amber-300 font-semibold'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {isPowerBurstActive
                  ? `BURST (${burstRemainingSec.toFixed(1)}s)`
                  : burstCooldownSec > 0
                  ? `COOLING (${burstCooldownSec.toFixed(1)}s)`
                  : 'BURST [B]'}
              </span>
            </button>
          </div>
        </div>

        {/* Right: Fine-Resolution Stance Clearance & Pitch Trim */}
        <div className="lg:col-span-4 flex flex-col justify-between p-4 bg-[#050811] rounded-lg border border-slate-800/80">
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">STANCE CLEARANCE</span>
              <span className="text-cyan-300 font-bold tabular-nums">{telemetry.stanceHeight} mm</span>
            </div>
            <input
              type="range"
              min="140"
              max="280"
              step="5"
              value={telemetry.stanceHeight}
              onChange={(e) => updateTelemetry({ stanceHeight: parseInt(e.target.value) })}
              className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
            />

            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">BODY PITCH TRIM</span>
              <span className="text-cyan-300 font-bold tabular-nums">{telemetry.bodyPitch}°</span>
            </div>
            <input
              type="range"
              min="-15"
              max="15"
              step="1"
              value={telemetry.bodyPitch}
              onChange={(e) => updateTelemetry({ bodyPitch: parseInt(e.target.value) })}
              className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
            />

            <div className="p-2.5 rounded bg-slate-950 border border-slate-900 text-xs font-mono space-y-1">
              <div className="text-slate-400 text-[10px] uppercase">CAN-FD Kinematic Sync:</div>
              <div className="flex justify-between text-slate-300 text-[11px]">
                <span>12 Actuator Frame Jitter:</span>
                <span className="text-emerald-400 font-bold">&lt; 0.45 ms</span>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800/80 mt-3 flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>CAN-FD: 1.0 kHz</span>
            <span>IMU: 400 Hz</span>
          </div>
        </div>
      </div>
    </div>
  );
};
