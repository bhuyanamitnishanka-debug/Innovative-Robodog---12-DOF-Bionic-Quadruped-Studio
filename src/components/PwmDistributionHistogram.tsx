import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TelemetryState, DiagnosticEvent } from '../types/robotics';
import { audioSynth } from '../utils/audioSynthesizer';
import {
  BarChart3,
  Activity,
  Zap,
  Sliders,
  Flame,
  AlertTriangle,
  RotateCcw,
  Play,
  Pause,
  Download,
  Filter,
  Layers,
  ChevronRight,
  Info,
  ShieldCheck,
  ShieldAlert,
  Gauge,
  Sparkles,
  Cpu,
  Radio,
  Hash,
  MousePointerClick,
  TrendingUp,
  TrendingDown,
  Waves,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

interface PwmDistributionHistogramProps {
  telemetry: TelemetryState;
  updateTelemetry?: (partial: Partial<TelemetryState>) => void;
  onLogDiagnosticEvent?: (event: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'>) => void;
}

export type ActuatorChannelFilter =
  | 'all'
  | 'knees'
  | 'hip_pitch'
  | 'hip_roll'
  | 'front_legs'
  | 'rear_legs'
  | 'fl_roll'
  | 'fl_pitch'
  | 'fl_knee'
  | 'fr_roll'
  | 'fr_pitch'
  | 'fr_knee'
  | 'rl_roll'
  | 'rl_pitch'
  | 'rl_knee'
  | 'rr_roll'
  | 'rr_pitch'
  | 'rr_knee';

export interface MotorMetadata {
  id: string;              // e.g. "M01-FL-ROLL"
  channelIndex: number;    // 0 to 11
  name: string;            // "FL Hip Abduction / Roll"
  shortName: string;       // "FL-Roll"
  limb: 'FL' | 'FR' | 'RL' | 'RR';
  joint: 'roll' | 'pitch' | 'knee';
  inverterChannel: number; // 1 to 12
  model: string;           // "RoboDrive ILM-50x14 Frameless" | "RoboDrive ILM-70x18 High-Torque"
  pwmFrequencyHz: number;  // 20000 Hz
  carrierPeriodUs: number; // 50.0 µs
  deadTimeUs: number;      // 1.20 µs
}

export const MOTORS_METADATA: MotorMetadata[] = [
  { id: 'M01-FL-ROLL',  channelIndex: 0,  name: 'FL Hip Abduction / Roll', shortName: 'FL Roll',  limb: 'FL', joint: 'roll',  inverterChannel: 1,  model: 'RoboDrive ILM-50x14 Frameless', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M02-FL-PITCH', channelIndex: 1,  name: 'FL Hip Pitch / Thigh',    shortName: 'FL Pitch', limb: 'FL', joint: 'pitch', inverterChannel: 2,  model: 'RoboDrive ILM-70x18 High-Torque', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M03-FL-KNEE',  channelIndex: 2,  name: 'FL Knee Pitch / Calf',    shortName: 'FL Knee',  limb: 'FL', joint: 'knee',  inverterChannel: 3,  model: 'RoboDrive ILM-70x18 High-Torque', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M04-FR-ROLL',  channelIndex: 3,  name: 'FR Hip Abduction / Roll', shortName: 'FR Roll',  limb: 'FR', joint: 'roll',  inverterChannel: 4,  model: 'RoboDrive ILM-50x14 Frameless', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M05-FR-PITCH', channelIndex: 4,  name: 'FR Hip Pitch / Thigh',    shortName: 'FR Pitch', limb: 'FR', joint: 'pitch', inverterChannel: 5,  model: 'RoboDrive ILM-70x18 High-Torque', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M06-FR-KNEE',  channelIndex: 5,  name: 'FR Knee Pitch / Calf',    shortName: 'FR Knee',  limb: 'FR', joint: 'knee',  inverterChannel: 6,  model: 'RoboDrive ILM-70x18 High-Torque', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M07-RL-ROLL',  channelIndex: 6,  name: 'RL Hip Abduction / Roll', shortName: 'RL Roll',  limb: 'RL', joint: 'roll',  inverterChannel: 7,  model: 'RoboDrive ILM-50x14 Frameless', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M08-RL-PITCH', channelIndex: 7,  name: 'RL Hip Pitch / Thigh',    shortName: 'RL Pitch', limb: 'RL', joint: 'pitch', inverterChannel: 8,  model: 'RoboDrive ILM-70x18 High-Torque', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M09-RL-KNEE',  channelIndex: 8,  name: 'RL Knee Pitch / Calf',    shortName: 'RL Knee',  limb: 'RL', joint: 'knee',  inverterChannel: 9,  model: 'RoboDrive ILM-70x18 High-Torque', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M10-RR-ROLL',  channelIndex: 9,  name: 'RR Hip Abduction / Roll', shortName: 'RR Roll',  limb: 'RR', joint: 'roll',  inverterChannel: 10, model: 'RoboDrive ILM-50x14 Frameless', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M11-RR-PITCH', channelIndex: 10, name: 'RR Hip Pitch / Thigh',    shortName: 'RR Pitch', limb: 'RR', joint: 'pitch', inverterChannel: 11, model: 'RoboDrive ILM-70x18 High-Torque', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
  { id: 'M12-RR-KNEE',  channelIndex: 11, name: 'RR Knee Pitch / Calf',    shortName: 'RR Knee',  limb: 'RR', joint: 'knee',  inverterChannel: 12, model: 'RoboDrive ILM-70x18 High-Torque', pwmFrequencyHz: 20000, carrierPeriodUs: 50.0, deadTimeUs: 1.2 },
];

export interface MotorContribution {
  motorIndex: number;
  motorId: string;
  motorName: string;
  shortName: string;
  limb: 'FL' | 'FR' | 'RL' | 'RR';
  joint: 'roll' | 'pitch' | 'knee';
  inverterChannel: number;
  model: string;
  count: number;
  percentageInBin: number; // percentage of this bin's samples from this motor
  avgDuty: number;
  pwmFrequencyHz: number;  // 20,000 Hz
  carrierPeriodUs: number; // 50.0 µs
  pulseWidthUs: number;    // (avgDuty / 100) * 50.0 µs
}

export interface HistogramBin {
  index: number;
  minDuty: number;        // e.g. 35%
  maxDuty: number;        // e.g. 40%
  label: string;          // '35-40%'
  count: number;          // Total occurrences
  percentage: number;     // % of total samples
  avgVoltageRms: number;  // Equivalent phase voltage RMS (V)
  regime: 'idle' | 'nominal' | 'dynamic' | 'heavy' | 'saturation';
  color: string;
  // Motor ID & exact PWM frequency properties
  primaryMotorId: string;
  primaryMotorName: string;
  primaryMotorShortName: string;
  primaryLimb: 'FL' | 'FR' | 'RL' | 'RR';
  primaryModel: string;
  inverterChannel: number;
  exactPwmFrequencyHz: number;
  exactPwmFrequencyFormatted: string;
  carrierPeriodUs: number;
  deadTimeUs: number;
  pulseWidthUs: number;
  motorContributions: MotorContribution[];
}

export const PwmDistributionHistogram: React.FC<PwmDistributionHistogramProps> = ({
  telemetry,
  updateTelemetry,
  onLogDiagnosticEvent,
}) => {
  // Configurable options
  const [binCount, setBinCount] = useState<10 | 20 | 25>(20);
  const [channelFilter, setChannelFilter] = useState<ActuatorChannelFilter>('all');
  const [isSamplingPaused, setIsSamplingPaused] = useState<boolean>(false);
  const [showDensityCurve, setShowDensityCurve] = useState<boolean>(true);
  const [showThresholdLines, setShowThresholdLines] = useState<boolean>(true);
  const [showDualOverlay, setShowDualOverlay] = useState<boolean>(false); // Compare Front vs Rear legs
  const [historyWindow, setHistoryWindow] = useState<'30s' | '60s' | '300s' | 'cumulative'>('60s');

  // 10-Second 12-Joint Demand Trend Line Overlay State
  const [showDemandTrendLine, setShowDemandTrendLine] = useState<boolean>(true);
  const [hoveredTrendPoint, setHoveredTrendPoint] = useState<{
    timestampMs: number;
    relTimeSec: number;
    avgDuty: number;
    flAvg: number;
    frAvg: number;
    rlAvg: number;
    rrAvg: number;
    gait: string;
    velocity: number;
    torque: number;
    powerBurst: boolean;
    x: number;
    y: number;
  } | null>(null);

  // Hover state for interactive tooltip
  const [hoveredBin, setHoveredBin] = useState<HistogramBin | null>(null);
  const [hoveredCoords, setHoveredCoords] = useState<{ x: number; y: number } | null>(null);
  const [selectedMotorInTooltip, setSelectedMotorInTooltip] = useState<string | null>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleBarMouseEnter = (bin: HistogramBin, barCenterX: number, barTopY: number) => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setHoveredBin(bin);
    setHoveredCoords({ x: barCenterX, y: barTopY });
  };

  const handleBarMouseLeave = () => {
    tooltipTimeoutRef.current = setTimeout(() => {
      setHoveredBin(null);
      setHoveredCoords(null);
    }, 180);
  };

  const handleTooltipMouseEnter = () => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
  };

  const handleTooltipMouseLeave = () => {
    tooltipTimeoutRef.current = setTimeout(() => {
      setHoveredBin(null);
      setHoveredCoords(null);
    }, 160);
  };

  // Raw circular buffer for duty cycle samples (stores recent samples per actuator)
  // 12 actuators: [FL_HIP_ROLL, FL_HIP_PITCH, FL_KNEE, FR_HIP_ROLL, FR_HIP_PITCH, FR_KNEE, RL_HIP_ROLL, RL_HIP_PITCH, RL_KNEE, RR_HIP_ROLL, RR_HIP_PITCH, RR_KNEE]
  interface SampleEntry {
    timestampMs: number;
    duties: number[]; // 12 duty values (0-100%)
    gait: string;
    velocity: number;
    torque: number;
    powerBurst: boolean;
  }

  const samplesBufferRef = useRef<SampleEntry[]>([]);
  const [sampleCountTotal, setSampleCountTotal] = useState<number>(0);
  const [activeSurgeState, setActiveSurgeState] = useState<{
    name: string;
    biasDuty: number;
    durationMs: number;
    remainingMs: number;
  } | null>(null);

  // Physical Inverter Specs
  const INVERTER_FREQ_KHZ = 20.0; // 20 kHz SVPWM
  const CARRIER_PERIOD_US = 50.0; // 50 µs
  const DEAD_TIME_US = 1.2;       // 1.20 µs blanking dead-time
  const DC_BUS_NOMINAL_V = telemetry.voltage || 48.0;

  // Initialize buffer with realistic baseline history
  useEffect(() => {
    const initialSamples: SampleEntry[] = [];
    const now = Date.now();
    const count = 400; // 400 sample ticks
    const baseGait = telemetry.gait || 'trot';
    const baseVel = telemetry.linearVelocity || 1.4;

    for (let i = 0; i < count; i++) {
      const tMs = now - (count - i) * 150;
      const legPhase = (i * 0.2);

      // Generate realistic 12-channel duty cycles
      const duties: number[] = [];
      for (let actIdx = 0; actIdx < 12; actIdx++) {
        const jointType = actIdx % 3; // 0=roll, 1=pitch, 2=knee
        const isRear = actIdx >= 6;
        
        let dutyMean = 28;
        let dutyStd = 6;

        if (jointType === 0) {
          // Hip roll: low duty (12 - 25%)
          dutyMean = 18 + Math.sin(legPhase + actIdx) * 5;
          dutyStd = 4;
        } else if (jointType === 1) {
          // Hip pitch: medium duty (25 - 45%)
          dutyMean = 34 + Math.sin(legPhase + actIdx) * 10;
          dutyStd = 7;
        } else {
          // Knee: highest duty & torque during ground contact (35 - 65%)
          dutyMean = (isRear ? 44 : 38) + Math.sin(legPhase + actIdx) * 14;
          dutyStd = 9;
        }

        // Add small historical burst events
        if (i >= 120 && i <= 150) {
          dutyMean += 32; // Gallop surge
        }
        if (i >= 280 && i <= 310) {
          dutyMean += 45; // Incline obstacle push
        }

        const sample = Math.max(2, Math.min(99.5, dutyMean + (Math.random() - 0.5) * dutyStd * 1.5));
        duties.push(parseFloat(sample.toFixed(1)));
      }

      initialSamples.push({
        timestampMs: tMs,
        duties,
        gait: baseGait,
        velocity: baseVel,
        torque: telemetry.totalTorqueOutput || 16.5,
        powerBurst: false,
      });
    }

    samplesBufferRef.current = initialSamples;
    setSampleCountTotal(initialSamples.length);
  }, []);

  // Surge injection handler timer
  useEffect(() => {
    if (!activeSurgeState) return;

    const interval = setInterval(() => {
      setActiveSurgeState((prev) => {
        if (!prev) return null;
        const nextRemaining = prev.remainingMs - 100;
        if (nextRemaining <= 0) return null;
        return { ...prev, remainingMs: nextRemaining };
      });
    }, 100);

    return () => clearInterval(interval);
  }, [activeSurgeState]);

  // Real-time duty cycle sampling loop (every 120ms = ~8.3 Hz sampling)
  useEffect(() => {
    if (isSamplingPaused) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const gait = telemetry.gait;
      const vel = telemetry.linearVelocity;
      const torque = telemetry.totalTorqueOutput;
      const isBurst = Boolean(telemetry.powerBurstActive);

      // Base duty cycle offset determined by robot velocity and gait
      let gaitBaseDuty = 24.0;
      let cadenceFactor = 1.0;

      switch (gait) {
        case 'stand':
          gaitBaseDuty = 14.0;
          cadenceFactor = 0.2;
          break;
        case 'walk':
          gaitBaseDuty = 26.0 + vel * 6.0;
          cadenceFactor = 0.8;
          break;
        case 'trot':
          gaitBaseDuty = 36.0 + vel * 9.0;
          cadenceFactor = 1.2;
          break;
        case 'gallop':
          gaitBaseDuty = 54.0 + vel * 11.0;
          cadenceFactor = 1.8;
          break;
        case 'creep':
          gaitBaseDuty = 22.0;
          cadenceFactor = 0.4;
          break;
        default:
          gaitBaseDuty = 30.0;
      }

      // If active surge test or power burst active, boost duty cycle
      if (isBurst) {
        gaitBaseDuty = 88.0;
      } else if (activeSurgeState) {
        gaitBaseDuty = activeSurgeState.biasDuty;
      }

      // Generate 12 actuator duty cycles with physical phase differences
      const phase = (now / 1000) * (telemetry.swingFrequency || 1.8) * Math.PI * 2;
      const newDuties: number[] = [];

      for (let actIdx = 0; actIdx < 12; actIdx++) {
        const jointType = actIdx % 3; // 0=roll, 1=pitch, 2=knee
        const legIdx = Math.floor(actIdx / 3); // 0=FL, 1=FR, 2=RL, 3=RR
        const isRear = legIdx >= 2;

        // Trot diagonal phase coupling
        const legPhaseOffset = (legIdx === 0 || legIdx === 3) ? 0 : Math.PI;

        let jointDuty = gaitBaseDuty;
        if (jointType === 0) {
          // Hip roll maintains stability & lateral balance: 40% of pitch
          jointDuty = jointDuty * 0.52 + Math.sin(phase * 0.5 + legIdx) * 3.5;
        } else if (jointType === 1) {
          // Hip pitch oscillates with swing and stance
          jointDuty = jointDuty * 0.92 + Math.sin(phase + legPhaseOffset) * (8 * cadenceFactor);
        } else {
          // Knee absorbs peak ground reaction forces: highest duty
          jointDuty = jointDuty * (isRear ? 1.22 : 1.12) + Math.cos(phase + legPhaseOffset) * (12 * cadenceFactor);
        }

        // Add high-frequency PWM switching jitter / ripple
        const jitter = (Math.random() - 0.5) * 4.0;
        const clampedDuty = Math.max(1.5, Math.min(99.0, jointDuty + jitter));
        newDuties.push(parseFloat(clampedDuty.toFixed(1)));
      }

      const newSample: SampleEntry = {
        timestampMs: now,
        duties: newDuties,
        gait,
        velocity: vel,
        torque,
        powerBurst: isBurst,
      };

      // Push to circular buffer and prune based on window
      samplesBufferRef.current.push(newSample);

      let maxAgeMs = 60000;
      if (historyWindow === '30s') maxAgeMs = 30000;
      else if (historyWindow === '60s') maxAgeMs = 60000;
      else if (historyWindow === '300s') maxAgeMs = 300000;
      else if (historyWindow === 'cumulative') maxAgeMs = 3600000;

      const cutoffTime = now - maxAgeMs;
      samplesBufferRef.current = samplesBufferRef.current.filter((s) => s.timestampMs >= cutoffTime);

      setSampleCountTotal(samplesBufferRef.current.length);
    }, 120);

    return () => clearInterval(interval);
  }, [
    isSamplingPaused,
    telemetry.gait,
    telemetry.linearVelocity,
    telemetry.totalTorqueOutput,
    telemetry.powerBurstActive,
    telemetry.swingFrequency,
    activeSurgeState,
    historyWindow,
  ]);

  // Extract relevant actuator indices based on active channel filter
  const getActuatorIndices = useCallback((filter: ActuatorChannelFilter): number[] => {
    switch (filter) {
      case 'all':
        return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      case 'knees':
        return [2, 5, 8, 11]; // Knee pitch joints
      case 'hip_pitch':
        return [1, 4, 7, 10]; // Hip pitch joints
      case 'hip_roll':
        return [0, 3, 6, 9];  // Hip abduction/roll joints
      case 'front_legs':
        return [0, 1, 2, 3, 4, 5]; // FL & FR
      case 'rear_legs':
        return [6, 7, 8, 9, 10, 11]; // RL & RR
      case 'fl_roll':
        return [0];
      case 'fl_pitch':
        return [1];
      case 'fl_knee':
        return [2];
      case 'fr_roll':
        return [3];
      case 'fr_pitch':
        return [4];
      case 'fr_knee':
        return [5];
      case 'rl_roll':
        return [6];
      case 'rl_pitch':
        return [7];
      case 'rl_knee':
        return [8];
      case 'rr_roll':
        return [9];
      case 'rr_pitch':
        return [10];
      case 'rr_knee':
        return [11];
      default:
        return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    }
  }, []);

  // Compute Histogram Bins for a given subset of duty values
  const computeHistogram = useCallback(
    (targetIndices: number[], numBins: 10 | 20 | 25): {
      bins: HistogramBin[];
      totalValues: number;
      meanDuty: number;
      medianDuty: number;
      stdDevDuty: number;
      p95Duty: number;
      saturationPct: number;
      maxCount: number;
    } => {
      const step = 100 / numBins;
      const binCounts = new Array(numBins).fill(0);
      const allValues: number[] = [];
      const binMotorData: Array<Record<number, { count: number; sumDuty: number }>> = Array.from(
        { length: numBins },
        () => ({})
      );

      const samples = samplesBufferRef.current;
      for (let s = 0; s < samples.length; s++) {
        const duties = samples[s].duties;
        for (let i = 0; i < targetIndices.length; i++) {
          const actIdx = targetIndices[i];
          const val = duties[actIdx];
          if (val !== undefined) {
            allValues.push(val);
            const bIdx = Math.min(numBins - 1, Math.max(0, Math.floor(val / step)));
            binCounts[bIdx]++;
            if (!binMotorData[bIdx][actIdx]) {
              binMotorData[bIdx][actIdx] = { count: 0, sumDuty: 0 };
            }
            binMotorData[bIdx][actIdx].count++;
            binMotorData[bIdx][actIdx].sumDuty += val;
          }
        }
      }

      const totalValues = allValues.length;
      if (totalValues === 0) {
        return {
          bins: [],
          totalValues: 0,
          meanDuty: 0,
          medianDuty: 0,
          stdDevDuty: 0,
          p95Duty: 0,
          saturationPct: 0,
          maxCount: 1,
        };
      }

      // Statistical calculations
      allValues.sort((a, b) => a - b);
      const sum = allValues.reduce((a, b) => a + b, 0);
      const mean = sum / totalValues;
      const median = allValues[Math.floor(totalValues * 0.5)];
      const p95 = allValues[Math.floor(totalValues * 0.95)];

      const variance = allValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / totalValues;
      const stdDev = Math.sqrt(variance);

      // Saturation threshold (>85% duty)
      const saturationCount = allValues.filter((v) => v >= 85.0).length;
      const saturationPct = (saturationCount / totalValues) * 100;

      const maxCount = Math.max(...binCounts, 1);

      // Build bins array
      const bins: HistogramBin[] = [];
      for (let i = 0; i < numBins; i++) {
        const minDuty = i * step;
        const maxDuty = (i + 1) * step;
        const count = binCounts[i];
        const percentage = (count / totalValues) * 100;

        // Effective fundamental phase voltage RMS (SVPWM: V_rms = (Duty / 100) * (V_dc / sqrt(2)))
        const midDuty = (minDuty + maxDuty) / 2;
        const avgVoltageRms = (midDuty / 100) * (DC_BUS_NOMINAL_V / 1.414);

        let regime: 'idle' | 'nominal' | 'dynamic' | 'heavy' | 'saturation' = 'nominal';
        let color = '#06b6d4'; // Cyan default

        if (maxDuty <= 20) {
          regime = 'idle';
          color = '#64748b'; // Slate
        } else if (maxDuty <= 50) {
          regime = 'nominal';
          color = '#10b981'; // Emerald
        } else if (maxDuty <= 75) {
          regime = 'dynamic';
          color = '#06b6d4'; // Cyan
        } else if (maxDuty <= 85) {
          regime = 'heavy';
          color = '#f59e0b'; // Amber
        } else {
          regime = 'saturation';
          color = '#f43f5e'; // Crimson / Rose
        }

        // Process motor contributions in this bin
        const motorContributions: MotorContribution[] = Object.entries(binMotorData[i])
          .map(([actIdxStr, data]) => {
            const actIdx = parseInt(actIdxStr, 10);
            const meta = MOTORS_METADATA[actIdx] || MOTORS_METADATA[0];
            const avgD = data.count > 0 ? data.sumDuty / data.count : midDuty;
            return {
              motorIndex: actIdx,
              motorId: meta.id,
              motorName: meta.name,
              shortName: meta.shortName,
              limb: meta.limb,
              joint: meta.joint,
              inverterChannel: meta.inverterChannel,
              model: meta.model,
              count: data.count,
              percentageInBin: count > 0 ? parseFloat(((data.count / count) * 100).toFixed(1)) : 0,
              avgDuty: parseFloat(avgD.toFixed(1)),
              pwmFrequencyHz: meta.pwmFrequencyHz,
              carrierPeriodUs: meta.carrierPeriodUs,
              pulseWidthUs: parseFloat(((avgD / 100) * meta.carrierPeriodUs).toFixed(2)),
            };
          })
          .sort((a, b) => b.count - a.count);

        // Determine primary motor for this bin
        const defaultMeta = targetIndices.length === 1 ? MOTORS_METADATA[targetIndices[0]] : MOTORS_METADATA[0];
        const primary = motorContributions[0] || {
          motorIndex: defaultMeta.channelIndex,
          motorId: defaultMeta.id,
          motorName: defaultMeta.name,
          shortName: defaultMeta.shortName,
          limb: defaultMeta.limb,
          joint: defaultMeta.joint,
          inverterChannel: defaultMeta.inverterChannel,
          model: defaultMeta.model,
          count: 0,
          percentageInBin: 100,
          avgDuty: midDuty,
          pwmFrequencyHz: 20000,
          carrierPeriodUs: 50.0,
          pulseWidthUs: parseFloat(((midDuty / 100) * 50.0).toFixed(2)),
        };

        const pulseWidthUs = parseFloat(((midDuty / 100) * 50.0).toFixed(2));

        bins.push({
          index: i,
          minDuty: parseFloat(minDuty.toFixed(1)),
          maxDuty: parseFloat(maxDuty.toFixed(1)),
          label: `${minDuty.toFixed(0)}-${maxDuty.toFixed(0)}%`,
          count,
          percentage: parseFloat(percentage.toFixed(2)),
          avgVoltageRms: parseFloat(avgVoltageRms.toFixed(1)),
          regime,
          color,
          primaryMotorId: primary.motorId,
          primaryMotorName: primary.motorName,
          primaryMotorShortName: primary.shortName,
          primaryLimb: primary.limb,
          primaryModel: primary.model,
          inverterChannel: primary.inverterChannel,
          exactPwmFrequencyHz: 20000,
          exactPwmFrequencyFormatted: '20,000 Hz (20.00 kHz)',
          carrierPeriodUs: 50.0,
          deadTimeUs: 1.2,
          pulseWidthUs,
          motorContributions,
        });
      }

      return {
        bins,
        totalValues,
        meanDuty: parseFloat(mean.toFixed(1)),
        medianDuty: parseFloat(median.toFixed(1)),
        stdDevDuty: parseFloat(stdDev.toFixed(1)),
        p95Duty: parseFloat(p95.toFixed(1)),
        saturationPct: parseFloat(saturationPct.toFixed(1)),
        maxCount,
      };
    },
    [DC_BUS_NOMINAL_V]
  );

  // Compute Primary Histogram
  const primaryStats = useMemo(() => {
    const indices = getActuatorIndices(channelFilter);
    return computeHistogram(indices, binCount);
  }, [channelFilter, binCount, computeHistogram, getActuatorIndices, sampleCountTotal]);

  // Compute Secondary Histogram (for Front vs Rear comparison overlay)
  const secondaryStats = useMemo(() => {
    if (!showDualOverlay) return null;
    const rearIndices = getActuatorIndices('rear_legs');
    return computeHistogram(rearIndices, binCount);
  }, [showDualOverlay, binCount, computeHistogram, getActuatorIndices, sampleCountTotal]);

  // Compute 10-Second 12-Joint Average PWM Duty Cycle Trend & Motor Demand Fluctuations
  const demandTrend10s = useMemo(() => {
    const rawSamples = samplesBufferRef.current;
    if (rawSamples.length === 0) {
      return {
        points: [],
        currentAvg: 0,
        mean10s: 0,
        peak10s: 0,
        min10s: 0,
        fluctuationDelta: 0,
        stdDev: 0,
        trendDirection: 'stable' as 'rising' | 'falling' | 'stable',
        slopePctPerSec: 0,
        windowStartMs: Date.now() - 10000,
        windowEndMs: Date.now(),
      };
    }

    const now = rawSamples[rawSamples.length - 1].timestampMs || Date.now();
    const windowStartMs = now - 10000;
    const relevant = rawSamples.filter((s) => s.timestampMs >= windowStartMs);

    if (relevant.length === 0) {
      return {
        points: [],
        currentAvg: 0,
        mean10s: 0,
        peak10s: 0,
        min10s: 0,
        fluctuationDelta: 0,
        stdDev: 0,
        trendDirection: 'stable' as 'rising' | 'falling' | 'stable',
        slopePctPerSec: 0,
        windowStartMs,
        windowEndMs: now,
      };
    }

    const points = relevant.map((s) => {
      const sum = s.duties.reduce((acc, val) => acc + val, 0);
      const avg12 = s.duties.length > 0 ? sum / s.duties.length : 0;

      const flAvg = (s.duties[0] + s.duties[1] + s.duties[2]) / 3;
      const frAvg = (s.duties[3] + s.duties[4] + s.duties[5]) / 3;
      const rlAvg = (s.duties[6] + s.duties[7] + s.duties[8]) / 3;
      const rrAvg = (s.duties[9] + s.duties[10] + s.duties[11]) / 3;

      return {
        timestampMs: s.timestampMs,
        relTimeSec: parseFloat(((s.timestampMs - now) / 1000).toFixed(1)),
        avgDuty: parseFloat(avg12.toFixed(1)),
        flAvg: parseFloat(flAvg.toFixed(1)),
        frAvg: parseFloat(frAvg.toFixed(1)),
        rlAvg: parseFloat(rlAvg.toFixed(1)),
        rrAvg: parseFloat(rrAvg.toFixed(1)),
        gait: s.gait,
        velocity: s.velocity,
        torque: s.torque,
        powerBurst: s.powerBurst,
      };
    });

    const dutyValues = points.map((p) => p.avgDuty);
    const currentAvg = points[points.length - 1].avgDuty;
    const sum = dutyValues.reduce((a, b) => a + b, 0);
    const mean10s = parseFloat((sum / dutyValues.length).toFixed(1));
    const peak10s = parseFloat(Math.max(...dutyValues).toFixed(1));
    const min10s = parseFloat(Math.min(...dutyValues).toFixed(1));
    const fluctuationDelta = parseFloat((peak10s - min10s).toFixed(1));

    const variance = dutyValues.reduce((acc, v) => acc + Math.pow(v - mean10s, 2), 0) / dutyValues.length;
    const stdDev = parseFloat(Math.sqrt(variance).toFixed(1));

    // Slope across 10 seconds: compare first 30% vs last 30%
    const splitCount = Math.max(1, Math.floor(points.length * 0.3));
    const firstSlice = dutyValues.slice(0, splitCount);
    const lastSlice = dutyValues.slice(-splitCount);
    const firstAvg = firstSlice.reduce((a, b) => a + b, 0) / firstSlice.length;
    const lastAvg = lastSlice.reduce((a, b) => a + b, 0) / lastSlice.length;
    const diff = lastAvg - firstAvg;
    const slopePctPerSec = parseFloat((diff / 7.0).toFixed(2));

    let trendDirection: 'rising' | 'falling' | 'stable' = 'stable';
    if (diff > 3.0) trendDirection = 'rising';
    else if (diff < -3.0) trendDirection = 'falling';

    return {
      points,
      currentAvg,
      mean10s,
      peak10s,
      min10s,
      fluctuationDelta,
      stdDev,
      trendDirection,
      slopePctPerSec,
      windowStartMs,
      windowEndMs: now,
    };
  }, [sampleCountTotal]);

  // Reset Histogram Buffer
  const handleResetBuffer = () => {
    samplesBufferRef.current = [];
    setSampleCountTotal(0);
    setHoveredBin(null);
    setHoveredTrendPoint(null);
    if (telemetry.audioEnabled) {
      audioSynth.playLidarPing(true);
    }
  };

  // Inject High-Duty Test Maneuvers
  const triggerSurgeManeuver = (preset: { name: string; biasDuty: number; durationMs: number }) => {
    setActiveSurgeState({
      name: preset.name,
      biasDuty: preset.biasDuty,
      durationMs: preset.durationMs,
      remainingMs: preset.durationMs,
    });

    if (telemetry.audioEnabled) {
      audioSynth.playPowerBurst(true);
    }

    if (preset.biasDuty >= 85 && onLogDiagnosticEvent) {
      onLogDiagnosticEvent({
        severity: 'warning',
        subsystem: 'ACTUATORS',
        code: 'PWM_DUTY_SATURATION_INJECTED',
        message: `High PWM Duty Cycle Maneuver (${preset.name}) commanding >${preset.biasDuty}% duty on 12-channel FOC inverter gate drivers.`,
        metric: `Commanded Duty: ${preset.biasDuty}% | Carrier: 20kHz | Dead-time: 1.2µs`,
      });
    }
  };

  // Export Histogram data & 10s Demand Trend as CSV
  const handleExportData = () => {
    if (primaryStats.bins.length === 0) return;
    let content = '=== PWM DUTY CYCLE FREQUENCY DISTRIBUTION HISTOGRAM ===\n';
    content += 'Duty_Min_Pct,Duty_Max_Pct,Count,Percentage_Pct,Equivalent_Vrms_V,Regime,Primary_Motor_ID,PWM_Freq_Hz\n';
    content += primaryStats.bins
      .map(
        (b) => `${b.minDuty},${b.maxDuty},${b.count},${b.percentage},${b.avgVoltageRms},${b.regime},${b.primaryMotorId},${b.exactPwmFrequencyHz}`
      )
      .join('\n');

    if (demandTrend10s.points.length > 0) {
      content += '\n\n=== 10-SECOND 12-JOINT PWM DEMAND TREND (MOTOR FLUCTUATIONS) ===\n';
      content += 'Timestamp_Ms,Rel_Time_Sec,Avg_12Joint_Duty_Pct,FL_Avg_Pct,FR_Avg_Pct,RL_Avg_Pct,RR_Avg_Pct,Gait,Velocity_mps,Torque_Nm\n';
      content += demandTrend10s.points
        .map(
          (p) => `${p.timestampMs},${p.relTimeSec},${p.avgDuty},${p.flAvg},${p.frAvg},${p.rlAvg},${p.rrAvg},${p.gait},${p.velocity},${p.torque}`
        )
        .join('\n');
    }

    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `robodog-pwm-histogram-10s-demand-trend-${channelFilter}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // SVG Chart Geometry
  const svgW = 920;
  const svgH = 340;
  const pad = { top: 32, right: 60, bottom: 48, left: 54 };
  const plotW = svgW - pad.left - pad.right;
  const plotH = svgH - pad.top - pad.bottom;

  // Max scale Y (highest bin percentage)
  const maxPct = useMemo(() => {
    let m = Math.max(...primaryStats.bins.map((b) => b.percentage), 10);
    if (secondaryStats) {
      const sm = Math.max(...secondaryStats.bins.map((b) => b.percentage), 0);
      m = Math.max(m, sm);
    }
    return Math.ceil((m * 1.15) / 5) * 5; // Round to next multiple of 5
  }, [primaryStats.bins, secondaryStats]);

  const getBarX = (binIdx: number) => {
    const binW = plotW / binCount;
    return pad.left + binIdx * binW;
  };

  const getBarY = (percentage: number) => {
    const norm = Math.min(1, Math.max(0, percentage / maxPct));
    return pad.top + (1 - norm) * plotH;
  };

  const getBarH = (percentage: number) => {
    const norm = Math.min(1, Math.max(0, percentage / maxPct));
    return norm * plotH;
  };

  // Density Curve Spline Path (Cubic Bezier through bin midpoints)
  const densityCurvePath = useMemo(() => {
    if (!showDensityCurve || primaryStats.bins.length < 2) return '';
    const points = primaryStats.bins.map((b) => {
      const binW = plotW / binCount;
      const x = pad.left + b.index * binW + binW / 2;
      const y = getBarY(b.percentage);
      return { x, y };
    });

    let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }, [showDensityCurve, primaryStats.bins, binCount, plotW, pad.left, maxPct]);

  // 10-Second 12-Joint Demand Trend Line SVG Path Coordinates & Area
  const trendOverlayData = useMemo(() => {
    if (!showDemandTrendLine || demandTrend10s.points.length < 2) {
      return {
        path: '',
        area: '',
        coords: [] as Array<typeof demandTrend10s.points[0] & { x: number; y: number }>,
        peakPoint: null as (typeof demandTrend10s.points[0] & { x: number; y: number }) | null,
        minPoint: null as (typeof demandTrend10s.points[0] & { x: number; y: number }) | null,
        latestCoord: null as (typeof demandTrend10s.points[0] & { x: number; y: number }) | null,
      };
    }

    const { windowStartMs, windowEndMs, points } = demandTrend10s;
    const spanMs = Math.max(1000, windowEndMs - windowStartMs);

    const coords = points.map((p) => {
      const normX = Math.max(0, Math.min(1, (p.timestampMs - windowStartMs) / spanMs));
      const normY = Math.max(0, Math.min(1, p.avgDuty / 100));
      return {
        ...p,
        x: pad.left + normX * plotW,
        y: pad.top + (1 - normY) * plotH,
      };
    });

    if (coords.length === 0) {
      return {
        path: '',
        area: '',
        coords: [],
        peakPoint: null,
        minPoint: null,
        latestCoord: null,
      };
    }

    // Find peak and min coords
    let peakCoord = coords[0];
    let minCoord = coords[0];
    for (let i = 1; i < coords.length; i++) {
      if (coords[i].avgDuty > peakCoord.avgDuty) peakCoord = coords[i];
      if (coords[i].avgDuty < minCoord.avgDuty) minCoord = coords[i];
    }

    let linePath = `M ${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];
      const midX = (prev.x + curr.x) / 2;
      linePath += ` C ${midX.toFixed(1)},${prev.y.toFixed(1)} ${midX.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
    }

    const firstX = coords[0].x.toFixed(1);
    const lastX = coords[coords.length - 1].x.toFixed(1);
    const bottomY = (pad.top + plotH).toFixed(1);
    const areaPath = `${linePath} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;

    return {
      path: linePath,
      area: areaPath,
      coords,
      peakPoint: peakCoord,
      minPoint: minCoord,
      latestCoord: coords[coords.length - 1],
    };
  }, [showDemandTrendLine, demandTrend10s, plotW, plotH, pad.left, pad.top]);

  // Mean Duty Cycle X coordinate
  const meanX = pad.left + (primaryStats.meanDuty / 100) * plotW;
  // 95th Percentile X coordinate
  const p95X = pad.left + (primaryStats.p95Duty / 100) * plotW;
  // Saturation threshold line (85%)
  const saturationX = pad.left + (85 / 100) * plotW;

  return (
    <div className="bg-[#080d1a] border border-cyan-800/60 rounded-xl p-5 sm:p-6 shadow-2xl space-y-6 relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute top-0 right-1/4 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-80 h-80 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header Bar */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Inverter Gate Driver Analytics</span>
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold tracking-wide uppercase border bg-cyan-950/80 text-cyan-300 border-cyan-600/70">
              20 kHz SVPWM
            </span>
            {primaryStats.saturationPct > 5 && (
              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold tracking-wide uppercase border bg-rose-950 text-rose-300 border-rose-600 animate-pulse">
                SATURATION WARNING ({primaryStats.saturationPct}%)
              </span>
            )}
          </div>
          <h3 className="font-['Chakra_Petch'] text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            PWM DUTY CYCLE FREQUENCY DISTRIBUTION HISTOGRAM
          </h3>
          <p className="text-xs text-slate-400 font-mono mt-1">
            Empirical probability density of 12-channel FOC motor controller modulation index (D in [0%, 100%]). High duty cycles (&gt;85%) indicate bridge saturation and high-torque thermal strain.
          </p>
        </div>

        {/* Toolbar & Filter Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Channel Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            <Filter className="w-3.5 h-3.5 text-slate-400 ml-1" />
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as ActuatorChannelFilter)}
              className="bg-transparent text-slate-200 text-xs font-mono focus:outline-none cursor-pointer pr-1"
            >
              <optgroup label="Subsystem Groups" className="bg-slate-950 text-slate-400 font-semibold">
                <option value="all" className="bg-slate-900 text-slate-200">All 12 Actuators</option>
                <option value="knees" className="bg-slate-900 text-slate-200">4x Knees (Calf)</option>
                <option value="hip_pitch" className="bg-slate-900 text-slate-200">4x Hip Pitch (Thigh)</option>
                <option value="hip_roll" className="bg-slate-900 text-slate-200">4x Hip Roll (Abduct)</option>
                <option value="front_legs" className="bg-slate-900 text-slate-200">Front Legs (FL+FR)</option>
                <option value="rear_legs" className="bg-slate-900 text-slate-200">Rear Legs (RL+RR)</option>
              </optgroup>
              <optgroup label="Specific Motors (Motor ID)" className="bg-slate-950 text-cyan-400 font-semibold">
                <option value="fl_roll" className="bg-slate-900 text-slate-200">M01-FL-ROLL (FL Hip Roll)</option>
                <option value="fl_pitch" className="bg-slate-900 text-slate-200">M02-FL-PITCH (FL Hip Pitch)</option>
                <option value="fl_knee" className="bg-slate-900 text-slate-200">M03-FL-KNEE (FL Knee Calf)</option>
                <option value="fr_roll" className="bg-slate-900 text-slate-200">M04-FR-ROLL (FR Hip Roll)</option>
                <option value="fr_pitch" className="bg-slate-900 text-slate-200">M05-FR-PITCH (FR Hip Pitch)</option>
                <option value="fr_knee" className="bg-slate-900 text-slate-200">M06-FR-KNEE (FR Knee Calf)</option>
                <option value="rl_roll" className="bg-slate-900 text-slate-200">M07-RL-ROLL (RL Hip Roll)</option>
                <option value="rl_pitch" className="bg-slate-900 text-slate-200">M08-RL-PITCH (RL Hip Pitch)</option>
                <option value="rl_knee" className="bg-slate-900 text-slate-200">M09-RL-KNEE (RL Knee Calf)</option>
                <option value="rr_roll" className="bg-slate-900 text-slate-200">M10-RR-ROLL (RR Hip Roll)</option>
                <option value="rr_pitch" className="bg-slate-900 text-slate-200">M11-RR-PITCH (RR Hip Pitch)</option>
                <option value="rr_knee" className="bg-slate-900 text-slate-200">M12-RR-KNEE (RR Knee Calf)</option>
              </optgroup>
            </select>
          </div>

          {/* Bin Resolution Selector */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            <span className="text-slate-500 text-[10px] px-1.5 uppercase">Bins:</span>
            {[
              { count: 10, label: '10' },
              { count: 20, label: '20' },
              { count: 25, label: '25' },
            ].map((b) => (
              <button
                key={b.count}
                onClick={() => setBinCount(b.count as 10 | 20 | 25)}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  binCount === b.count
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Time Window Selector */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            {[
              { val: '30s', label: '30s' },
              { val: '60s', label: '60s' },
              { val: '300s', label: '5m' },
              { val: 'cumulative', label: 'Total' },
            ].map((tw) => (
              <button
                key={tw.val}
                onClick={() => setHistoryWindow(tw.val as any)}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  historyWindow === tw.val
                    ? 'bg-slate-800 text-cyan-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tw.label}
              </button>
            ))}
          </div>

          {/* Pause / Resume */}
          <button
            onClick={() => setIsSamplingPaused(!isSamplingPaused)}
            className={`p-1.5 rounded-lg border text-xs font-mono cursor-pointer transition-all ${
              isSamplingPaused
                ? 'bg-amber-950/80 border-amber-600 text-amber-300'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-cyan-300'
            }`}
            title={isSamplingPaused ? 'Resume live sampling' : 'Pause sampling'}
          >
            {isSamplingPaused ? <Play className="w-4 h-4 text-amber-400" /> : <Pause className="w-4 h-4 text-cyan-400" />}
          </button>

          {/* Reset Buffer */}
          <button
            onClick={handleResetBuffer}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 cursor-pointer transition-all"
            title="Clear and reset histogram buffer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Export CSV */}
          <button
            onClick={handleExportData}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-slate-600 cursor-pointer transition-all"
            title="Export histogram dataset as CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 5 Analytical KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Metric 1: Mean Duty Cycle */}
        <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
            <span>Mean Duty Cycle (μ)</span>
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-cyan-300 tabular-nums">
              {primaryStats.meanDuty.toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-slate-400">avg</span>
            <span className="text-[10px] font-mono text-slate-500 ml-auto">
              σ: ±{primaryStats.stdDevDuty.toFixed(1)}%
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1 flex justify-between">
            <span>Median (D50): <strong className="text-slate-200">{primaryStats.medianDuty}%</strong></span>
            <span>V_rms: ~{((primaryStats.meanDuty / 100) * (DC_BUS_NOMINAL_V / 1.414)).toFixed(1)}V</span>
          </div>
        </div>

        {/* Metric 2: 95th Percentile Duty */}
        <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
            <span>95th Percentile (P95)</span>
            <Flame className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={`text-2xl font-bold font-mono tabular-nums ${
                primaryStats.p95Duty >= 85 ? 'text-rose-400' : 'text-amber-300'
              }`}
            >
              {primaryStats.p95Duty.toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-slate-400">peak</span>
            <span
              className={`text-[10px] font-mono ml-auto font-semibold px-1.5 py-0.2 rounded border ${
                primaryStats.p95Duty >= 85
                  ? 'bg-rose-950/80 text-rose-300 border-rose-600'
                  : 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
              }`}
            >
              {primaryStats.p95Duty >= 85 ? 'SATURATED' : 'HEADROOM OK'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1">
            Top 5% heavy swing & stance impulses
          </div>
        </div>

        {/* Metric 3: Bridge Saturation Rate */}
        <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
            <span>Overdrive Saturation Rate</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={`text-2xl font-bold font-mono tabular-nums ${
                primaryStats.saturationPct > 10
                  ? 'text-rose-400 animate-pulse'
                  : primaryStats.saturationPct > 2
                  ? 'text-amber-300'
                  : 'text-emerald-300'
              }`}
            >
              {primaryStats.saturationPct.toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-slate-400">&gt;85%</span>
            <span className="text-[10px] font-mono text-slate-500 ml-auto">
              Duty &ge; 85%
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1">
            {primaryStats.saturationPct > 5 ? 'Elevated inverter thermal stress' : 'Within linear modulation range'}
          </div>
        </div>

        {/* Metric 4: Inverter Modulation & Efficiency */}
        <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
            <span>Inverter FOC Efficiency</span>
            <Gauge className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-emerald-300 tabular-nums">
              {(94.2 - (primaryStats.meanDuty > 60 ? (primaryStats.meanDuty - 60) * 0.12 : 0)).toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-emerald-400 font-semibold">η</span>
            <span className="text-[10px] font-mono text-slate-400 ml-auto font-mono">
              20 kHz
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1">
            Dead-time: <strong className="text-slate-200">1.20 μs</strong> · SVPWM
          </div>
        </div>

        {/* Metric 5: Total Sampled Duty Vectors */}
        <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800/80 col-span-2 sm:col-span-1">
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
            <span>Sample Distribution Size</span>
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-slate-100 tabular-nums">
              {primaryStats.totalValues.toLocaleString()}
            </span>
            <span className="text-xs font-mono text-slate-400">pts</span>
            <span className="text-[10px] font-mono text-cyan-400 ml-auto font-semibold">
              {isSamplingPaused ? 'PAUSED' : 'LIVE 8.3Hz'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1">
            Across {getActuatorIndices(channelFilter).length} actuator channel(s)
          </div>
        </div>
      </div>

      {/* Main SVG Histogram Chart Container */}
      <div className="bg-[#050813] border border-slate-800/90 rounded-xl p-3 sm:p-4 relative">
        {/* Chart View Controls Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-slate-400 pb-2 mb-2 border-b border-slate-800/60">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
              <input
                type="checkbox"
                checked={showDensityCurve}
                onChange={(e) => setShowDensityCurve(e.target.checked)}
                className="accent-cyan-400 rounded"
              />
              <span>Probability Density Spline</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
              <input
                type="checkbox"
                checked={showThresholdLines}
                onChange={(e) => setShowThresholdLines(e.target.checked)}
                className="accent-amber-400 rounded"
              />
              <span>Statistical Reference Lines (μ, P95, Saturation)</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
              <input
                type="checkbox"
                checked={showDualOverlay}
                onChange={(e) => setShowDualOverlay(e.target.checked)}
                className="accent-purple-400 rounded"
              />
              <span>Compare Rear Legs (RL+RR)</span>
            </label>

            {/* 10s 12-Joint Demand Trend Line Overlay Toggle */}
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
              <input
                type="checkbox"
                checked={showDemandTrendLine}
                onChange={(e) => setShowDemandTrendLine(e.target.checked)}
                className="accent-fuchsia-400 rounded"
              />
              <span className="flex items-center gap-1 text-fuchsia-300 font-semibold">
                <TrendingUp className="w-3.5 h-3.5 text-fuchsia-400" />
                <span>10s Demand Trend Overlay (12 Joints)</span>
              </span>
            </label>
          </div>

          {/* Operational Duty Cycle Color Legend */}
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-slate-500 inline-block"></span>
              <span>0-20% Stance Idle</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block"></span>
              <span>20-50% Nominal Cruise</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-cyan-400 inline-block"></span>
              <span>50-75% Dynamic Swing</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-amber-400 inline-block"></span>
              <span>75-85% Heavy Incline</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-rose-500 inline-block"></span>
              <span>85-100% Saturation</span>
            </span>
            {showDemandTrendLine && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-fuchsia-950/80 border border-fuchsia-600/70 text-fuchsia-300 font-bold shadow-sm">
                <span className="w-3.5 h-1 rounded bg-fuchsia-400 inline-block shadow-[0_0_8px_#d946ef]"></span>
                <span>10s Joint Demand Line</span>
              </span>
            )}
          </div>
        </div>

        {/* 10-Second 12-Joint Demand Fluctuation Telemetry Monitor Strip */}
        {showDemandTrendLine && (
          <div className="mb-3 px-3.5 py-2 rounded-lg bg-gradient-to-r from-fuchsia-950/40 via-purple-950/25 to-slate-950/60 border border-fuchsia-800/40 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-fuchsia-500 animate-pulse shadow-[0_0_8px_#d946ef]" />
              <div className="flex items-center gap-1.5 text-fuchsia-200">
                <TrendingUp className="w-4 h-4 text-fuchsia-400" />
                <span className="font-bold tracking-wide">10s DEMAND TREND (12 JOINTS):</span>
              </div>
              <span className="text-slate-400 text-[11px] hidden md:inline">
                Real-time average PWM duty cycle across all 12 actuators visualizing demand fluctuations
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
              <div>
                <span className="text-slate-400">Current: </span>
                <strong className="text-fuchsia-300 text-sm font-bold tabular-nums">{demandTrend10s.currentAvg}%</strong>
              </div>

              <div className="hidden sm:block text-slate-700">|</div>

              <div>
                <span className="text-slate-400">10s Mean: </span>
                <strong className="text-slate-200 font-bold tabular-nums">{demandTrend10s.mean10s}%</strong>
              </div>

              <div className="hidden sm:block text-slate-700">|</div>

              <div>
                <span className="text-slate-400">Range: </span>
                <strong className="text-cyan-300 font-bold tabular-nums">{demandTrend10s.min10s}%</strong>
                <span className="text-slate-500"> → </span>
                <strong className="text-amber-300 font-bold tabular-nums">{demandTrend10s.peak10s}%</strong>
              </div>

              <div className="hidden sm:block text-slate-700">|</div>

              <div className="flex items-center gap-1">
                <span className="text-slate-400">Fluctuation (Δ): </span>
                <span
                  className={`px-1.5 py-0.2 rounded font-bold border tabular-nums ${
                    demandTrend10s.fluctuationDelta > 30
                      ? 'bg-rose-950/80 text-rose-300 border-rose-700 animate-pulse'
                      : demandTrend10s.fluctuationDelta > 15
                      ? 'bg-amber-950/80 text-amber-300 border-amber-700'
                      : 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                  }`}
                >
                  ±{demandTrend10s.fluctuationDelta}%
                </span>
              </div>

              <div className="hidden sm:block text-slate-700">|</div>

              <div className="flex items-center gap-1">
                <span className="text-slate-400">Momentum: </span>
                <span
                  className={`px-1.5 py-0.2 rounded font-bold border flex items-center gap-1 ${
                    demandTrend10s.trendDirection === 'rising'
                      ? 'bg-amber-950 text-amber-300 border-amber-600'
                      : demandTrend10s.trendDirection === 'falling'
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-600'
                      : 'bg-emerald-950 text-emerald-300 border-emerald-700'
                  }`}
                >
                  {demandTrend10s.trendDirection === 'rising' && <ArrowUpRight className="w-3 h-3 text-amber-400" />}
                  {demandTrend10s.trendDirection === 'falling' && <ArrowDownRight className="w-3 h-3 text-cyan-400" />}
                  {demandTrend10s.trendDirection === 'stable' && <Waves className="w-3 h-3 text-emerald-400" />}
                  <span className="uppercase text-[10px]">{demandTrend10s.trendDirection}</span>
                  <span className="text-[10px] opacity-80 tabular-nums">
                    ({demandTrend10s.slopePctPerSec > 0 ? `+${demandTrend10s.slopePctPerSec}` : demandTrend10s.slopePctPerSec}%/s)
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* SVG Histogram Viewport */}
        <div className="relative w-full select-none">
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="w-full h-auto cursor-pointer"
          >
            <defs>
              {/* Bar Glow Filter */}
              <filter id="barGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              {/* 10s Trend Glow Filter */}
              <filter id="trendGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              {/* 10s Trend Area Gradient */}
              <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d946ef" stopOpacity="0.25" />
                <stop offset="60%" stopColor="#a855f7" stopOpacity="0.06" />
                <stop offset="100%" stopColor="#a855f7" stopOpacity="0.0" />
              </linearGradient>

              {/* Rear legs overlay hatch pattern */}
              <pattern id="hatchRear" width="6" height="6" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                <line x1="0" y1="0" x2="0" y2="6" stroke="#c084fc" strokeWidth="1.5" opacity="0.6" />
              </pattern>
            </defs>

            {/* Horizontal Grid Lines (Percentage of samples) */}
            {[0.25, 0.5, 0.75, 1.0].map((ratio) => {
              const pctVal = maxPct * ratio;
              const y = getBarY(pctVal);
              return (
                <g key={ratio}>
                  <line
                    x1={pad.left}
                    y1={y}
                    x2={pad.left + plotW}
                    y2={y}
                    stroke="#1e293b"
                    strokeDasharray="2 3"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 3.5}
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    {pctVal.toFixed(0)}%
                  </text>
                </g>
              );
            })}

            {/* X-Axis Baseline */}
            <line
              x1={pad.left}
              y1={pad.top + plotH}
              x2={pad.left + plotW}
              y2={pad.top + plotH}
              stroke="#334155"
              strokeWidth="1.5"
            />

            {/* Saturation Zone Shading Background (>85% duty) */}
            <rect
              x={saturationX}
              y={pad.top}
              width={pad.left + plotW - saturationX}
              height={plotH}
              fill="rgba(244, 63, 94, 0.05)"
              stroke="#f43f5e"
              strokeDasharray="3 3"
              strokeWidth="0.8"
              opacity="0.7"
            />
            <text
              x={pad.left + plotW - 6}
              y={pad.top + 14}
              fill="#f43f5e"
              fontSize="8"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="end"
            >
              SATURATION REGIME (&gt;85%)
            </text>

            {/* HISTOGRAM BARS */}
            {primaryStats.bins.map((bin) => {
              const binW = plotW / binCount;
              const barMargin = Math.max(1.5, binW * 0.1);
              const actualW = binW - barMargin * 2;
              const x = pad.left + bin.index * binW + barMargin;
              const y = getBarY(bin.percentage);
              const h = getBarH(bin.percentage);
              const isHovered = hoveredBin?.index === bin.index;

              return (
                <g
                  key={bin.index}
                  onMouseEnter={() => handleBarMouseEnter(bin, x + actualW / 2, y)}
                  onMouseLeave={handleBarMouseLeave}
                  className="transition-all cursor-pointer"
                >
                  {/* Primary Histogram Bar */}
                  <rect
                    x={x}
                    y={y}
                    width={actualW}
                    height={Math.max(1, h)}
                    rx={2.5}
                    fill={isHovered ? '#ffffff' : bin.color}
                    opacity={isHovered ? 1 : 0.82}
                    className="transition-all duration-150"
                  />

                  {/* Top highlight cap line */}
                  {h > 4 && (
                    <line
                      x1={x}
                      y1={y}
                      x2={x + actualW}
                      y2={y}
                      stroke={bin.color}
                      strokeWidth="2"
                      opacity="0.9"
                    />
                  )}

                  {/* Percentage label on top of tall bars */}
                  {bin.percentage >= maxPct * 0.22 && (
                    <text
                      x={x + actualW / 2}
                      y={y - 4}
                      fill={bin.color}
                      fontSize="8"
                      fontFamily="monospace"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {bin.percentage.toFixed(1)}%
                    </text>
                  )}
                </g>
              );
            })}

            {/* Optional Secondary Overlay (Rear Legs comparison) */}
            {showDualOverlay && secondaryStats && (
              <g pointerEvents="none">
                {secondaryStats.bins.map((bin) => {
                  const binW = plotW / binCount;
                  const barMargin = Math.max(1.5, binW * 0.1);
                  const actualW = binW - barMargin * 2;
                  const x = pad.left + bin.index * binW + barMargin;
                  const y = getBarY(bin.percentage);
                  const h = getBarH(bin.percentage);

                  return (
                    <g key={`secondary-${bin.index}`}>
                      <rect
                        x={x}
                        y={y}
                        width={actualW}
                        height={Math.max(1, h)}
                        rx={2.5}
                        fill="url(#hatchRear)"
                        stroke="#c084fc"
                        strokeWidth="1.2"
                        opacity="0.85"
                      />
                    </g>
                  );
                })}
              </g>
            )}

            {/* Probability Density Spline Line */}
            {showDensityCurve && densityCurvePath && (
              <path
                d={densityCurvePath}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#barGlow)"
                pointerEvents="none"
              />
            )}

            {/* Statistical Reference Lines */}
            {showThresholdLines && (
              <g pointerEvents="none">
                {/* Mean Duty (μ) */}
                <line
                  x1={meanX}
                  y1={pad.top}
                  x2={meanX}
                  y2={pad.top + plotH}
                  stroke="#06b6d4"
                  strokeDasharray="4 3"
                  strokeWidth="1.8"
                />
                <circle cx={meanX} cy={pad.top + 6} r="3" fill="#06b6d4" />
                <rect
                  x={meanX - 28}
                  y={pad.top + 8}
                  width="56"
                  height="16"
                  rx="3"
                  fill="rgba(6, 182, 212, 0.2)"
                  stroke="#06b6d4"
                  strokeWidth="1"
                />
                <text
                  x={meanX}
                  y={pad.top + 19}
                  fill="#06b6d4"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  μ={primaryStats.meanDuty}%
                </text>

                {/* 95th Percentile (P95) */}
                <line
                  x1={p95X}
                  y1={pad.top}
                  x2={p95X}
                  y2={pad.top + plotH}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                  strokeWidth="1.8"
                />
                <rect
                  x={p95X - 30}
                  y={pad.top + 28}
                  width="60"
                  height="16"
                  rx="3"
                  fill="rgba(245, 158, 11, 0.2)"
                  stroke="#f59e0b"
                  strokeWidth="1"
                />
                <text
                  x={p95X}
                  y={pad.top + 39}
                  fill="#f59e0b"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  P95={primaryStats.p95Duty}%
                </text>
              </g>
            )}

            {/* TOP 10-SECOND TIME TIMELINE AXIS */}
            {showDemandTrendLine && (
              <g pointerEvents="none">
                <line
                  x1={pad.left}
                  y1={pad.top}
                  x2={pad.left + plotW}
                  y2={pad.top}
                  stroke="#701a75"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  opacity="0.8"
                />
                {[
                  { ratio: 0.0, label: '-10.0s' },
                  { ratio: 0.25, label: '-7.5s' },
                  { ratio: 0.5, label: '-5.0s' },
                  { ratio: 0.75, label: '-2.5s' },
                  { ratio: 1.0, label: 'NOW (0s)' },
                ].map((tick) => {
                  const x = pad.left + tick.ratio * plotW;
                  return (
                    <g key={`top-tick-${tick.label}`}>
                      <line
                        x1={x}
                        y1={pad.top - 4}
                        x2={x}
                        y2={pad.top}
                        stroke="#c026d3"
                        strokeWidth="1.2"
                      />
                      <text
                        x={x}
                        y={pad.top - 6}
                        fill={tick.ratio === 1.0 ? '#f472b6' : '#c084fc'}
                        fontSize="7.5"
                        fontFamily="monospace"
                        fontWeight={tick.ratio === 1.0 ? 'bold' : 'normal'}
                        textAnchor={tick.ratio === 0 ? 'start' : tick.ratio === 1.0 ? 'end' : 'middle'}
                      >
                        {tick.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* RIGHT SECONDARY Y-AXIS FOR 10s 12-JOINT DEMAND TREND */}
            {showDemandTrendLine && (
              <g pointerEvents="none">
                <line
                  x1={pad.left + plotW}
                  y1={pad.top}
                  x2={pad.left + plotW}
                  y2={pad.top + plotH}
                  stroke="#c026d3"
                  strokeWidth="1.2"
                  strokeDasharray="4 2"
                  opacity="0.8"
                />
                {[0, 25, 50, 75, 100].map((dutyVal) => {
                  const y = pad.top + (1 - dutyVal / 100) * plotH;
                  return (
                    <g key={`right-axis-${dutyVal}`}>
                      <line
                        x1={pad.left + plotW}
                        y1={y}
                        x2={pad.left + plotW + 4}
                        y2={y}
                        stroke="#d946ef"
                        strokeWidth="1"
                      />
                      <text
                        x={pad.left + plotW + 7}
                        y={y + 3}
                        fill="#e879f9"
                        fontSize="8.5"
                        fontFamily="monospace"
                        fontWeight="bold"
                        textAnchor="start"
                      >
                        {dutyVal}%
                      </text>
                    </g>
                  );
                })}
                <text
                  x={svgW - 8}
                  y={pad.top + plotH / 2}
                  fill="#e879f9"
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                  transform={`rotate(90 ${svgW - 8} ${pad.top + plotH / 2})`}
                >
                  10s 12-JOINT AVG DEMAND (%)
                </text>
              </g>
            )}

            {/* SECONDARY LINE OVERLAY: 10s 12-Joint Average PWM Duty Cycle Trend */}
            {showDemandTrendLine && trendOverlayData.path && (
              <g className="transition-opacity duration-200">
                {/* Under-line translucent gradient area */}
                <path
                  d={trendOverlayData.area}
                  fill="url(#trendAreaGrad)"
                  pointerEvents="none"
                />

                {/* Secondary Trend Line Overlay */}
                <path
                  d={trendOverlayData.path}
                  fill="none"
                  stroke="#e879f9"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#trendGlow)"
                  pointerEvents="none"
                />

                {/* Peak Demand Callout Marker on Trend */}
                {trendOverlayData.peakPoint && (
                  <g pointerEvents="none">
                    <circle
                      cx={trendOverlayData.peakPoint.x}
                      cy={trendOverlayData.peakPoint.y}
                      r="3.5"
                      fill="#f43f5e"
                      stroke="#ffffff"
                      strokeWidth="1.2"
                    />
                    <rect
                      x={Math.max(pad.left + 4, Math.min(pad.left + plotW - 62, trendOverlayData.peakPoint.x - 30))}
                      y={Math.max(pad.top + 2, trendOverlayData.peakPoint.y - 18)}
                      width="60"
                      height="13"
                      rx="3"
                      fill="rgba(244, 63, 94, 0.9)"
                      stroke="#fecdd3"
                      strokeWidth="0.8"
                    />
                    <text
                      x={Math.max(pad.left + 4, Math.min(pad.left + plotW - 62, trendOverlayData.peakPoint.x - 30)) + 30}
                      y={Math.max(pad.top + 2, trendOverlayData.peakPoint.y - 18) + 9.5}
                      fill="#ffffff"
                      fontSize="7.5"
                      fontFamily="monospace"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      Peak: {trendOverlayData.peakPoint.avgDuty}%
                    </text>
                  </g>
                )}

                {/* Min Demand Callout Marker on Trend */}
                {trendOverlayData.minPoint && Math.abs(trendOverlayData.minPoint.x - (trendOverlayData.peakPoint?.x || 0)) > 45 && (
                  <g pointerEvents="none">
                    <circle
                      cx={trendOverlayData.minPoint.x}
                      cy={trendOverlayData.minPoint.y}
                      r="3"
                      fill="#38bdf8"
                      stroke="#ffffff"
                      strokeWidth="1.2"
                    />
                    <rect
                      x={Math.max(pad.left + 4, Math.min(pad.left + plotW - 56, trendOverlayData.minPoint.x - 26))}
                      y={Math.min(pad.top + plotH - 16, trendOverlayData.minPoint.y + 6)}
                      width="52"
                      height="12"
                      rx="3"
                      fill="rgba(14, 165, 233, 0.9)"
                      stroke="#bae6fd"
                      strokeWidth="0.8"
                    />
                    <text
                      x={Math.max(pad.left + 4, Math.min(pad.left + plotW - 56, trendOverlayData.minPoint.x - 26)) + 26}
                      y={Math.min(pad.top + plotH - 16, trendOverlayData.minPoint.y + 6) + 9}
                      fill="#ffffff"
                      fontSize="7.5"
                      fontFamily="monospace"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      Min: {trendOverlayData.minPoint.avgDuty}%
                    </text>
                  </g>
                )}

                {/* Real-Time Live Head Pulse Dot (NOW) */}
                {trendOverlayData.latestCoord && (
                  <g pointerEvents="none">
                    <circle
                      cx={trendOverlayData.latestCoord.x}
                      cy={trendOverlayData.latestCoord.y}
                      r="7"
                      fill="none"
                      stroke="#e879f9"
                      strokeWidth="1.5"
                      opacity="0.8"
                    />
                    <circle
                      cx={trendOverlayData.latestCoord.x}
                      cy={trendOverlayData.latestCoord.y}
                      r="4"
                      fill="#f472b6"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                  </g>
                )}

                {/* Interactive Hover Hit Targets along the 10s Trend Line */}
                {trendOverlayData.coords.map((pt, idx) => {
                  if (idx % 3 !== 0 && idx !== trendOverlayData.coords.length - 1) return null;
                  const isHovered = hoveredTrendPoint?.timestampMs === pt.timestampMs;
                  return (
                    <g
                      key={`trend-node-${pt.timestampMs}`}
                      onMouseEnter={() => setHoveredTrendPoint(pt)}
                      onMouseLeave={() => setHoveredTrendPoint(null)}
                      className="cursor-pointer"
                    >
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isHovered ? 5.5 : 8}
                        fill={isHovered ? '#ffffff' : 'transparent'}
                        stroke={isHovered ? '#d946ef' : 'transparent'}
                        strokeWidth="2"
                      />
                    </g>
                  );
                })}
              </g>
            )}

            {/* X-Axis Tick Labels (Duty Cycle 0% to 100%) */}
            {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((dutyVal) => {
              const x = pad.left + (dutyVal / 100) * plotW;
              return (
                <g key={dutyVal}>
                  <line
                    x1={x}
                    y1={pad.top + plotH}
                    x2={x}
                    y2={pad.top + plotH + 5}
                    stroke="#475569"
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y={pad.top + plotH + 16}
                    fill={dutyVal >= 85 ? '#f43f5e' : '#94a3b8'}
                    fontSize="8.5"
                    fontFamily="monospace"
                    textAnchor="middle"
                    fontWeight={dutyVal === 0 || dutyVal === 50 || dutyVal === 100 ? 'bold' : 'normal'}
                  >
                    {dutyVal}%
                  </text>
                </g>
              );
            })}

            {/* Axis Title Labels */}
            <text
              x={pad.left + plotW / 2}
              y={pad.top + plotH + 34}
              fill="#64748b"
              fontSize="9.5"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              PWM DUTY CYCLE MODULATION INDEX (%)
            </text>

            <text
              x={14}
              y={pad.top + plotH / 2}
              fill="#64748b"
              fontSize="9"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
              transform={`rotate(-90 14 ${pad.top + plotH / 2})`}
            >
              FREQUENCY / RUNTIME DENSITY (% OF SAMPLES)
            </text>
          </svg>

          {/* Interactive Floating Tooltip for 10s Trend Overlay Point */}
          {hoveredTrendPoint && (
            <div
              className="absolute pointer-events-none z-50 transition-all duration-75"
              style={{
                left: `${(hoveredTrendPoint.x / svgW) * 100}%`,
                top: `${(Math.min(svgH - 60, Math.max(20, hoveredTrendPoint.y)) / svgH) * 100}%`,
                transform: `translate(${
                  hoveredTrendPoint.x > svgW * 0.72 ? '-88%' : hoveredTrendPoint.x < svgW * 0.28 ? '-12%' : '-50%'
                }, -110%)`,
              }}
            >
              <div className="bg-[#120722]/95 backdrop-blur-md border border-fuchsia-500 rounded-xl p-3 shadow-2xl min-w-[270px] text-xs font-mono ring-1 ring-fuchsia-500/40 text-slate-200">
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-fuchsia-900/60">
                  <span className="flex items-center gap-1.5 text-fuchsia-300 font-bold">
                    <TrendingUp className="w-3.5 h-3.5 text-fuchsia-400" />
                    <span>10s Demand Instant</span>
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-950 border border-fuchsia-700 text-fuchsia-200 font-bold">
                    {hoveredTrendPoint.relTimeSec >= 0 ? 'NOW (0.0s)' : `${hoveredTrendPoint.relTimeSec}s ago`}
                  </span>
                </div>

                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">12-Joint Demand Avg:</span>
                    <span className="text-base font-bold text-fuchsia-300 tabular-nums">
                      {hoveredTrendPoint.avgDuty}%
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Locomotion Gait:</span>
                    <span className="text-slate-200 capitalize font-semibold">
                      {hoveredTrendPoint.gait} ({hoveredTrendPoint.velocity.toFixed(1)} m/s)
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Joint Torque Output:</span>
                    <span className="text-amber-300 font-semibold">{hoveredTrendPoint.torque.toFixed(1)} N·m</span>
                  </div>

                  <div className="pt-1.5 mt-1 border-t border-fuchsia-900/50">
                    <div className="text-[10px] text-slate-400 mb-1 flex items-center justify-between">
                      <span>4-Limb Average Demand:</span>
                      <span className="text-fuchsia-400 font-semibold">FL / FR / RL / RR</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-center text-[10px] font-mono font-bold">
                      <span className="p-1 rounded bg-slate-900 border border-slate-800 text-cyan-300">
                        FL: {hoveredTrendPoint.flAvg}%
                      </span>
                      <span className="p-1 rounded bg-slate-900 border border-slate-800 text-cyan-300">
                        FR: {hoveredTrendPoint.frAvg}%
                      </span>
                      <span className="p-1 rounded bg-slate-900 border border-slate-800 text-purple-300">
                        RL: {hoveredTrendPoint.rlAvg}%
                      </span>
                      <span className="p-1 rounded bg-slate-900 border border-slate-800 text-purple-300">
                        RR: {hoveredTrendPoint.rrAvg}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Interactive Floating Tooltip on Hover */}
          {hoveredBin && hoveredCoords && (
            <div
              onMouseEnter={handleTooltipMouseEnter}
              onMouseLeave={handleTooltipMouseLeave}
              className="absolute pointer-events-auto z-40 transition-all duration-100 ease-out"
              style={{
                left: `${(hoveredCoords.x / svgW) * 100}%`,
                top: `${(Math.min(svgH - 60, Math.max(10, hoveredCoords.y)) / svgH) * 100}%`,
                transform: `translate(${
                  hoveredCoords.x > svgW * 0.72 ? '-88%' : hoveredCoords.x < svgW * 0.28 ? '-12%' : '-50%'
                }, ${hoveredCoords.y < 110 ? '16px' : '-104%'})`,
              }}
            >
              <div className="bg-[#070e20]/95 backdrop-blur-md border border-cyan-500/80 rounded-xl p-3 shadow-2xl min-w-[290px] max-w-sm text-xs font-mono ring-1 ring-cyan-500/30">
                {/* Tooltip Header: Specific Motor ID & Exact PWM Frequency */}
                <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-500/70 font-bold text-[11px] flex items-center gap-1 shadow-sm">
                      <Cpu className="w-3 h-3 text-cyan-400" />
                      <span>Motor ID: <strong className="text-white">{hoveredBin.primaryMotorId}</strong></span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-semibold">({hoveredBin.primaryLimb})</span>
                  </div>

                  <span className="px-2 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/70 font-bold text-[10px] flex items-center gap-1 shadow-sm">
                    <Radio className="w-3 h-3 text-emerald-400" />
                    <span>Exact: <strong className="text-white">20,000 Hz</strong></span>
                  </span>
                </div>

                {/* Motor & PWM Frequency Details */}
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Actuator:</span>
                    <span className="font-semibold text-slate-200 text-right truncate max-w-[190px]" title={hoveredBin.primaryMotorName}>
                      {hoveredBin.primaryMotorName}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Exact PWM Frequency:</span>
                    <span className="font-bold text-emerald-300 flex items-center gap-1">
                      <span>20,000 Hz</span>
                      <span className="text-[10px] text-emerald-400/80">(20.00 kHz)</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Carrier Period (T_pwm):</span>
                    <span className="text-slate-200 font-mono">50.00 µs · Dead-time: 1.20 µs</span>
                  </div>

                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Active Pulse Width (t_on):</span>
                    <span className="text-cyan-300 font-bold font-mono">
                      {hoveredBin.pulseWidthUs.toFixed(2)} µs <span className="text-slate-500 font-normal">({hoveredBin.minDuty} - {hoveredBin.maxDuty}%)</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Phase RMS / Regime:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-amber-300 font-semibold">{hoveredBin.avgVoltageRms.toFixed(1)} V_rms</span>
                      <span
                        className="px-1.5 py-0.2 rounded text-[9px] uppercase font-bold border"
                        style={{ backgroundColor: `${hoveredBin.color}22`, borderColor: hoveredBin.color, color: hoveredBin.color }}
                      >
                        {hoveredBin.regime}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Sample Share:</span>
                    <span className="text-slate-200">
                      <strong className="text-cyan-400">{hoveredBin.count.toLocaleString()}</strong> samples ({hoveredBin.percentage.toFixed(2)}%)
                    </span>
                  </div>
                </div>

                {/* Contributing Motors Interactive Breakdown */}
                {hoveredBin.motorContributions.length > 1 && (
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
                      <span className="flex items-center gap-1">
                        <Layers className="w-3 h-3 text-cyan-400" />
                        <span>Contributing Motors ({hoveredBin.motorContributions.length}):</span>
                      </span>
                      <span className="text-[9px] text-cyan-400/80">Click to filter</span>
                    </div>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                      {hoveredBin.motorContributions.map((m) => {
                        const filterMap: Record<number, ActuatorChannelFilter> = {
                          0: 'fl_roll', 1: 'fl_pitch', 2: 'fl_knee',
                          3: 'fr_roll', 4: 'fr_pitch', 5: 'fr_knee',
                          6: 'rl_roll', 7: 'rl_pitch', 8: 'rl_knee',
                          9: 'rr_roll', 10: 'rr_pitch', 11: 'rr_knee',
                        };
                        const targetFilter = filterMap[m.motorIndex];
                        return (
                          <button
                            key={m.motorId}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (targetFilter) {
                                setChannelFilter(targetFilter);
                                if (telemetry.audioEnabled) audioSynth.playLidarPing(true);
                              }
                            }}
                            className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700/80 hover:border-cyan-400 text-[10px] font-mono text-slate-300 hover:text-cyan-300 transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                            title={`Filter specifically to ${m.motorId} (${m.motorName}) - Exact PWM Freq: 20,000 Hz`}
                          >
                            <span className="text-cyan-400 font-bold">{m.motorId}</span>
                            <span className="text-slate-500">({m.percentageInBin.toFixed(0)}%)</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Interactive Hover Tooltip & Channel Inspector Card */}
        {hoveredBin ? (
          <div className="mt-3 p-3.5 rounded-lg bg-slate-900/90 border border-cyan-500/70 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs font-mono animate-fadeIn">
            <div className="flex items-start sm:items-center gap-3">
              <span
                className="w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 sm:mt-0 shadow-lg ring-2 ring-white/20"
                style={{ backgroundColor: hoveredBin.color }}
              />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Specific Motor ID */}
                  <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-500/80 text-cyan-300 font-bold text-xs flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Motor ID: <strong className="text-white">{hoveredBin.primaryMotorId}</strong></span>
                  </span>

                  {/* Exact PWM Frequency */}
                  <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/80 text-emerald-300 font-bold text-xs flex items-center gap-1">
                    <Radio className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Exact PWM Freq: <strong className="text-white">{hoveredBin.exactPwmFrequencyFormatted}</strong></span>
                  </span>

                  {/* Duty Band */}
                  <span className="text-slate-200 font-bold">
                    Duty: {hoveredBin.minDuty}% - {hoveredBin.maxDuty}%
                  </span>
                  <span className="text-slate-400 uppercase text-[10px] px-1.5 py-0.5 rounded bg-slate-800">
                    {hoveredBin.regime}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>Actuator: <strong className="text-slate-300">{hoveredBin.primaryMotorName}</strong></span>
                  <span>Carrier Period: <strong className="text-slate-300">50.00 µs</strong></span>
                  <span>Pulse Width: <strong className="text-cyan-300">{hoveredBin.pulseWidthUs.toFixed(2)} µs</strong></span>
                  <span>Dead-time: <strong className="text-slate-300">1.20 µs</strong></span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-slate-300 border-t md:border-t-0 pt-2 md:pt-0 border-slate-800">
              <div>
                <span className="text-slate-500">Samples: </span>
                <span className="font-bold text-cyan-300">{hoveredBin.count.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-slate-500">Share: </span>
                <span className="font-bold text-amber-300">{hoveredBin.percentage.toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-slate-500">Phase Voltage: </span>
                <span className="font-bold text-emerald-300">{hoveredBin.avgVoltageRms.toFixed(1)} V_rms</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 py-2 px-3 rounded-lg bg-[#050811] border border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Hover over any histogram bar to inspect the specific Motor ID, exact 20,000 Hz PWM carrier frequency, pulse width timing, and runtime density.</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">
              Carrier: 20 kHz SVPWM · 1.2µs Dead-time
            </span>
          </div>
        )}
      </div>

      {/* Maneuver Injection Bench & Inverter Diagnostics Footer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-1">
        {/* Left: Interactive Duty Cycle Test Bench */}
        <div className="lg:col-span-7 bg-[#050914] p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h4 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider">
                Locomotion Maneuver Injection Bench
              </h4>
            </div>
            {activeSurgeState && (
              <span className="text-xs font-mono text-amber-300 animate-pulse font-bold">
                INJECTING: {activeSurgeState.name} ({(activeSurgeState.remainingMs / 1000).toFixed(1)}s)
              </span>
            )}
          </div>
          <p className="text-[11px] font-mono text-slate-400 mb-3">
            Inject synthetic gait duty regimes to observe dynamic histogram shifts, inverter bridge saturation, and thermal accumulation patterns.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { name: 'Static Stance Hold', biasDuty: 16.0, durationMs: 4000, desc: '14-18% Idle Duty' },
              { name: 'Nominal Trot Cruise', biasDuty: 38.0, durationMs: 4000, desc: '32-42% Nominal' },
              { name: 'Gallop Dynamic Surge', biasDuty: 68.0, durationMs: 4000, desc: '60-75% Dynamic' },
              { name: 'Incline Climb Overdrive', biasDuty: 92.0, durationMs: 4000, desc: '88-96% Saturation' },
            ].map((preset) => (
              <button
                key={preset.name}
                onClick={() => triggerSurgeManeuver(preset)}
                className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                  activeSurgeState?.name === preset.name
                    ? 'bg-amber-950/80 border-amber-500 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300 hover:text-slate-100'
                }`}
              >
                <div className="text-xs font-mono font-bold leading-tight flex items-center justify-between">
                  <span>{preset.name}</span>
                </div>
                <div className="text-[10px] font-mono text-slate-400 mt-1">{preset.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Actuator Phase & Gate Driver Specifications */}
        <div className="lg:col-span-5 bg-[#050914] p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h4 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider">
                FOC Gate Driver Specifications
              </h4>
            </div>
            <span className="text-[10px] font-mono text-slate-500">ISO26262 ASIL-C</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="p-2 rounded bg-slate-950 border border-slate-800/70">
              <span className="text-[10px] text-slate-500 block">SVPWM Carrier</span>
              <span className="text-cyan-300 font-bold">20.0 kHz (50.0 μs)</span>
            </div>
            <div className="p-2 rounded bg-slate-950 border border-slate-800/70">
              <span className="text-[10px] text-slate-500 block">Dead-Time Blanking</span>
              <span className="text-emerald-300 font-bold">1.20 μs (2.4%)</span>
            </div>
            <div className="p-2 rounded bg-slate-950 border border-slate-800/70">
              <span className="text-[10px] text-slate-500 block">Current Loop Rate</span>
              <span className="text-slate-200 font-bold">1.0 kHz FOC Closed Loop</span>
            </div>
            <div className="p-2 rounded bg-slate-950 border border-slate-800/70">
              <span className="text-[10px] text-slate-500 block">Inverter Bus DC</span>
              <span className="text-amber-300 font-bold">{DC_BUS_NOMINAL_V.toFixed(1)} V (48V Li-Ion)</span>
            </div>
          </div>

          <div className="mt-2.5 text-[10px] font-mono text-slate-400 flex items-center justify-between">
            <span>Thermal Derating Ceiling: <strong className="text-rose-400">82°C Gate Driver</strong></span>
            <span className="text-emerald-400 font-semibold">● FOC Sync OK</span>
          </div>
        </div>
      </div>
    </div>
  );
};
