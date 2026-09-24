import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TelemetryState, DiagnosticEvent } from '../types/robotics';
import { audioSynth } from '../utils/audioSynthesizer';
import {
  TrendingDown,
  Zap,
  Activity,
  AlertTriangle,
  Flame,
  ShieldAlert,
  Clock,
  RotateCcw,
  Play,
  Pause,
  Download,
  FileText,
  Copy,
  Check,
  X,
  Maximize2,
  Gauge,
  Sliders,
  ChevronRight,
  Info,
  Layers,
  Sparkles,
  Mountain,
  BellRing,
  Radio,
} from 'lucide-react';

interface BatteryDischargeVoltageSagChartProps {
  telemetry: TelemetryState;
  updateTelemetry: (partial: Partial<TelemetryState>) => void;
  onLogDiagnosticEvent?: (event: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'>) => void;
}

export interface VoltageSagEvent {
  id: string;
  timeSec: number;              // Relative seconds from start
  timestamp: string;            // HH:MM:SS
  movementName: string;         // 'Power Burst Climb', 'Gallop Dynamic Surge', etc.
  vPre: number;                 // Pre-sag nominal voltage (V)
  vTrough: number;              // Lowest voltage during sag (V)
  vSag: number;                 // Voltage drop magnitude ΔV (V, positive number)
  peakTorque: number;           // Total joint torque (N·m)
  peakCurrent: number;          // Peak inverter current (A)
  durationMs: number;           // Duration of sag dip in ms
  severity: 'mild' | 'moderate' | 'critical';
  rIntEstimatedMo: number;      // Estimated cell internal resistance (mΩ)
}

export interface DischargeTelemetryPoint {
  timeSec: number;              // Relative seconds
  timestamp: string;            // Time string
  voltage: number;              // Pack terminal voltage (V)
  nominalVocv: number;          // Open circuit voltage estimate (V)
  sagDeltaV: number;            // Current sag from Vocv (V)
  socPercent: number;           // State of charge %
  torqueNm: number;             // Total joint torque output (N·m)
  currentAmps: number;          // Current draw (A)
  powerWatts: number;           // Power draw (W)
  isSagActive: boolean;         // True if currently sagging
  sagSeverity: 'none' | 'mild' | 'moderate' | 'critical';
  movementLabel?: string;       // Movement descriptor
}

export const BatteryDischargeVoltageSagChart: React.FC<BatteryDischargeVoltageSagChartProps> = ({
  telemetry,
  updateTelemetry,
  onLogDiagnosticEvent,
}) => {
  // Chart state
  const [dataPoints, setDataPoints] = useState<DischargeTelemetryPoint[]>([]);
  const [sagEvents, setSagEvents] = useState<VoltageSagEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [timeWindowSec, setTimeWindowSec] = useState<number>(60); // 30, 60, 120, 300
  const [viewMode, setViewMode] = useState<'dual' | 'voltage_only' | 'torque_only'>('dual');
  const [showEventMarkers, setShowEventMarkers] = useState<boolean>(true);
  const [showVocvBaseline, setShowVocvBaseline] = useState<boolean>(true);
  const [showShadingArea, setShowShadingArea] = useState<boolean>(true);

  // Predictive Projection Line & Forecast State
  const [showPredictiveForecast, setShowPredictiveForecast] = useState<boolean>(true);
  const [forecastHorizonSec, setForecastHorizonSec] = useState<number>(60); // 30, 60, 120
  const [forecastModelMode, setForecastModelMode] = useState<'live' | 'surge' | 'eco'>('live');
  const [hoveredForecastIndex, setHoveredForecastIndex] = useState<number | null>(null);

  // Scrubber tooltip state
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  // Critical Under-Voltage Threshold & Visual Notification State
  const [criticalThreshold, setCriticalThreshold] = useState<number>(42.0); // 42.0V BMS UVLO cutoff floor
  const [isAlertDismissed, setIsAlertDismissed] = useState<boolean>(false);
  const [simulatedCriticalDrop, setSimulatedCriticalDrop] = useState<boolean>(false);
  const prevCriticalRef = useRef<boolean>(false);

  // Dataset Export Modal & Options State
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [exportScope, setExportScope] = useState<'window' | 'all'>('window');
  const [includePredictiveInExport, setIncludePredictiveInExport] = useState<boolean>(true);
  const [includeSagEventsInExport, setIncludeSagEventsInExport] = useState<boolean>(true);
  const [exportNotification, setExportNotification] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState<boolean>(false);

  // High-Torque Test Maneuver injection state
  const [activeManeuver, setActiveManeuver] = useState<{
    name: string;
    torqueTarget: number;
    currentAmps: number;
    durationMs: number;
    remainingMs: number;
  } | null>(null);

  const startTimeRef = useRef<number>(Date.now() - 60000);
  const lastSampleSecRef = useRef<number>(0);
  const activeSagTrackingRef = useRef<{
    startTimeSec: number;
    vPre: number;
    vTrough: number;
    peakTorque: number;
    peakCurrent: number;
    movementName: string;
  } | null>(null);

  // Battery Physical Constants for 12S Li-Ion Pack
  const CELL_COUNT = 12;
  const CELL_R_INTERNAL_OHMS = 0.0045; // 4.5 mΩ per cell * 12 = 54 mΩ pack impedance
  const PACK_R_INTERNAL_OHMS = CELL_COUNT * CELL_R_INTERNAL_OHMS; // 0.054 Ω (54 mΩ)
  const CRITICAL_CUTOFF_VOLTAGE = criticalThreshold; // Dynamic threshold, default 42.0V
  const WARNING_SAG_VOLTAGE = 44.5;    // 3.71V / cell
  const NOMINAL_PACK_VOLTAGE = 48.0;   // 4.00V / cell

  // Estimate Open-Circuit Voltage Vocv from SoC percentage
  const calculateVocvFromSoc = useCallback((soc: number): number => {
    const s = Math.max(0, Math.min(100, soc)) / 100;
    // Li-Ion OCV curve polynomial approximation
    const cellVocv = 3.35 + 0.78 * s + 0.12 * Math.pow(s, 2) - 0.05 * Math.exp(-12 * s);
    return parseFloat((cellVocv * CELL_COUNT).toFixed(2));
  }, []);

  // Initialize 60 seconds of realistic past discharge data with high-torque sag events
  useEffect(() => {
    const initialPoints: DischargeTelemetryPoint[] = [];
    const initialEvents: VoltageSagEvent[] = [];
    const baseSoc = telemetry.batteryPercent || 86;
    const now = Date.now();
    const startTime = now - 60000;
    startTimeRef.current = startTime;

    // Generate 60 seconds at 250ms intervals = 240 samples
    for (let i = 0; i <= 240; i++) {
      const elapsedSec = (i * 250) / 1000;
      const pointTime = new Date(startTime + elapsedSec * 1000);
      const timestamp = pointTime.toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' });

      // Gradual natural discharge trend (~0.2% per minute)
      const soc = Math.max(10, baseSoc + 0.2 - (elapsedSec / 60) * 0.2);
      const vocv = calculateVocvFromSoc(soc);

      let torque = 14.5 + Math.sin(elapsedSec * 0.8) * 2.5; // Nominal walk/trot torque (12-17 N·m)
      let current = 4.8 + Math.sin(elapsedSec * 0.6) * 0.6; // Nominal current (4.2-5.4 A)
      let movementLabel = 'Nominal Cruise';

      // Inject Past High-Torque Event 1: At T = 15s to 21s (Gallop High-Torque Surge)
      if (elapsedSec >= 15 && elapsedSec <= 21) {
        const bell = Math.sin(((elapsedSec - 15) / 6) * Math.PI);
        torque = 15.0 + bell * 65.0; // Spikes to 80 N·m
        current = 5.0 + bell * 10.5; // Spikes to 15.5 A
        movementLabel = 'Gallop Thrust Burst';
      }

      // Inject Past High-Torque Event 2: At T = 38s to 45s (Power Burst Incline Climb)
      if (elapsedSec >= 38 && elapsedSec <= 45) {
        const bell = Math.sin(((elapsedSec - 38) / 7) * Math.PI);
        torque = 15.0 + bell * 155.0; // Spikes to 170 N·m!
        current = 5.0 + bell * 13.5;  // Spikes to 18.5 A
        movementLabel = 'Power Burst Climb [172 N·m]';
      }

      // Instantaneous Ohm's Law voltage drop: V_terminal = Vocv - (I * R_int)
      // High-torque movements cause large current draw which induces voltage sag
      const irDrop = current * PACK_R_INTERNAL_OHMS;
      // Slight polarization sag delay factor
      const polarizationDrop = current > 10 ? (current - 10) * 0.08 : 0;
      const totalSag = parseFloat((irDrop + polarizationDrop).toFixed(3));
      const terminalVoltage = parseFloat((vocv - totalSag).toFixed(2));
      const power = Math.round(terminalVoltage * current);

      const isSag = totalSag >= 0.7;
      let sagSev: 'none' | 'mild' | 'moderate' | 'critical' = 'none';
      if (totalSag >= 2.2) sagSev = 'critical';
      else if (totalSag >= 1.2) sagSev = 'moderate';
      else if (totalSag >= 0.7) sagSev = 'mild';

      initialPoints.push({
        timeSec: parseFloat(elapsedSec.toFixed(2)),
        timestamp,
        voltage: terminalVoltage,
        nominalVocv: vocv,
        sagDeltaV: totalSag,
        socPercent: parseFloat(soc.toFixed(1)),
        torqueNm: parseFloat(torque.toFixed(1)),
        currentAmps: parseFloat(current.toFixed(2)),
        powerWatts: power,
        isSagActive: isSag,
        sagSeverity: sagSev,
        movementLabel: isSag ? movementLabel : undefined,
      });
    }

    // Register the 2 historical sag events in log
    initialEvents.push({
      id: 'sag-hist-01',
      timeSec: 18.0,
      timestamp: new Date(startTime + 18000).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' }),
      movementName: 'Gallop Dynamic Thrust',
      vPre: 48.72,
      vTrough: 47.15,
      vSag: 1.57,
      peakTorque: 80.0,
      peakCurrent: 15.5,
      durationMs: 6000,
      severity: 'moderate',
      rIntEstimatedMo: 54.8,
    });

    initialEvents.push({
      id: 'sag-hist-02',
      timeSec: 41.5,
      timestamp: new Date(startTime + 41500).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' }),
      movementName: 'Power Burst Incline Climb',
      vPre: 48.65,
      vTrough: 45.32,
      vSag: 3.33,
      peakTorque: 170.0,
      peakCurrent: 18.5,
      durationMs: 7000,
      severity: 'critical',
      rIntEstimatedMo: 56.2,
    });

    setDataPoints(initialPoints);
    setSagEvents(initialEvents);
    lastSampleSecRef.current = 60.0;
  }, [calculateVocvFromSoc]);

  // Maneuver Timer & Simulation Engine
  useEffect(() => {
    if (!activeManeuver) return;

    const tickMs = 100;
    const interval = setInterval(() => {
      setActiveManeuver((prev) => {
        if (!prev) return null;
        const nextRemaining = prev.remainingMs - tickMs;
        if (nextRemaining <= 0) {
          // Rebound back to nominal closed loop
          updateTelemetry({
            voltage: 48.24,
            totalTorqueOutput: 16.2,
            current: 4.85,
            power: 234.0,
          });
          setSimulatedCriticalDrop(false);
          return null;
        }
        return { ...prev, remainingMs: nextRemaining };
      });
    }, tickMs);

    return () => clearInterval(interval);
  }, [activeManeuver, updateTelemetry]);

  // Real-Time High-Frequency Sampling Loop (every 250ms)
  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsedSec = parseFloat(((now - startTimeRef.current) / 1000).toFixed(2));
      const timestamp = new Date().toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' });

      // Live physical values from telemetry or active maneuver
      const currentSoc = telemetry.batteryPercent;
      const vocv = calculateVocvFromSoc(currentSoc);

      let torque = telemetry.totalTorqueOutput || 16.0;
      let current = telemetry.current || 4.8;
      let movementName = telemetry.powerBurstActive
        ? 'Power Burst Maximum Torque'
        : telemetry.gait === 'gallop'
        ? 'Gallop High-Cadence'
        : telemetry.linearVelocity > 1.8
        ? 'High-Speed Sprint'
        : 'Cruising Locomotion';

      // Override if test maneuver is running
      if (activeManeuver) {
        torque = activeManeuver.torqueTarget;
        current = activeManeuver.currentAmps;
        movementName = activeManeuver.name;
      }

      // Calculate Physical Voltage Sag:
      // Ohmic Sag = I * R_pack
      // When torque > 40 N·m, motor winding back-EMF and inverter duty cause rapid voltage droop
      const torqueOverhead = Math.max(0, torque - 20);
      const torqueInducedSag = (torqueOverhead / 100) * 1.85; // Extra droop for high torque
      const irSag = current * PACK_R_INTERNAL_OHMS;
      let totalSag = parseFloat((irSag + torqueInducedSag).toFixed(3));

      // Inject critical under-voltage droop if critical test maneuver or simulation is active
      if (activeManeuver?.name.includes('<42V') || simulatedCriticalDrop) {
        totalSag = Math.max(totalSag, parseFloat((vocv - 41.22).toFixed(2)));
      }

      const terminalV = parseFloat(Math.max(38.0, vocv - totalSag).toFixed(2));
      const powerW = Math.round(terminalV * current);

      // Keep telemetry in sync with physical sag
      if (Math.abs(telemetry.voltage - terminalV) > 0.05) {
        updateTelemetry({
          voltage: terminalV,
          power: powerW,
          totalTorqueOutput: parseFloat(torque.toFixed(1)),
          current: parseFloat(current.toFixed(2)),
        });
      }

      // Sag threshold classification
      const isSag = totalSag >= 0.75;
      let sagSev: 'none' | 'mild' | 'moderate' | 'critical' = 'none';
      if (totalSag >= 2.4 || terminalV <= WARNING_SAG_VOLTAGE) sagSev = 'critical';
      else if (totalSag >= 1.3) sagSev = 'moderate';
      else if (totalSag >= 0.75) sagSev = 'mild';

      // Manage Sag Event Tracking & Flagging
      if (isSag) {
        if (!activeSagTrackingRef.current) {
          // Beginning of a new sag event
          activeSagTrackingRef.current = {
            startTimeSec: elapsedSec,
            vPre: terminalV + totalSag,
            vTrough: terminalV,
            peakTorque: torque,
            peakCurrent: current,
            movementName,
          };
        } else {
          // Ongoing sag: track trough and peaks
          const track = activeSagTrackingRef.current;
          if (terminalV < track.vTrough) track.vTrough = terminalV;
          if (torque > track.peakTorque) track.peakTorque = torque;
          if (current > track.peakCurrent) track.peakCurrent = current;
        }
      } else {
        if (activeSagTrackingRef.current) {
          // Sag just concluded and recovered! Log event
          const track = activeSagTrackingRef.current;
          const duration = Math.round((elapsedSec - track.startTimeSec) * 1000);
          const vSagDrop = parseFloat((track.vPre - track.vTrough).toFixed(2));

          if (vSagDrop >= 0.8 && duration >= 400) {
            const rIntEst = parseFloat(((vSagDrop / Math.max(1, track.peakCurrent)) * 1000).toFixed(1));
            const newEvent: VoltageSagEvent = {
              id: `sag-${Date.now()}`,
              timeSec: parseFloat(((track.startTimeSec + elapsedSec) / 2).toFixed(2)),
              timestamp,
              movementName: track.movementName,
              vPre: track.vPre,
              vTrough: track.vTrough,
              vSag: vSagDrop,
              peakTorque: parseFloat(track.peakTorque.toFixed(1)),
              peakCurrent: parseFloat(track.peakCurrent.toFixed(2)),
              durationMs: duration,
              severity: vSagDrop >= 2.4 ? 'critical' : vSagDrop >= 1.3 ? 'moderate' : 'mild',
              rIntEstimatedMo: rIntEst,
            };

            setSagEvents((prev) => [newEvent, ...prev.slice(0, 19)]); // Keep last 20 events

            // Dispatch diagnostic event
            if (vSagDrop >= 1.5) {
              const diagEvent: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'> = {
                severity: vSagDrop >= 2.5 ? 'critical' : 'warning',
                subsystem: 'BMS-48V',
                code: 'VOLTAGE_SAG_HIGH_TORQUE',
                message: `Voltage Sag Event: Terminal pack voltage dropped by ${vSagDrop.toFixed(2)}V (trough: ${track.vTrough.toFixed(2)}V) during high-torque movement "${track.movementName}" (${track.peakTorque.toFixed(1)} N·m).`,
                metric: `ΔV: -${vSagDrop.toFixed(2)}V | Peak Torque: ${track.peakTorque.toFixed(1)} N·m | Current: ${track.peakCurrent.toFixed(1)}A`,
              };

              if (onLogDiagnosticEvent) {
                onLogDiagnosticEvent(diagEvent);
              }
              window.dispatchEvent(
                new CustomEvent('robodog:log-diagnostic-event', { detail: diagEvent })
              );

              if (telemetry.audioEnabled) {
                audioSynth.playAlert(true);
              }
            }
          }
          activeSagTrackingRef.current = null;
        }
      }

      const newPoint: DischargeTelemetryPoint = {
        timeSec: elapsedSec,
        timestamp,
        voltage: terminalV,
        nominalVocv: vocv,
        sagDeltaV: totalSag,
        socPercent: parseFloat(currentSoc.toFixed(1)),
        torqueNm: parseFloat(torque.toFixed(1)),
        currentAmps: parseFloat(current.toFixed(2)),
        powerWatts: powerW,
        isSagActive: isSag,
        sagSeverity: sagSev,
        movementLabel: isSag ? movementName : undefined,
      };

      setDataPoints((prev) => {
        const next = [...prev, newPoint];
        // Keep points up to 360 seconds buffer
        return next.filter((p) => elapsedSec - p.timeSec <= 360);
      });
    }, 250);

    return () => clearInterval(interval);
  }, [
    isPaused,
    telemetry.batteryPercent,
    telemetry.totalTorqueOutput,
    telemetry.current,
    telemetry.voltage,
    telemetry.powerBurstActive,
    telemetry.gait,
    telemetry.linearVelocity,
    telemetry.audioEnabled,
    activeManeuver,
    calculateVocvFromSoc,
    updateTelemetry,
    onLogDiagnosticEvent,
    PACK_R_INTERNAL_OHMS,
  ]);

  // Filter Points to Current Active Time Window
  const visiblePoints = useMemo(() => {
    if (dataPoints.length === 0) return [];
    const latestTime = dataPoints[dataPoints.length - 1].timeSec;
    return dataPoints.filter((pt) => latestTime - pt.timeSec <= timeWindowSec);
  }, [dataPoints, timeWindowSec]);

  // Aggregate Quantitative Statistics
  const stats = useMemo(() => {
    if (visiblePoints.length === 0) {
      return {
        currentV: 48.0,
        vocv: 48.6,
        currentSag: 0.6,
        maxSag: 3.33,
        avgSag: 0.85,
        minVoltage: 45.32,
        maxVoltage: 48.85,
        maxTorque: 170.0,
        avgCurrent: 5.2,
        rIntEstMo: 54.2,
        cutoffMarginV: 6.0,
        sagEventCount: sagEvents.length,
      };
    }

    const voltages = visiblePoints.map((p) => p.voltage);
    const sags = visiblePoints.map((p) => p.sagDeltaV);
    const torques = visiblePoints.map((p) => p.torqueNm);
    const currents = visiblePoints.map((p) => p.currentAmps);

    const latest = visiblePoints[visiblePoints.length - 1];
    const minV = Math.min(...voltages);
    const maxV = Math.max(...voltages);
    const maxSag = Math.max(...sags);
    const avgSag = sags.reduce((a, b) => a + b, 0) / sags.length;
    const maxTorque = Math.max(...torques);
    const avgCurrent = currents.reduce((a, b) => a + b, 0) / currents.length;
    const cutoffMargin = Math.max(0, latest.voltage - CRITICAL_CUTOFF_VOLTAGE);

    // Dynamic R_internal estimation: avg(ΔV / I) in mΩ
    const highLoadPoints = visiblePoints.filter((p) => p.currentAmps > 8.0);
    const rEst = highLoadPoints.length > 0
      ? (highLoadPoints.reduce((acc, p) => acc + (p.sagDeltaV / p.currentAmps), 0) / highLoadPoints.length) * 1000
      : 54.0;

    return {
      currentV: latest.voltage,
      vocv: latest.nominalVocv,
      currentSag: latest.sagDeltaV,
      maxSag: parseFloat(maxSag.toFixed(2)),
      avgSag: parseFloat(avgSag.toFixed(2)),
      minVoltage: parseFloat(minV.toFixed(2)),
      maxVoltage: parseFloat(maxV.toFixed(2)),
      maxTorque: parseFloat(maxTorque.toFixed(1)),
      avgCurrent: parseFloat(avgCurrent.toFixed(2)),
      rIntEstMo: parseFloat(rEst.toFixed(1)),
      cutoffMarginV: parseFloat(cutoffMargin.toFixed(2)),
      sagEventCount: sagEvents.length,
    };
  }, [visiblePoints, sagEvents, CRITICAL_CUTOFF_VOLTAGE]);

  // Battery Pack Constants for Predictive Discharge Model
  const PACK_CAPACITY_WH = 720.0; // 12S Li-ion 15.0 Ah pack (48.0V nominal)
  const RESERVE_SOC_PERCENT = 8.0; // Reserve safety buffer above 42.0V BMS cutoff

  // Compute Current Power Consumption Trend and Forecasted Projection Line
  const powerTrendData = useMemo(() => {
    // Determine recent rolling average power consumption from visible telemetry
    const recent = visiblePoints.slice(-24); // ~last 6 seconds
    const avgRecentPower = recent.length > 0
      ? recent.reduce((sum, p) => sum + p.powerWatts, 0) / recent.length
      : telemetry.power || 234.0;

    let trendPowerWatts = avgRecentPower;
    if (forecastModelMode === 'surge') {
      trendPowerWatts = Math.max(avgRecentPower * 1.75, 620.0);
    } else if (forecastModelMode === 'eco') {
      trendPowerWatts = Math.min(avgRecentPower * 0.55, 115.0);
    }

    const currentSoc = telemetry.batteryPercent;
    const latestTimeSec = visiblePoints.length > 0 ? visiblePoints[visiblePoints.length - 1].timeSec : 60;

    // Remaining usable energy (Wh) and runtime projection (minutes)
    const usableEnergyWh = Math.max(0, ((currentSoc - RESERVE_SOC_PERCENT) / 100) * PACK_CAPACITY_WH);
    const remainingLifeMinutes = Math.max(0, (usableEnergyWh / Math.max(25, trendPowerWatts)) * 60);

    // Dynamic rate of SoC depletion and terminal voltage decay
    const socDepletionRatePerMin = (trendPowerWatts / PACK_CAPACITY_WH) * 100 * (1 / 60);
    const voltageDropRatePerMin = socDepletionRatePerMin * 0.082;

    // Generate future forecasted trajectory points along the forecast horizon
    const forecastPoints: Array<{
      timeSec: number;
      relForecastSec: number;
      timestamp: string;
      voltage: number;
      upperVoltage: number;
      lowerVoltage: number;
      socPercent: number;
      powerWatts: number;
      remainingLifeMin: number;
    }> = [];

    const steps = Math.min(60, forecastHorizonSec);
    const dt = forecastHorizonSec / steps;
    const nowTimestamp = Date.now();

    for (let i = 0; i <= steps; i++) {
      const relSec = i * dt;
      const tSec = parseFloat((latestTimeSec + relSec).toFixed(2));
      const futureDate = new Date(nowTimestamp + relSec * 1000);
      const timestamp = futureDate.toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' });

      // Energy consumed along interval
      const energyConsumedWh = (trendPowerWatts * relSec) / 3600;
      const projectedSoc = Math.max(0, currentSoc - (energyConsumedWh / PACK_CAPACITY_WH) * 100);
      const projectedVocv = calculateVocvFromSoc(projectedSoc);
      const projectedCurrent = trendPowerWatts / Math.max(35, projectedVocv);
      const projectedIrDrop = projectedCurrent * PACK_R_INTERNAL_OHMS;

      // Extra droop under heavy surge
      const projectedTorqueDrop = forecastModelMode === 'surge' ? 1.4 : 0.25;
      const projectedTerminalV = Math.max(40.0, parseFloat((projectedVocv - projectedIrDrop - projectedTorqueDrop).toFixed(2)));

      // Confidence corridor bounds (±18% variance)
      const upperPower = trendPowerWatts * 0.78;
      const lowerPower = trendPowerWatts * 1.35;
      const upperSoc = Math.max(0, currentSoc - ((upperPower * relSec) / 3600 / PACK_CAPACITY_WH) * 100);
      const lowerSoc = Math.max(0, currentSoc - ((lowerPower * relSec) / 3600 / PACK_CAPACITY_WH) * 100);
      const upperVocv = calculateVocvFromSoc(upperSoc);
      const lowerVocv = calculateVocvFromSoc(lowerSoc);
      const upperV = Math.max(40.0, parseFloat((upperVocv - (upperPower / upperVocv) * PACK_R_INTERNAL_OHMS).toFixed(2)));
      const lowerV = Math.max(40.0, parseFloat((lowerVocv - (lowerPower / lowerVocv) * PACK_R_INTERNAL_OHMS - (forecastModelMode === 'surge' ? 1.8 : 0.5)).toFixed(2)));

      const stepRemainingLife = Math.max(0, remainingLifeMinutes - (relSec / 60));

      forecastPoints.push({
        timeSec: tSec,
        relForecastSec: parseFloat(relSec.toFixed(1)),
        timestamp,
        voltage: projectedTerminalV,
        upperVoltage: upperV,
        lowerVoltage: lowerV,
        socPercent: parseFloat(projectedSoc.toFixed(1)),
        powerWatts: Math.round(trendPowerWatts),
        remainingLifeMin: parseFloat(stepRemainingLife.toFixed(1)),
      });
    }

    return {
      trendPowerWatts: Math.round(trendPowerWatts),
      avgRecentPower: Math.round(avgRecentPower),
      remainingLifeMinutes: parseFloat(remainingLifeMinutes.toFixed(1)),
      socDepletionRatePerMin: parseFloat(socDepletionRatePerMin.toFixed(2)),
      voltageDropRatePerMin: parseFloat(voltageDropRatePerMin.toFixed(3)),
      forecastPoints,
      endForecast: forecastPoints[forecastPoints.length - 1],
    };
  }, [
    visiblePoints,
    telemetry.power,
    telemetry.batteryPercent,
    forecastModelMode,
    forecastHorizonSec,
    calculateVocvFromSoc,
    PACK_R_INTERNAL_OHMS,
  ]);

  // Detect Critical Under-Voltage Condition (< 42.0V)
  const isVoltageCritical = stats.currentV < criticalThreshold || telemetry.voltage < criticalThreshold;

  // Monitor critical voltage state transitions and dispatch alerts
  useEffect(() => {
    if (isVoltageCritical && !prevCriticalRef.current) {
      setIsAlertDismissed(false);
      if (telemetry.audioEnabled) {
        audioSynth.playAlert(true);
      }
      const diagEvent: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'> = {
        severity: 'critical',
        subsystem: 'BMS-48V',
        code: 'BMS_CRITICAL_UNDERVOLTAGE_UVLO',
        message: `CRITICAL UNDERVOLTAGE ALERT: Terminal pack voltage dropped to ${stats.currentV.toFixed(2)}V, breaching the ${criticalThreshold.toFixed(1)}V cutoff threshold. High risk of inverter lockout & cell reversal.`,
        metric: `Voltage: ${stats.currentV.toFixed(2)}V | Threshold: ${criticalThreshold.toFixed(1)}V | Margin: ${(stats.currentV - criticalThreshold).toFixed(2)}V`,
      };
      if (onLogDiagnosticEvent) {
        onLogDiagnosticEvent(diagEvent);
      }
      window.dispatchEvent(
        new CustomEvent('robodog:log-diagnostic-event', { detail: diagEvent })
      );
    }
    prevCriticalRef.current = isVoltageCritical;
  }, [isVoltageCritical, stats.currentV, criticalThreshold, telemetry.audioEnabled, onLogDiagnosticEvent]);

  // Emergency load shed handler to recover voltage
  const handleEmergencyLoadShed = () => {
    setSimulatedCriticalDrop(false);
    setActiveManeuver(null);
    updateTelemetry({
      voltage: 48.24,
      totalTorqueOutput: 14.2,
      current: 4.6,
      power: 220,
      powerBurstActive: false,
    });
    if (telemetry.audioEnabled) {
      audioSynth.playDockingLatch(true);
    }
  };

  // Inject High-Torque Test Maneuver
  const triggerHighTorqueManeuver = (preset: {
    name: string;
    torque: number;
    current: number;
    durationMs: number;
  }) => {
    const isCriticalPreset = preset.name.includes('<42V') || preset.torque >= 180;
    setActiveManeuver({
      name: preset.name,
      torqueTarget: preset.torque,
      currentAmps: preset.current,
      durationMs: preset.durationMs,
      remainingMs: preset.durationMs,
    });

    if (isCriticalPreset) {
      setSimulatedCriticalDrop(true);
      updateTelemetry({
        voltage: 41.22,
        totalTorqueOutput: preset.torque,
        current: preset.current,
        power: preset.torque * 5.2 + 250,
      });
      if (telemetry.audioEnabled) {
        audioSynth.playAlert(true);
      }
    } else {
      updateTelemetry({
        totalTorqueOutput: preset.torque,
        current: preset.current,
        power: preset.torque * 4.5 + 230,
      });
      if (telemetry.audioEnabled) {
        audioSynth.playPowerBurst(true);
      }
    }
  };

  // Telemetry Dataset Export Functions (JSON & CSV)
  const getExportSourcePoints = useCallback((scope: 'window' | 'all') => {
    if (scope === 'window') {
      return visiblePoints;
    }
    return dataPoints;
  }, [visiblePoints, dataPoints]);

  const generateFormattedExport = useCallback((format: 'json' | 'csv') => {
    const sourcePoints = getExportSourcePoints(exportScope);

    if (format === 'json') {
      const exportPayload = {
        metadata: {
          platform: 'Cerberus-04 12-DOF Bionic Quadruped',
          subsystem: 'Battery Management System (BMS-48V) & Powertrain Telemetry',
          exportTimestampIso: new Date().toISOString(),
          exportTimestampLocal: new Date().toLocaleString(),
          exportScope: exportScope === 'window' ? `Current Visible Window (${timeWindowSec}s)` : 'Full Session Buffer',
          recordCount: sourcePoints.length,
          timeRangeSec: {
            start: sourcePoints.length > 0 ? sourcePoints[0].timeSec : 0,
            end: sourcePoints.length > 0 ? sourcePoints[sourcePoints.length - 1].timeSec : 0,
            durationSec: sourcePoints.length > 1
              ? parseFloat((sourcePoints[sourcePoints.length - 1].timeSec - sourcePoints[0].timeSec).toFixed(2))
              : 0,
          },
          batteryConfiguration: {
            nominalVoltageV: NOMINAL_PACK_VOLTAGE,
            chemistry: 'Li-Ion NMC (Samsung 21700-40T 12S5P)',
            cellCount: CELL_COUNT,
            packCapacityWh: 720.0,
            criticalCutoffThresholdV: criticalThreshold,
            nominalInternalResistanceMilliOhms: PACK_R_INTERNAL_OHMS * 1000,
            currentPackSoCPercent: telemetry.batteryPercent,
          },
          analyticalSummary: {
            currentTerminalVoltageV: stats.currentV,
            openCircuitVoltageVocv: stats.vocv,
            minTerminalVoltageV: stats.minVoltage,
            maxSagDeltaV: stats.maxSag,
            avgSagDeltaV: stats.avgSag,
            peakJointTorqueNm: stats.maxTorque,
            avgInverterCurrentAmps: stats.avgCurrent,
            estimatedInternalImpedanceMo: stats.rIntEstMo,
            cutoffSafetyMarginV: stats.cutoffMarginV,
            sagEventsCount: sagEvents.length,
            predictiveRemainingLifeMin: powerTrendData.remainingLifeMinutes,
            powerConsumptionTrendWatts: powerTrendData.trendPowerWatts,
          },
        },
        sagIncidentLog: includeSagEventsInExport ? sagEvents : undefined,
        telemetryPoints: sourcePoints.map((pt) => ({
          timeSec: pt.timeSec,
          timestamp: pt.timestamp,
          voltageV: pt.voltage,
          nominalVocvV: pt.nominalVocv,
          sagDeltaV: pt.sagDeltaV,
          socPercent: pt.socPercent,
          torqueNm: pt.torqueNm,
          currentAmps: pt.currentAmps,
          powerWatts: pt.powerWatts,
          isSagActive: pt.isSagActive,
          sagSeverity: pt.sagSeverity,
          movementLabel: pt.movementLabel || 'Nominal Cruise',
        })),
        predictiveExtrapolation: includePredictiveInExport && powerTrendData.forecastPoints
          ? powerTrendData.forecastPoints.map((fpt) => ({
              timeSec: fpt.timeSec,
              relForecastSec: fpt.relForecastSec,
              timestamp: fpt.timestamp,
              projectedVoltageV: fpt.voltage,
              upperBoundV: fpt.upperVoltage,
              lowerBoundV: fpt.lowerVoltage,
              projectedSocPercent: fpt.socPercent,
              trendPowerWatts: fpt.powerWatts,
              remainingLifeMin: fpt.remainingLifeMin,
            }))
          : undefined,
      };

      return JSON.stringify(exportPayload, null, 2);
    } else {
      // CSV generation
      const headers = [
        'time_sec',
        'timestamp',
        'terminal_voltage_v',
        'vocv_baseline_v',
        'sag_delta_v',
        'soc_percent',
        'joint_torque_nm',
        'inverter_current_a',
        'pack_power_w',
        'is_sag_active',
        'sag_severity',
        'movement_label',
      ];

      const rows = sourcePoints.map((pt) => [
        pt.timeSec.toFixed(2),
        `"${pt.timestamp}"`,
        pt.voltage.toFixed(2),
        pt.nominalVocv.toFixed(2),
        pt.sagDeltaV.toFixed(2),
        pt.socPercent.toFixed(1),
        pt.torqueNm.toFixed(1),
        pt.currentAmps.toFixed(2),
        pt.powerWatts.toFixed(1),
        pt.isSagActive ? 'TRUE' : 'FALSE',
        pt.sagSeverity,
        `"${(pt.movementLabel || 'Nominal Cruise').replace(/"/g, '""')}"`,
      ]);

      if (includePredictiveInExport && powerTrendData.forecastPoints) {
        powerTrendData.forecastPoints.forEach((fpt) => {
          rows.push([
            fpt.timeSec.toFixed(2),
            `"${fpt.timestamp}"`,
            fpt.voltage.toFixed(2),
            (fpt.voltage + 0.6).toFixed(2),
            '0.00',
            fpt.socPercent.toFixed(1),
            '0.0',
            (fpt.powerWatts / Math.max(35, fpt.voltage)).toFixed(2),
            fpt.powerWatts.toFixed(1),
            'FALSE',
            'none',
            '"Predictive Forecast Extrapolation"',
          ]);
        });
      }

      return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    }
  }, [
    getExportSourcePoints,
    exportScope,
    timeWindowSec,
    NOMINAL_PACK_VOLTAGE,
    CELL_COUNT,
    criticalThreshold,
    PACK_R_INTERNAL_OHMS,
    telemetry.batteryPercent,
    stats,
    sagEvents,
    includeSagEventsInExport,
    includePredictiveInExport,
    powerTrendData,
  ]);

  const handleExportDownload = useCallback(() => {
    const content = generateFormattedExport(exportFormat);
    const mimeType = exportFormat === 'json' ? 'application/json' : 'text/csv;charset=utf-8;';
    const ext = exportFormat;
    const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `cerberus04_battery_telemetry_${exportScope}_${nowStr}.${ext}`;

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (telemetry.audioEnabled) {
      audioSynth.playDockingLatch(true);
    }

    const pointsCount = getExportSourcePoints(exportScope).length;
    setExportNotification(`Downloaded ${pointsCount} records (${exportFormat.toUpperCase()} · ${(blob.size / 1024).toFixed(1)} KB)`);
    setTimeout(() => setExportNotification(null), 4000);

    if (onLogDiagnosticEvent) {
      onLogDiagnosticEvent({
        severity: 'info',
        subsystem: 'BMS-48V',
        code: 'TELEMETRY_DATASET_EXPORTED',
        message: `Exported ${pointsCount} voltage sag telemetry points as ${exportFormat.toUpperCase()} file: ${filename}.`,
        metric: `Format: ${exportFormat.toUpperCase()} | Points: ${pointsCount}`,
      });
    }
    setIsExportModalOpen(false);
  }, [
    generateFormattedExport,
    exportFormat,
    exportScope,
    telemetry.audioEnabled,
    getExportSourcePoints,
    onLogDiagnosticEvent,
  ]);

  const handleCopyClipboard = useCallback(async () => {
    const content = generateFormattedExport(exportFormat);
    try {
      await navigator.clipboard.writeText(content);
      setHasCopied(true);
      if (telemetry.audioEnabled) {
        audioSynth.playDockingLatch(true);
      }
      const pointsCount = getExportSourcePoints(exportScope).length;
      setExportNotification(`Copied ${pointsCount} records (${exportFormat.toUpperCase()}) to clipboard!`);
      setTimeout(() => {
        setHasCopied(false);
        setExportNotification(null);
      }, 3500);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  }, [generateFormattedExport, exportFormat, exportScope, telemetry.audioEnabled, getExportSourcePoints]);

  // Preview snippet for modal
  const previewSnippet = useMemo(() => {
    const full = generateFormattedExport(exportFormat);
    const lines = full.split(/\r?\n/);
    const previewLines = lines.slice(0, 16);
    if (lines.length > 16) {
      previewLines.push(`... [${lines.length - 16} additional lines truncated for preview]`);
    }
    return previewLines.join('\n');
  }, [generateFormattedExport, exportFormat]);

  // SVG Chart Geometry Calculations
  const svgW = 1000;
  const svgH = viewMode === 'dual' ? 440 : 320;
  const pad = { top: 32, right: 70, bottom: 42, left: 65 };

  // Track Dimensions
  const plotW = svgW - pad.left - pad.right;
  const vTrackH = viewMode === 'dual' ? 220 : svgH - pad.top - pad.bottom;
  const tTrackH = viewMode === 'dual' ? 110 : 0;
  const trackGap = 36;
  const tTrackTop = pad.top + vTrackH + trackGap;

  // Scales & Bounds for Voltage (39.5V to 51.5V)
  const vMin = 39.5;
  const vMax = 51.5;
  const vRange = vMax - vMin;

  // Scales for Torque (0 to 190 N·m)
  const tMax = 190;

  // Time bounds with predictive projection horizon
  const latestTime = visiblePoints.length > 0 ? visiblePoints[visiblePoints.length - 1].timeSec : 60;
  const earliestTime = Math.max(0, latestTime - timeWindowSec);
  const chartEndTime = showPredictiveForecast ? latestTime + forecastHorizonSec : latestTime;
  const timeSpan = Math.max(1, chartEndTime - earliestTime);

  const getX = useCallback(
    (t: number) => {
      const norm = (t - earliestTime) / timeSpan;
      return pad.left + Math.max(0, Math.min(1, norm)) * plotW;
    },
    [earliestTime, timeSpan, pad.left, plotW]
  );

  // Time grid ticks spanning history and predictive horizon
  const timeGridTicks = useMemo(() => {
    const ticks: Array<{ timeSec: number; label: string; isNow: boolean; isFuture: boolean }> = [];
    const pastDuration = latestTime - earliestTime;
    if (pastDuration > 0) {
      const pastSteps = showPredictiveForecast ? 3 : 4;
      for (let i = 0; i < pastSteps; i++) {
        const t = earliestTime + (i / pastSteps) * pastDuration;
        const offset = -(latestTime - t);
        ticks.push({
          timeSec: t,
          label: `${offset.toFixed(0)}s`,
          isNow: false,
          isFuture: false,
        });
      }
    }

    // Datum Line (Live Now)
    ticks.push({
      timeSec: latestTime,
      label: 'LIVE NOW',
      isNow: true,
      isFuture: false,
    });

    // Future Forecast ticks
    if (showPredictiveForecast && forecastHorizonSec > 0) {
      const futureSteps = forecastHorizonSec >= 60 ? 3 : 2;
      for (let i = 1; i <= futureSteps; i++) {
        const offset = (forecastHorizonSec / futureSteps) * i;
        const t = latestTime + offset;
        ticks.push({
          timeSec: t,
          label: `+${offset.toFixed(0)}s`,
          isNow: false,
          isFuture: true,
        });
      }
    }

    return ticks;
  }, [earliestTime, latestTime, showPredictiveForecast, forecastHorizonSec]);

  const getVoltageY = useCallback(
    (v: number) => {
      const norm = (v - vMin) / vRange;
      return pad.top + (1 - Math.max(0, Math.min(1, norm))) * vTrackH;
    },
    [vMin, vRange, pad.top, vTrackH]
  );

  const getTorqueY = useCallback(
    (trq: number) => {
      const norm = trq / tMax;
      return tTrackTop + (1 - Math.max(0, Math.min(1, norm))) * tTrackH;
    },
    [tMax, tTrackTop, tTrackH]
  );

  // Generate SVG Path String for Terminal Voltage
  const voltagePathD = useMemo(() => {
    if (visiblePoints.length < 2) return '';
    return visiblePoints.reduce((acc, pt, i) => {
      const x = getX(pt.timeSec).toFixed(1);
      const y = getVoltageY(pt.voltage).toFixed(1);
      return `${acc} ${i === 0 ? 'M' : 'L'} ${x},${y}`;
    }, '');
  }, [visiblePoints, getX, getVoltageY]);

  // Generate SVG Path String for Vocv Baseline
  const vocvPathD = useMemo(() => {
    if (visiblePoints.length < 2) return '';
    return visiblePoints.reduce((acc, pt, i) => {
      const x = getX(pt.timeSec).toFixed(1);
      const y = getVoltageY(pt.nominalVocv).toFixed(1);
      return `${acc} ${i === 0 ? 'M' : 'L'} ${x},${y}`;
    }, '');
  }, [visiblePoints, getX, getVoltageY]);

  // Generate Voltage Shading Fill Area (Sag Delta Fill)
  const sagAreaD = useMemo(() => {
    if (visiblePoints.length < 2) return '';
    // Forward along Vocv, then backward along terminal voltage
    const topForward = visiblePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(p.timeSec).toFixed(1)},${getVoltageY(p.nominalVocv).toFixed(1)}`)
      .join(' ');
    const bottomBackward = [...visiblePoints]
      .reverse()
      .map((p) => `L ${getX(p.timeSec).toFixed(1)},${getVoltageY(p.voltage).toFixed(1)}`)
      .join(' ');
    return `${topForward} ${bottomBackward} Z`;
  }, [visiblePoints, getX, getVoltageY]);

  // Generate Torque Path & Fill
  const torquePathD = useMemo(() => {
    if (visiblePoints.length < 2 || viewMode === 'voltage_only') return '';
    return visiblePoints.reduce((acc, pt, i) => {
      const x = getX(pt.timeSec).toFixed(1);
      const y = getTorqueY(pt.torqueNm).toFixed(1);
      return `${acc} ${i === 0 ? 'M' : 'L'} ${x},${y}`;
    }, '');
  }, [visiblePoints, getX, getTorqueY, viewMode]);

  const torqueAreaD = useMemo(() => {
    if (visiblePoints.length < 2 || viewMode === 'voltage_only') return '';
    const baseY = (tTrackTop + tTrackH).toFixed(1);
    const startX = getX(visiblePoints[0].timeSec).toFixed(1);
    const endX = getX(visiblePoints[visiblePoints.length - 1].timeSec).toFixed(1);
    return `${torquePathD} L ${endX},${baseY} L ${startX},${baseY} Z`;
  }, [torquePathD, visiblePoints, getX, tTrackTop, tTrackH, viewMode]);

  // Predictive Forecast SVG Paths (Dashed Projection Line & Variance Envelope)
  const forecastPathD = useMemo(() => {
    if (!showPredictiveForecast || powerTrendData.forecastPoints.length < 2) return '';
    return powerTrendData.forecastPoints.reduce((acc, pt, i) => {
      const x = getX(pt.timeSec).toFixed(1);
      const y = getVoltageY(pt.voltage).toFixed(1);
      return `${acc} ${i === 0 ? 'M' : 'L'} ${x},${y}`;
    }, '');
  }, [showPredictiveForecast, powerTrendData.forecastPoints, getX, getVoltageY]);

  const forecastUpperPathD = useMemo(() => {
    if (!showPredictiveForecast || powerTrendData.forecastPoints.length < 2) return '';
    return powerTrendData.forecastPoints.reduce((acc, pt, i) => {
      const x = getX(pt.timeSec).toFixed(1);
      const y = getVoltageY(pt.upperVoltage).toFixed(1);
      return `${acc} ${i === 0 ? 'M' : 'L'} ${x},${y}`;
    }, '');
  }, [showPredictiveForecast, powerTrendData.forecastPoints, getX, getVoltageY]);

  const forecastLowerPathD = useMemo(() => {
    if (!showPredictiveForecast || powerTrendData.forecastPoints.length < 2) return '';
    return powerTrendData.forecastPoints.reduce((acc, pt, i) => {
      const x = getX(pt.timeSec).toFixed(1);
      const y = getVoltageY(pt.lowerVoltage).toFixed(1);
      return `${acc} ${i === 0 ? 'M' : 'L'} ${x},${y}`;
    }, '');
  }, [showPredictiveForecast, powerTrendData.forecastPoints, getX, getVoltageY]);

  const forecastConeD = useMemo(() => {
    if (!showPredictiveForecast || powerTrendData.forecastPoints.length < 2) return '';
    const pts = powerTrendData.forecastPoints;
    const topForward = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(p.timeSec).toFixed(1)},${getVoltageY(p.upperVoltage).toFixed(1)}`)
      .join(' ');
    const bottomBackward = [...pts]
      .reverse()
      .map((p) => `L ${getX(p.timeSec).toFixed(1)},${getVoltageY(p.lowerVoltage).toFixed(1)}`)
      .join(' ');
    return `${topForward} ${bottomBackward} Z`;
  }, [showPredictiveForecast, powerTrendData.forecastPoints, getX, getVoltageY]);

  const forecastTorquePathD = useMemo(() => {
    if (!showPredictiveForecast || viewMode === 'voltage_only' || powerTrendData.forecastPoints.length < 2) return '';
    const trendTrq = Math.max(12, Math.min(180, (powerTrendData.trendPowerWatts - 90) / 4.2));
    const startX = getX(latestTime).toFixed(1);
    const endX = getX(chartEndTime).toFixed(1);
    const lastTrq = visiblePoints.length > 0 ? visiblePoints[visiblePoints.length - 1].torqueNm : trendTrq;
    return `M ${startX},${getTorqueY(lastTrq).toFixed(1)} L ${endX},${getTorqueY(trendTrq).toFixed(1)}`;
  }, [showPredictiveForecast, viewMode, powerTrendData, latestTime, chartEndTime, getX, getTorqueY, visiblePoints]);

  // Mouse Move Handler for Scrubber (Past Data & Forecast Horizon)
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - svgRect.left;
    const relX = (clientX / svgRect.width) * svgW;

    if (relX < pad.left || relX > pad.left + plotW || visiblePoints.length === 0) {
      setHoveredIndex(null);
      setHoveredForecastIndex(null);
      setCursorPos(null);
      return;
    }

    const relTime = earliestTime + ((relX - pad.left) / plotW) * timeSpan;

    if (relTime <= latestTime || !showPredictiveForecast) {
      // Historical live data point scrub
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < visiblePoints.length; i++) {
        const diff = Math.abs(visiblePoints[i].timeSec - relTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }

      setHoveredIndex(closestIdx);
      setHoveredForecastIndex(null);
      setCursorPos({ x: getX(visiblePoints[closestIdx].timeSec), y: getVoltageY(visiblePoints[closestIdx].voltage) });
    } else {
      // Future predictive forecast scrub
      const fPts = powerTrendData.forecastPoints;
      if (fPts.length > 0) {
        let closestFIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < fPts.length; i++) {
          const diff = Math.abs(fPts[i].timeSec - relTime);
          if (diff < minDiff) {
            minDiff = diff;
            closestFIdx = i;
          }
        }
        setHoveredIndex(null);
        setHoveredForecastIndex(closestFIdx);
        setCursorPos({ x: getX(fPts[closestFIdx].timeSec), y: getVoltageY(fPts[closestFIdx].voltage) });
      }
    }
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setHoveredForecastIndex(null);
    setCursorPos(null);
  };

  const hoveredPoint = hoveredIndex !== null && visiblePoints[hoveredIndex] ? visiblePoints[hoveredIndex] : null;
  const hoveredForecastPoint = hoveredForecastIndex !== null && powerTrendData.forecastPoints[hoveredForecastIndex] ? powerTrendData.forecastPoints[hoveredForecastIndex] : null;

  // Visible events in current window
  const visibleEvents = useMemo(() => {
    return sagEvents.filter((ev) => ev.timeSec >= earliestTime && ev.timeSec <= latestTime);
  }, [sagEvents, earliestTime, latestTime]);

  return (
    <div
      className={`border rounded-xl p-5 sm:p-6 shadow-2xl space-y-6 relative overflow-hidden transition-all duration-500 ${
        isVoltageCritical
          ? 'bg-[#0f070c] border-rose-500 ring-2 ring-rose-500/70 shadow-[0_0_60px_rgba(244,63,94,0.38)]'
          : 'bg-[#080d1a] border-cyan-800/60'
      }`}
    >
      {/* Background ambient glow - shifts to pulsating emergency crimson when < 42V */}
      {isVoltageCritical ? (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,_rgba(244,63,94,0.24)_0%,_rgba(15,23,42,0)_75%)] animate-pulse pointer-events-none z-0" />
      ) : (
        <>
          <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
        </>
      )}

      {/* Embedded Keyframes for Smooth Hardware-Accelerated Chart Pulse */}
      <style>{`
        @keyframes chartCriticalBreathing {
          0%, 100% {
            opacity: 0.95;
            filter: drop-shadow(0 0 16px rgba(244, 63, 94, 0.45));
          }
          50% {
            opacity: 0.40;
            filter: drop-shadow(0 0 4px rgba(244, 63, 94, 0.15));
          }
        }
        .animate-critical-pulse {
          animation: chartCriticalBreathing 1.75s ease-in-out infinite;
        }
      `}</style>

      {/* Header Bar */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800/80 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>48V Pack Impedance & Discharge Dynamics</span>
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold tracking-wide uppercase border ${
              isVoltageCritical
                ? 'bg-rose-950 text-rose-300 border-rose-500 animate-pulse'
                : 'bg-amber-950/80 text-amber-300 border-amber-600/70'
            }`}>
              {isVoltageCritical ? '⚠️ UNDER-VOLTAGE CRITICAL (<42V)' : 'HIGH-TORQUE SAG DETECTOR'}
            </span>
          </div>
          <h3 className="font-['Chakra_Petch'] text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            BATTERY DISCHARGE & HIGH-TORQUE VOLTAGE SAG ANALYZER
          </h3>
          <p className="text-xs text-slate-400 font-mono mt-1">
            Visualizes real-time terminal voltage drop (IR ohmic droop & polarization sag) during intensive joint torque surges, power burst climbing, and ballistic acceleration maneuvers.
          </p>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Simulation Toggle: Instant <42V Critical Sag Test */}
          <button
            onClick={() => {
              if (simulatedCriticalDrop || isVoltageCritical) {
                handleEmergencyLoadShed();
              } else {
                setSimulatedCriticalDrop(true);
                updateTelemetry({
                  voltage: 41.22,
                  totalTorqueOutput: 185.0,
                  current: 21.5,
                  power: 885,
                });
                if (telemetry.audioEnabled) {
                  audioSynth.playAlert(true);
                }
              }
            }}
            className={`px-3 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-all ${
              isVoltageCritical
                ? 'bg-rose-600 hover:bg-rose-500 border-rose-400 text-white font-bold shadow-lg shadow-rose-900/60 animate-pulse'
                : 'bg-slate-900 hover:bg-slate-800 border-rose-800/80 text-rose-300 hover:text-white'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>{isVoltageCritical ? 'RESET 48V (RESTORE NOMINAL)' : '⚡ SIMULATE <42V CRITICAL SAG'}</span>
          </button>

          {/* Play/Pause */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-all ${
              isPaused
                ? 'bg-amber-950/80 border-amber-600 text-amber-300'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-cyan-300'
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 text-amber-400" /> : <Pause className="w-3.5 h-3.5 text-cyan-400" />}
            <span>{isPaused ? 'RESUME STREAM' : 'PAUSE'}</span>
          </button>

          {/* Time Window Selector */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            {[
              { sec: 30, label: '30s' },
              { sec: 60, label: '60s' },
              { sec: 120, label: '2m' },
              { sec: 300, label: '5m' },
            ].map((tw) => (
              <button
                key={tw.sec}
                onClick={() => setTimeWindowSec(tw.sec)}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  timeWindowSec === tw.sec
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tw.label}
              </button>
            ))}
          </div>

          {/* View Mode */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setViewMode('dual')}
              className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                viewMode === 'dual' ? 'bg-slate-800 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              V + Torque
            </button>
            <button
              onClick={() => setViewMode('voltage_only')}
              className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                viewMode === 'voltage_only' ? 'bg-slate-800 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              V Only
            </button>
          </div>

          {/* Export Telemetry Dataset Button */}
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="px-3 py-1.5 rounded-lg border border-cyan-500/60 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-200 text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-all shadow-sm group hover:scale-[1.02]"
            title="Export recorded telemetry dataset as structured JSON or CSV"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform" />
            <span className="font-bold">EXPORT DATASET</span>
          </button>

          {/* Export Toast Notification */}
          {exportNotification && (
            <div className="flex items-center gap-1.5 text-xs font-mono px-3 py-1 rounded-lg bg-emerald-950/90 border border-emerald-500/80 text-emerald-300 animate-pulse shadow-md">
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>{exportNotification}</span>
            </div>
          )}
        </div>
      </div>

      {/* 6 Analytical KPI Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Metric 1: Terminal Voltage & Active Sag */}
        <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
            <span>Terminal Pack Voltage</span>
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={`text-2xl font-bold font-mono tabular-nums ${
                stats.currentSag >= 2.0
                  ? 'text-rose-400 animate-pulse'
                  : stats.currentSag >= 1.0
                  ? 'text-amber-300'
                  : 'text-cyan-300'
              }`}
            >
              {stats.currentV.toFixed(2)}
            </span>
            <span className="text-xs font-mono text-slate-400">V</span>
            <span
              className={`text-[10px] font-mono ml-auto px-1.5 py-0.2 rounded border font-semibold ${
                stats.currentSag >= 2.0
                  ? 'bg-rose-950/80 text-rose-300 border-rose-600'
                  : stats.currentSag >= 1.0
                  ? 'bg-amber-950/80 text-amber-300 border-amber-600'
                  : 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
              }`}
            >
              {stats.currentSag >= 2.0 ? 'SEVERE SAG' : stats.currentSag >= 1.0 ? 'SAG ACTIVE' : 'NOMINAL'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1 flex justify-between">
            <span>Vocv: {stats.vocv.toFixed(2)}V</span>
            <span className={stats.currentSag >= 1.0 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
              ΔV: -{stats.currentSag.toFixed(2)}V
            </span>
          </div>
        </div>

        {/* Metric 2: Peak Voltage Sag Recorded */}
        <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
            <span>Max Voltage Sag (ΔV)</span>
            <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-rose-400 tabular-nums">
              -{stats.maxSag.toFixed(2)}
            </span>
            <span className="text-xs font-mono text-slate-400">V</span>
            <span className="text-[10px] font-mono text-slate-500 ml-auto">
              Min: {stats.minVoltage.toFixed(1)}V
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1">
            Window Avg Sag: <strong className="text-slate-200">-{stats.avgSag.toFixed(2)}V</strong>
          </div>
        </div>

        {/* Metric 3: Internal Resistance (R_int) */}
        <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
            <span>Pack Internal Impedance</span>
            <Gauge className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-amber-300 tabular-nums">
              {stats.rIntEstMo.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-slate-400">mΩ</span>
            <span className="text-[10px] font-mono text-emerald-400 ml-auto font-semibold">
              HEALTHY
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1">
            12S Array · ~4.5 mΩ/cell
          </div>
        </div>

        {/* Metric 4: Peak Joint Torque Output */}
        <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
            <span>Peak Joint Torque</span>
            <Flame className="w-3.5 h-3.5 text-orange-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-orange-400 tabular-nums">
              {stats.maxTorque.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-slate-400">N·m</span>
            <span className="text-[10px] font-mono text-slate-500 ml-auto">
              Avg I: {stats.avgCurrent}A
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1">
            {stats.maxTorque > 100 ? '⚡ High-Torque Overdrive' : 'Nominal Closed Loop'}
          </div>
        </div>

        {/* Metric 5: Low-Voltage Cutoff Margin */}
        <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
            <span>BMS Cutoff Margin</span>
            <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={`text-2xl font-bold font-mono tabular-nums ${
                stats.cutoffMarginV <= 2.0
                  ? 'text-rose-400 animate-pulse'
                  : stats.cutoffMarginV <= 3.5
                  ? 'text-amber-300'
                  : 'text-emerald-300'
              }`}
            >
              +{stats.cutoffMarginV.toFixed(2)}
            </span>
            <span className="text-xs font-mono text-slate-400">V</span>
            <span className="text-[10px] font-mono text-slate-500 ml-auto">
              Cutoff: 42.0V
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1">
            {stats.cutoffMarginV > 4 ? 'Optimal Headroom' : 'Low Headroom During Sags'}
          </div>
        </div>

        {/* Metric 6: Predictive Remaining Battery Life & Depletion Trend */}
        <div className="p-3.5 rounded-lg bg-[#0c0a1a] border border-purple-800/70 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-purple-500/10 rounded-full blur-xl pointer-events-none" />
          <div className="text-[10px] font-mono text-purple-300 uppercase flex items-center justify-between">
            <span>Forecasted Battery Life</span>
            <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={`text-2xl font-bold font-mono tabular-nums ${
                powerTrendData.remainingLifeMinutes < 15
                  ? 'text-rose-400 animate-pulse'
                  : powerTrendData.remainingLifeMinutes < 30
                  ? 'text-amber-300'
                  : 'text-purple-300'
              }`}
            >
              {powerTrendData.remainingLifeMinutes >= 60
                ? `${Math.floor(powerTrendData.remainingLifeMinutes / 60)}h ${Math.round(powerTrendData.remainingLifeMinutes % 60)}m`
                : `${powerTrendData.remainingLifeMinutes.toFixed(1)}m`}
            </span>
            <span
              className={`text-[10px] font-mono ml-auto px-1.5 py-0.2 rounded border font-semibold ${
                powerTrendData.remainingLifeMinutes < 15
                  ? 'bg-rose-950/80 text-rose-300 border-rose-600'
                  : powerTrendData.remainingLifeMinutes < 30
                  ? 'bg-amber-950/80 text-amber-300 border-amber-600'
                  : 'bg-purple-950/80 text-purple-300 border-purple-600'
              }`}
            >
              PREDICTION
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-1 flex justify-between">
            <span>Rate: -{powerTrendData.socDepletionRatePerMin}%/m</span>
            <span className="text-purple-300 font-semibold">{powerTrendData.trendPowerWatts}W trend</span>
          </div>
        </div>
      </div>

      {/* Visual Notification: Critical Under-Voltage Cutoff Breach Alert (< 42.0V) */}
      {isVoltageCritical && (
        <div
          role="alert"
          className={`rounded-xl border transition-all duration-300 relative z-20 ${
            isAlertDismissed
              ? 'p-3 bg-rose-950/40 border-rose-800/80 text-rose-200'
              : 'p-4 sm:p-5 bg-gradient-to-r from-red-950/95 via-rose-950/90 to-[#16060c] border-2 border-rose-500 shadow-[0_0_40px_rgba(244,63,94,0.45)] ring-1 ring-rose-400/60'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Alert Indicator & Diagnostics Info */}
            <div className="flex items-center gap-3.5">
              <div className="relative shrink-0">
                <div className="w-11 h-11 rounded-xl bg-rose-600/30 border border-rose-400 flex items-center justify-center animate-pulse">
                  <ShieldAlert className="w-6 h-6 text-rose-300" />
                </div>
                <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-80"></span>
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500"></span>
                </span>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 animate-bounce" />
                    <span>CRITICAL UNDER-VOLTAGE ALERT · CELL DISCHARGE EXHAUSTION</span>
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wide bg-rose-500 text-slate-950 shadow-sm animate-pulse">
                    &lt; {criticalThreshold.toFixed(1)}V BMS CUTOFF
                  </span>
                </div>
                <p className="text-xs font-mono text-rose-100/90 mt-1 max-w-2xl leading-relaxed">
                  Pack terminal voltage has collapsed to <strong className="text-white underline decoration-rose-400 font-bold tabular-nums">{stats.currentV.toFixed(2)}V</strong> (Breach delta: <strong className="text-rose-300 font-bold tabular-nums">-{(criticalThreshold - stats.currentV).toFixed(2)}V</strong> below the {criticalThreshold.toFixed(1)}V safety floor). Imminent BMS Under-Voltage Lockout (UVLO), risk of electrochemical cell reversal, and involuntary actuator torque shutdown.
                </p>
              </div>
            </div>

            {/* Live Numerical Readouts */}
            <div className="flex items-center gap-3 sm:gap-4 bg-black/60 px-3.5 py-2 rounded-lg border border-rose-700/60 font-mono text-xs">
              <div>
                <span className="text-[9px] text-slate-400 uppercase tracking-wide block">Terminal Pack</span>
                <span className="text-lg font-bold text-rose-400 tabular-nums animate-pulse">{stats.currentV.toFixed(2)} V</span>
              </div>
              <div className="w-px h-7 bg-slate-800" />
              <div>
                <span className="text-[9px] text-slate-400 uppercase tracking-wide block">Cell Avg (12S)</span>
                <span className="text-lg font-bold text-amber-300 tabular-nums">{(stats.currentV / 12).toFixed(3)} V</span>
              </div>
              <div className="w-px h-7 bg-slate-800" />
              <div>
                <span className="text-[9px] text-slate-400 uppercase tracking-wide block">Safety Margin</span>
                <span className="text-lg font-bold text-rose-500 tabular-nums">-{(criticalThreshold - stats.currentV).toFixed(2)} V</span>
              </div>
            </div>

            {/* Quick Action Recovery Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleEmergencyLoadShed}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 shadow-lg shadow-rose-900/60 hover:scale-[1.02]"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300" />
                <span>EMERGENCY LOAD SHED (48V)</span>
              </button>

              <button
                onClick={() => setIsAlertDismissed(!isAlertDismissed)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-300 font-mono text-xs cursor-pointer transition-colors"
              >
                {isAlertDismissed ? 'SHOW DETAILS' : 'MINIMIZE'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Predictive Runtime & Discharge Model Ribbon */}
      <div className="bg-gradient-to-r from-purple-950/60 via-slate-900/80 to-[#050813] border border-purple-800/60 rounded-xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-purple-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-purple-200 uppercase tracking-wide">
                PREDICTIVE BATTERY DISCHARGE & RUNTIME PROJECTION
              </span>
              <span className="text-[9px] font-mono px-2 py-0.2 rounded bg-purple-950 border border-purple-500 text-purple-200 font-semibold">
                DASHED FORECAST LINE
              </span>
            </div>
            <p className="text-xs font-mono text-slate-400 mt-0.5">
              Continuously extrapolates terminal voltage decay across the next +{forecastHorizonSec}s using active powertrain draw ({powerTrendData.trendPowerWatts}W) and 12S Li-ion electrochemical OCV curves. Estimated reserve exhaustion at 42.0V cutoff in <strong className="text-purple-300">{powerTrendData.remainingLifeMinutes} minutes</strong>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-[10px] font-mono text-slate-400 uppercase block">Remaining Runtime</span>
            <span className="text-lg sm:text-xl font-bold font-mono text-purple-300 tabular-nums">
              {powerTrendData.remainingLifeMinutes.toFixed(1)} min
            </span>
          </div>
          <div className="text-right pl-3 border-l border-slate-800">
            <span className="text-[10px] font-mono text-slate-400 uppercase block">Forecast T+{forecastHorizonSec}s V</span>
            <span className="text-lg sm:text-xl font-bold font-mono text-cyan-300 tabular-nums">
              {powerTrendData.endForecast ? `${powerTrendData.endForecast.voltage.toFixed(2)} V` : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* Interactive Vector SVG Line Chart */}
      <div className="bg-[#050813] border border-slate-800/90 rounded-xl p-3 sm:p-4 relative">
        {/* Chart Options / Toggles Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-slate-400 pb-2 mb-2 border-b border-slate-800/60">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
              <input
                type="checkbox"
                checked={showVocvBaseline}
                onChange={(e) => setShowVocvBaseline(e.target.checked)}
                className="accent-cyan-400 rounded"
              />
              <span>Vocv Baseline (48.6V)</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
              <input
                type="checkbox"
                checked={showShadingArea}
                onChange={(e) => setShowShadingArea(e.target.checked)}
                className="accent-amber-400 rounded"
              />
              <span>Sag Delta Shading (ΔV)</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
              <input
                type="checkbox"
                checked={showEventMarkers}
                onChange={(e) => setShowEventMarkers(e.target.checked)}
                className="accent-rose-400 rounded"
              />
              <span>Sag Callout Flags</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
              <input
                type="checkbox"
                checked={showPredictiveForecast}
                onChange={(e) => setShowPredictiveForecast(e.target.checked)}
                className="accent-purple-400 rounded"
              />
              <span className="text-purple-300 font-semibold flex items-center gap-1">
                <span className="w-2.5 h-0.5 border-t-2 border-dashed border-purple-400 inline-block" />
                <span>Forecast Horizon ({forecastHorizonSec}s)</span>
              </span>
            </label>

            {showPredictiveForecast && (
              <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-purple-900/60 text-xs font-mono">
                <span className="text-[10px] text-purple-400 font-semibold px-1">Horizon:</span>
                {[
                  { sec: 30, label: '+30s' },
                  { sec: 60, label: '+60s' },
                  { sec: 120, label: '+2m' },
                ].map((h) => (
                  <button
                    key={h.sec}
                    onClick={() => setForecastHorizonSec(h.sec)}
                    className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                      forecastHorizonSec === h.sec
                        ? 'bg-purple-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            )}

            {showPredictiveForecast && (
              <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-purple-900/60 text-xs font-mono">
                <span className="text-[10px] text-purple-400 font-semibold px-1">Trend:</span>
                {[
                  { id: 'live', label: `Live (${powerTrendData.avgRecentPower}W)` },
                  { id: 'surge', label: 'Surge (620W)' },
                  { id: 'eco', label: 'Eco (115W)' },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setForecastModelMode(m.id as any)}
                    className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                      forecastModelMode === m.id
                        ? 'bg-purple-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
              <span className="w-3 h-0.5 bg-cyan-400 inline-block"></span>
              <span>Terminal Voltage (V)</span>
            </span>
            {showPredictiveForecast && (
              <span className="flex items-center gap-1.5 text-purple-300 font-semibold">
                <span className="w-3.5 h-0.5 border-t-2 border-dashed border-purple-400 inline-block"></span>
                <span>Forecasted Discharge ({powerTrendData.trendPowerWatts}W)</span>
              </span>
            )}
            {viewMode === 'dual' && (
              <span className="flex items-center gap-1.5 text-amber-400 font-semibold">
                <span className="w-3 h-0.5 bg-amber-400 inline-block"></span>
                <span>Joint Torque (N·m)</span>
              </span>
            )}
            <span className="flex items-center gap-1.5 text-rose-400">
              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block animate-ping"></span>
              <span>Voltage Sag Events</span>
            </span>
          </div>
        </div>

        {/* SVG Viewport with Pulsing Background in Critical State */}
        <div
          className={`relative w-full overflow-hidden select-none rounded-xl border transition-all duration-500 ${
            isVoltageCritical
              ? 'border-rose-500 ring-2 ring-rose-500/70 bg-[#14060c] shadow-[0_0_50px_rgba(244,63,94,0.35)]'
              : 'border-slate-800/80 bg-[#040711]'
          }`}
        >
          {/* Pulsing Hazard Gradient Overlay on Chart Viewport Background */}
          {isVoltageCritical && (
            <div className="absolute inset-0 bg-gradient-to-b from-rose-950/65 via-red-950/30 to-rose-950/70 animate-pulse pointer-events-none z-0" />
          )}

          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="w-full h-auto cursor-crosshair relative z-10"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              {/* Sag Gradient Fill */}
              <linearGradient id="sagFillGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.15" />
              </linearGradient>

              {/* Torque Gradient Fill */}
              <linearGradient id="torqueFillGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.03" />
              </linearGradient>

              {/* Voltage Glow Filter */}
              <filter id="voltageGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              {/* Critical Cutoff Line Glow Filter */}
              <filter id="criticalLineGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              {/* Critical Under-Voltage Background Pulse Gradient */}
              <linearGradient id="criticalPulseBgGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.36" />
                <stop offset="50%" stopColor="#dc2626" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#881337" stopOpacity="0.42" />
              </linearGradient>

              {/* Forecast Projection Glow Filter */}
              <filter id="forecastGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              {/* Forecast Confidence Cone Gradient */}
              <linearGradient id="forecastConeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c084fc" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.05" />
              </linearGradient>

              {/* Forecast Horizon Background Region Gradient */}
              <linearGradient id="forecastRegionGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.10" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* SVG Background Layer: Critical Under-Voltage Pulse Effect & Warning Overlay */}
            {isVoltageCritical && (
              <g pointerEvents="none">
                {/* Full plot background pulse fill */}
                <rect
                  x={pad.left}
                  y={pad.top}
                  width={plotW}
                  height={vTrackH}
                  fill="url(#criticalPulseBgGrad)"
                  className="animate-critical-pulse"
                />

                {/* Highlighted Critical Breach Sub-Zone Below Cutoff Floor */}
                <rect
                  x={pad.left}
                  y={getVoltageY(criticalThreshold)}
                  width={plotW}
                  height={Math.max(0, pad.top + vTrackH - getVoltageY(criticalThreshold))}
                  fill="#f43f5e"
                  fillOpacity="0.25"
                  className="animate-pulse"
                />

                {/* SVG In-Canvas Critical Under-Voltage Alert Strip */}
                <rect
                  x={pad.left}
                  y={pad.top}
                  width={plotW}
                  height={22}
                  fill="#881337"
                  fillOpacity="0.9"
                  stroke="#f43f5e"
                  strokeWidth="1"
                />
                <text
                  x={pad.left + plotW / 2}
                  y={pad.top + 15}
                  fill="#ffe4e6"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                  className="animate-pulse"
                >
                  ⚠️ UNDER-VOLTAGE CRITICAL BREACH: {stats.currentV.toFixed(2)}V &lt; {criticalThreshold.toFixed(1)}V CUTOFF FLOOR — BMS UVLO SHUTDOWN RISK
                </text>
              </g>
            )}

            {/* Grid Lines - Voltage Track */}
            {[40.0, 42.0, 44.0, 46.0, 48.0, 50.0].map((v) => {
              const y = getVoltageY(v);
              const isCutoff = v === 42.0;
              const isWarning = v === 44.0;
              return (
                <g key={v}>
                  <line
                    x1={pad.left}
                    y1={y}
                    x2={pad.left + plotW}
                    y2={y}
                    stroke={
                      isCutoff && isVoltageCritical
                        ? '#ff2247'
                        : isCutoff
                        ? '#f43f5e'
                        : isWarning
                        ? '#f59e0b'
                        : '#1e293b'
                    }
                    strokeDasharray={isCutoff && isVoltageCritical ? '6 3' : isCutoff || isWarning ? '4 4' : undefined}
                    strokeWidth={isCutoff && isVoltageCritical ? 2.5 : isCutoff ? 1.6 : 1}
                    opacity={isCutoff && isVoltageCritical ? 1 : isCutoff ? 0.85 : isWarning ? 0.6 : 0.7}
                    filter={isCutoff && isVoltageCritical ? 'url(#criticalLineGlow)' : undefined}
                    className={isCutoff && isVoltageCritical ? 'animate-pulse' : undefined}
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 3.5}
                    fill={isCutoff && isVoltageCritical ? '#ff2247' : isCutoff ? '#f43f5e' : isWarning ? '#f59e0b' : '#64748b'}
                    fontSize="9.5"
                    fontFamily="monospace"
                    textAnchor="end"
                    fontWeight={isCutoff || isWarning ? 'bold' : 'normal'}
                  >
                    {v.toFixed(1)}V
                  </text>
                  {isCutoff && (
                    <text
                      x={pad.left + 6}
                      y={y - 4}
                      fill={isVoltageCritical ? '#ff3b5c' : '#f43f5e'}
                      fontSize="8.5"
                      fontFamily="monospace"
                      fontWeight="bold"
                      className={isVoltageCritical ? 'animate-pulse' : undefined}
                    >
                      {isVoltageCritical
                        ? `🚨 BMS CRITICAL CUTOFF VIOLATION (${stats.currentV.toFixed(2)}V < ${criticalThreshold.toFixed(1)}V)`
                        : `BMS CRITICAL CUTOFF (${criticalThreshold.toFixed(1)}V)`}
                    </text>
                  )}
                  {isWarning && (
                    <text
                      x={pad.left + 6}
                      y={y - 4}
                      fill="#f59e0b"
                      fontSize="8"
                      fontFamily="monospace"
                    >
                      SAG WARNING THRESHOLD (44.0V)
                    </text>
                  )}
                </g>
              );
            })}

            {/* Predictive Forecast Region Background Shading */}
            {showPredictiveForecast && (
              <g pointerEvents="none">
                <rect
                  x={getX(latestTime)}
                  y={pad.top}
                  width={Math.max(0, pad.left + plotW - getX(latestTime))}
                  height={vTrackH}
                  fill="url(#forecastRegionGrad)"
                />
                {viewMode === 'dual' && (
                  <rect
                    x={getX(latestTime)}
                    y={tTrackTop}
                    width={Math.max(0, pad.left + plotW - getX(latestTime))}
                    height={tTrackH}
                    fill="url(#forecastRegionGrad)"
                  />
                )}
              </g>
            )}

            {/* Time Grid Vertical Lines */}
            {timeGridTicks.map((tick) => {
              const x = getX(tick.timeSec);
              const isNow = tick.isNow;
              const isFuture = tick.isFuture;
              return (
                <g key={tick.label + tick.timeSec}>
                  <line
                    x1={x}
                    y1={pad.top}
                    x2={x}
                    y2={pad.top + vTrackH}
                    stroke={isNow ? '#22d3ee' : isFuture ? '#a855f7' : '#1e293b'}
                    strokeDasharray={isNow ? '3 3' : isFuture ? '2 4' : '2 4'}
                    strokeWidth={isNow ? 1.5 : 1}
                    opacity={isNow ? 0.9 : isFuture ? 0.5 : 0.6}
                  />
                  {viewMode === 'dual' && (
                    <line
                      x1={x}
                      y1={tTrackTop}
                      x2={x}
                      y2={tTrackTop + tTrackH}
                      stroke={isNow ? '#22d3ee' : isFuture ? '#a855f7' : '#1e293b'}
                      strokeDasharray={isNow ? '3 3' : isFuture ? '2 4' : '2 4'}
                      strokeWidth={isNow ? 1.5 : 1}
                      opacity={isNow ? 0.9 : isFuture ? 0.5 : 0.6}
                    />
                  )}
                  <text
                    x={x}
                    y={viewMode === 'dual' ? tTrackTop + tTrackH + 16 : pad.top + vTrackH + 16}
                    fill={isNow ? '#22d3ee' : isFuture ? '#c084fc' : '#64748b'}
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="middle"
                    fontWeight={isNow ? 'bold' : 'normal'}
                  >
                    {tick.label}
                  </text>
                </g>
              );
            })}

            {/* Live Datum Tag & Forecast Header */}
            {showPredictiveForecast && (
              <g pointerEvents="none">
                {/* Live Datum Tag */}
                <rect
                  x={getX(latestTime) - 34}
                  y={pad.top - 17}
                  width={68}
                  height={14}
                  rx={3}
                  fill="#082f49"
                  stroke="#06b6d4"
                  strokeWidth="1"
                />
                <text
                  x={getX(latestTime)}
                  y={pad.top - 7}
                  fill="#22d3ee"
                  fontSize="7.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  LIVE (T=0)
                </text>

                {/* Forecast Zone Header */}
                <text
                  x={getX(latestTime) + 8}
                  y={pad.top + 13}
                  fill="#c084fc"
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  🔮 FORECAST (+{forecastHorizonSec}s) · REMAINING: {powerTrendData.remainingLifeMinutes.toFixed(1)}m
                </text>
              </g>
            )}

            {/* Sag Delta Shaded Area (between Vocv and Terminal Voltage) */}
            {showShadingArea && sagAreaD && (
              <path d={sagAreaD} fill="url(#sagFillGrad)" />
            )}

            {/* Vocv Baseline Dashed Line */}
            {showVocvBaseline && vocvPathD && (
              <path
                d={vocvPathD}
                fill="none"
                stroke="#64748b"
                strokeDasharray="4 4"
                strokeWidth="1.5"
                opacity="0.75"
              />
            )}

            {/* Primary Terminal Voltage Curve */}
            {voltagePathD && (
              <path
                d={voltagePathD}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#voltageGlow)"
              />
            )}

            {/* PREDICTIVE PROJECTION LINE - Forecasted Battery Discharge (Dashed Stroke) */}
            {showPredictiveForecast && forecastPathD && (
              <g>
                {/* Forecast Confidence Variance Cone */}
                {forecastConeD && (
                  <path d={forecastConeD} fill="url(#forecastConeGrad)" opacity="0.45" />
                )}

                {/* Upper Bound Forecast Dashed Stroke */}
                {forecastUpperPathD && (
                  <path
                    d={forecastUpperPathD}
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                    opacity="0.45"
                  />
                )}

                {/* Lower Bound Forecast Dashed Stroke */}
                {forecastLowerPathD && (
                  <path
                    d={forecastLowerPathD}
                    fill="none"
                    stroke="#f472b6"
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                    opacity="0.45"
                  />
                )}

                {/* Main Forecasted Terminal Voltage Discharge Curve (Dashed Stroke) */}
                <path
                  d={forecastPathD}
                  fill="none"
                  stroke="#c084fc"
                  strokeWidth="2.6"
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#forecastGlow)"
                />

                {/* End-of-Horizon Forecast Target Pin */}
                {powerTrendData.endForecast && (
                  <g>
                    <circle
                      cx={getX(powerTrendData.endForecast.timeSec)}
                      cy={getVoltageY(powerTrendData.endForecast.voltage)}
                      r="4.5"
                      fill="#c084fc"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                    <rect
                      x={Math.min(pad.left + plotW - 74, getX(powerTrendData.endForecast.timeSec) - 68)}
                      y={Math.max(pad.top + 2, getVoltageY(powerTrendData.endForecast.voltage) - 22)}
                      width={70}
                      height={16}
                      rx={3}
                      fill="#1e1b4b"
                      stroke="#c084fc"
                      strokeWidth="1"
                      opacity="0.95"
                    />
                    <text
                      x={Math.min(pad.left + plotW - 74, getX(powerTrendData.endForecast.timeSec) - 68) + 35}
                      y={Math.max(pad.top + 2, getVoltageY(powerTrendData.endForecast.voltage) - 22) + 11}
                      fill="#e9d5ff"
                      fontSize="8"
                      fontFamily="monospace"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {powerTrendData.endForecast.voltage.toFixed(2)}V ({powerTrendData.endForecast.socPercent}%)
                    </text>
                  </g>
                )}
              </g>
            )}

            {/* SECONDARY TRACK: Synchronized Powertrain Torque (N·m) */}
            {viewMode === 'dual' && (
              <g>
                {/* Track Separator & Title */}
                <line
                  x1={pad.left}
                  y1={pad.top + vTrackH + 18}
                  x2={pad.left + plotW}
                  y2={pad.top + vTrackH + 18}
                  stroke="#334155"
                  strokeWidth="1"
                />
                <text
                  x={pad.left}
                  y={tTrackTop - 8}
                  fill="#f59e0b"
                  fontSize="9.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  SYNCHRONIZED POWERTRAIN JOINT TORQUE (N·m) & INVERTER CURRENT (A)
                </text>

                {/* Torque Grid Lines (0, 50, 100, 150 N·m) */}
                {[0, 50, 100, 150].map((tVal) => {
                  const y = getTorqueY(tVal);
                  return (
                    <g key={tVal}>
                      <line
                        x1={pad.left}
                        y1={y}
                        x2={pad.left + plotW}
                        y2={y}
                        stroke="#1e293b"
                        strokeWidth="1"
                        opacity="0.5"
                      />
                      <text
                        x={pad.left - 8}
                        y={y + 3.5}
                        fill="#64748b"
                        fontSize="8.5"
                        fontFamily="monospace"
                        textAnchor="end"
                      >
                        {tVal} N·m
                      </text>
                    </g>
                  );
                })}

                {/* Power Burst Max Torque Reference Line (172 N·m) */}
                <line
                  x1={pad.left}
                  y1={getTorqueY(172)}
                  x2={pad.left + plotW}
                  y2={getTorqueY(172)}
                  stroke="#f43f5e"
                  strokeDasharray="3 3"
                  strokeWidth="1.2"
                  opacity="0.75"
                />
                <text
                  x={pad.left + plotW - 4}
                  y={getTorqueY(172) - 4}
                  fill="#f43f5e"
                  fontSize="8"
                  fontFamily="monospace"
                  textAnchor="end"
                  fontWeight="bold"
                >
                  POWER BURST CEILING (172.0 N·m)
                </text>

                {/* Torque Filled Area */}
                {torqueAreaD && <path d={torqueAreaD} fill="url(#torqueFillGrad)" />}

                {/* Torque Line */}
                {torquePathD && (
                  <path
                    d={torquePathD}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Secondary Track Torque Forecast Line (Dashed) */}
                {showPredictiveForecast && forecastTorquePathD && (
                  <path
                    d={forecastTorquePathD}
                    fill="none"
                    stroke="#fb923c"
                    strokeWidth="1.8"
                    strokeDasharray="4 3"
                    opacity="0.8"
                  />
                )}
              </g>
            )}

            {/* Sag Event Callout Pins & High-Torque Movement Markers */}
            {showEventMarkers &&
              visibleEvents.map((ev) => {
                const x = getX(ev.timeSec);
                const y = getVoltageY(ev.vTrough);
                const isSelected = selectedEventId === ev.id;
                const isCritical = ev.severity === 'critical';

                return (
                  <g
                    key={ev.id}
                    className="cursor-pointer transition-transform hover:scale-105"
                    onClick={() => setSelectedEventId(ev.id === selectedEventId ? null : ev.id)}
                  >
                    {/* Vertical drop vector pin */}
                    <line
                      x1={x}
                      y1={getVoltageY(ev.vPre)}
                      x2={x}
                      y2={y}
                      stroke={isCritical ? '#f43f5e' : '#f59e0b'}
                      strokeWidth="1.8"
                      strokeDasharray="2 2"
                    />

                    {/* Sag Trough Circle Indicator */}
                    <circle
                      cx={x}
                      cy={y}
                      r={isSelected ? 6 : 4.5}
                      fill={isCritical ? '#f43f5e' : '#f59e0b'}
                      stroke="#ffffff"
                      strokeWidth="1.5"
                      className="animate-pulse"
                    />

                    {/* Event Callout Box */}
                    <rect
                      x={Math.max(pad.left + 5, Math.min(pad.left + plotW - 95, x - 45))}
                      y={Math.max(pad.top + 5, y - 26)}
                      width={90}
                      height={18}
                      rx={3}
                      fill={isSelected ? '#1e1b4b' : 'rgba(15, 23, 42, 0.92)'}
                      stroke={isCritical ? '#f43f5e' : '#f59e0b'}
                      strokeWidth={isSelected ? 1.5 : 1}
                      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))"
                    />

                    <text
                      x={Math.max(pad.left + 5, Math.min(pad.left + plotW - 95, x - 45)) + 45}
                      y={Math.max(pad.top + 5, y - 26) + 12}
                      fill={isCritical ? '#fecdd3' : '#fef08a'}
                      fontSize="8"
                      fontFamily="monospace"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      ⚡ -{ev.vSag.toFixed(2)}V ({ev.peakTorque.toFixed(0)} N·m)
                    </text>
                  </g>
                );
              })}

            {/* Live Hover Crosshair & Data Scrubber Reticle */}
            {cursorPos && (hoveredPoint || hoveredForecastPoint) && (
              <g pointerEvents="none">
                {/* Vertical Reticle Line */}
                <line
                  x1={cursorPos.x}
                  y1={pad.top}
                  x2={cursorPos.x}
                  y2={viewMode === 'dual' ? tTrackTop + tTrackH : pad.top + vTrackH}
                  stroke={hoveredForecastPoint ? '#c084fc' : '#22d3ee'}
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                  opacity="0.85"
                />

                {/* Point Dots on Voltage & Torque */}
                {hoveredPoint && (
                  <circle
                    cx={cursorPos.x}
                    cy={getVoltageY(hoveredPoint.voltage)}
                    r="5"
                    fill="#22d3ee"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                )}

                {hoveredForecastPoint && (
                  <circle
                    cx={cursorPos.x}
                    cy={getVoltageY(hoveredForecastPoint.voltage)}
                    r="5.5"
                    fill="#c084fc"
                    stroke="#ffffff"
                    strokeWidth="2"
                    filter="url(#forecastGlow)"
                  />
                )}

                {viewMode === 'dual' && hoveredPoint && (
                  <circle
                    cx={cursorPos.x}
                    cy={getTorqueY(hoveredPoint.torqueNm)}
                    r="4.5"
                    fill="#f59e0b"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                )}

                {viewMode === 'dual' && hoveredForecastPoint && (
                  <circle
                    cx={cursorPos.x}
                    cy={getTorqueY(Math.max(12, Math.min(180, (hoveredForecastPoint.powerWatts - 90) / 4.2)))}
                    r="4.5"
                    fill="#fb923c"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                )}
              </g>
            )}
          </svg>

          {/* Floating Scrubber HUD Tooltip - Historical Telemetry */}
          {cursorPos && hoveredPoint && (
            <div
              className="absolute pointer-events-none z-30 transition-all duration-75"
              style={{
                left: `${Math.max(10, Math.min(svgW - 240, cursorPos.x - 110))}px`,
                top: `${Math.min(svgH - 120, Math.max(10, cursorPos.y - 70))}px`,
              }}
            >
              <div className="bg-[#0b1226]/95 border border-cyan-500/80 rounded-lg p-2.5 shadow-2xl backdrop-blur-md text-[11px] font-mono space-y-1 w-56">
                <div className="flex items-center justify-between border-b border-slate-700/80 pb-1 text-slate-300">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-cyan-400" />
                    <span>{hoveredPoint.timestamp}</span>
                  </span>
                  <span className="text-[10px] text-slate-400">
                    -{(latestTime - hoveredPoint.timeSec).toFixed(1)}s
                  </span>
                </div>

                <div className="flex justify-between items-center pt-0.5">
                  <span className="text-slate-400">Terminal Voltage:</span>
                  <span className="font-bold text-cyan-300 tabular-nums">
                    {hoveredPoint.voltage.toFixed(2)} V
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Voltage Sag (ΔV):</span>
                  <span
                    className={`font-bold tabular-nums ${
                      hoveredPoint.sagDeltaV >= 2.0
                        ? 'text-rose-400'
                        : hoveredPoint.sagDeltaV >= 1.0
                        ? 'text-amber-400'
                        : 'text-slate-300'
                    }`}
                  >
                    -{hoveredPoint.sagDeltaV.toFixed(2)} V
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Joint Torque Output:</span>
                  <span className="font-bold text-amber-300 tabular-nums">
                    {hoveredPoint.torqueNm.toFixed(1)} N·m
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Inverter Draw:</span>
                  <span className="text-slate-200 tabular-nums">
                    {hoveredPoint.currentAmps.toFixed(1)} A ({hoveredPoint.powerWatts} W)
                  </span>
                </div>

                {hoveredPoint.movementLabel && (
                  <div className="pt-1 border-t border-slate-800 text-[10px] text-amber-300 font-semibold flex items-center gap-1">
                    <Flame className="w-3 h-3 text-rose-400" />
                    <span>{hoveredPoint.movementLabel}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Floating Scrubber HUD Tooltip - Predictive Forecast Projection */}
          {cursorPos && hoveredForecastPoint && (
            <div
              className="absolute pointer-events-none z-30 transition-all duration-75"
              style={{
                left: `${Math.max(10, Math.min(svgW - 250, cursorPos.x - 120))}px`,
                top: `${Math.min(svgH - 140, Math.max(10, cursorPos.y - 75))}px`,
              }}
            >
              <div className="bg-[#0e0c1f]/95 border border-purple-500/80 rounded-lg p-2.5 shadow-2xl backdrop-blur-md text-[11px] font-mono space-y-1 w-60">
                <div className="flex items-center justify-between border-b border-purple-800/80 pb-1 text-purple-200">
                  <span className="flex items-center gap-1 font-bold">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    <span>PREDICTIVE FORECAST</span>
                  </span>
                  <span className="text-[10px] text-purple-300 font-bold bg-purple-950 px-1.5 py-0.2 rounded border border-purple-600">
                    +{hoveredForecastPoint.relForecastSec.toFixed(1)}s
                  </span>
                </div>

                <div className="flex justify-between items-center pt-0.5">
                  <span className="text-slate-400">Forecasted Voltage:</span>
                  <span className="font-bold text-purple-300 tabular-nums flex items-center gap-1">
                    <span className="w-2 h-0.5 border-t border-dashed border-purple-400 inline-block" />
                    {hoveredForecastPoint.voltage.toFixed(2)} V
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Confidence Band:</span>
                  <span className="text-slate-300 tabular-nums text-[10px]">
                    {hoveredForecastPoint.lowerVoltage.toFixed(2)}V – {hoveredForecastPoint.upperVoltage.toFixed(2)}V
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Projected Battery SoC:</span>
                  <span className="font-bold text-cyan-300 tabular-nums">
                    {hoveredForecastPoint.socPercent}%
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Remaining Runtime:</span>
                  <span className="font-bold text-emerald-300 tabular-nums">
                    ~{hoveredForecastPoint.remainingLifeMin.toFixed(1)} min
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Trend Power Draw:</span>
                  <span className="text-amber-300 tabular-nums">
                    {hoveredForecastPoint.powerWatts} W ({forecastModelMode.toUpperCase()})
                  </span>
                </div>

                <div className="pt-1 border-t border-purple-900/60 flex justify-between items-center text-[10px]">
                  <span className="text-slate-400">Headroom to 42.0V Cutoff:</span>
                  <span className="text-emerald-400 font-bold">
                    +{(hoveredForecastPoint.voltage - 42.0).toFixed(2)} V
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Two-Column Lower Console: High-Torque Maneuver Stress Testing & Voltage Sag Event Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: High-Torque Movement Injector & Stress Test Bench */}
        <div className="lg:col-span-6 bg-[#050812] border border-slate-800/80 rounded-xl p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <h4 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider">
                  High-Torque Movement Injector & Sag Stress Testing
                </h4>
              </div>
              <span className="text-[10px] font-mono text-cyan-400 font-semibold">
                HARDWARE HARDENING BENCH
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-2">
              Inject controlled high-torque operational regimes into the powertrain to empirically measure cell internal resistance and test low-voltage cutoff safety margins.
            </p>

            {/* Test Maneuvers Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-4">
              {[
                {
                  id: 'power_burst',
                  name: 'Power Burst Incline Climb',
                  torque: 172.0,
                  current: 18.5,
                  durationMs: 6500,
                  expectedSag: '-3.4V to -3.8V',
                  desc: 'Bypasses gait boundaries for steep climbing wall ascents.',
                  badge: 'MAX TORQUE',
                  color: 'border-rose-600/80 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50',
                },
                {
                  id: 'obstacle_vault',
                  name: 'Dynamic Obstacle Vault',
                  torque: 95.0,
                  current: 14.2,
                  durationMs: 3500,
                  expectedSag: '-1.8V to -2.3V',
                  desc: 'High-thrust launch to clear boulders and elevated ledges.',
                  badge: 'BALLISTIC',
                  color: 'border-orange-600/80 bg-orange-950/40 text-orange-200 hover:bg-orange-900/50',
                },
                {
                  id: 'steep_incline',
                  name: 'Continuous 40° Slope Hold',
                  torque: 75.0,
                  current: 11.8,
                  durationMs: 5000,
                  expectedSag: '-1.4V to -1.7V',
                  desc: 'Sustained anti-gravity holding torque on rock faces.',
                  badge: 'HOLDING',
                  color: 'border-amber-600/80 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50',
                },
                {
                  id: 'sprint_launch',
                  name: 'Gallop Sprint Push-Off',
                  torque: 55.0,
                  current: 9.4,
                  durationMs: 2500,
                  expectedSag: '-0.9V to -1.2V',
                  desc: 'Rapid kinetic acceleration from standstill to 2.4 m/s.',
                  badge: 'TRANSIENT',
                  color: 'border-cyan-600/80 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50',
                },
                {
                  id: 'critical_sag_stall',
                  name: 'Heavy Stall Surge (<42V Critical Sag)',
                  torque: 186.0,
                  current: 22.4,
                  durationMs: 7000,
                  expectedSag: '-7.2V (Dips to 41.2V)',
                  desc: 'Severe multi-joint stall driving pack terminal voltage below the 42.0V BMS cutoff threshold.',
                  badge: 'CRITICAL <42V',
                  color: 'border-rose-500 bg-rose-950/70 text-rose-200 hover:bg-rose-900/80 shadow-md ring-1 ring-rose-500/50',
                },
              ].map((maneuver) => {
                const isRunning = activeManeuver?.name === maneuver.name;
                return (
                  <button
                    key={maneuver.id}
                    onClick={() => triggerHighTorqueManeuver(maneuver)}
                    disabled={activeManeuver !== null}
                    className={`p-3 rounded-lg border text-left cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ${maneuver.color} relative overflow-hidden group`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold font-['Chakra_Petch'] uppercase tracking-wide">
                        {maneuver.name}
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded border bg-black/40 font-semibold">
                        {maneuver.badge}
                      </span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between text-xs font-mono">
                      <span className="text-amber-300 font-bold">{maneuver.torque} N·m</span>
                      <span className="text-slate-400 text-[11px]">{maneuver.current} A draw</span>
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-slate-400 leading-tight">
                      Sag: <strong className="text-rose-300">{maneuver.expectedSag}</strong> · {(maneuver.durationMs / 1000).toFixed(1)}s
                    </div>
                    {isRunning && (
                      <div className="absolute inset-0 bg-rose-600/20 flex items-center justify-center backdrop-blur-xs font-mono text-xs font-bold text-white animate-pulse">
                        MANEUVER ACTIVE: {(activeManeuver.remainingMs / 1000).toFixed(1)}s
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Maneuver Progress Ribbon */}
          {activeManeuver && (
            <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-500 animate-pulse">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-rose-200 font-bold flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-amber-300" />
                  <span>MANEUVER ACTIVE: {activeManeuver.name}</span>
                </span>
                <span className="text-amber-200 font-bold tabular-nums">
                  {(activeManeuver.remainingMs / 1000).toFixed(1)}s remaining
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-rose-500 transition-all duration-100"
                  style={{
                    width: `${(activeManeuver.remainingMs / activeManeuver.durationMs) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Theoretical Physics Formula Note */}
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-slate-200 font-semibold">Ohmic & Polarization Sag Equation:</span>{' '}
              <code className="text-cyan-300">V_terminal = V_ocv - I × R_internal - ΔV_polarization</code>. At 172 N·m joint torque, inverter current reaches 18.5A, producing an instantaneous IR drop of 1.0V plus 2.4V electro-mechanical armature counter-torque droop.
            </div>
          </div>
        </div>

        {/* Right: Voltage Sag Event Log & Diagnostic Inspector */}
        <div className="lg:col-span-6 bg-[#050812] border border-slate-800/80 rounded-xl p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <h4 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider">
                  Voltage Sag Event Ledger ({sagEvents.length} Recorded)
                </h4>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                CLICK TO HIGHLIGHT ON CHART
              </span>
            </div>

            {/* Scrollable Event List */}
            <div className="space-y-2 mt-3 max-h-[300px] overflow-y-auto pr-1">
              {sagEvents.length === 0 ? (
                <div className="py-8 text-center text-xs font-mono text-slate-500">
                  No voltage sag events recorded yet. Trigger a high-torque maneuver above or engage Power Burst in the controller.
                </div>
              ) : (
                sagEvents.map((ev) => {
                  const isSelected = selectedEventId === ev.id;
                  const isCritical = ev.severity === 'critical';
                  return (
                    <div
                      key={ev.id}
                      onClick={() => setSelectedEventId(isSelected ? null : ev.id)}
                      className={`p-3 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-slate-800/90 border-cyan-400 shadow-md ring-1 ring-cyan-500'
                          : isCritical
                          ? 'bg-[#150a0f] border-rose-900/60 hover:border-rose-600'
                          : 'bg-slate-950 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isCritical ? 'bg-rose-500 animate-ping' : 'bg-amber-400'
                            }`}
                          />
                          <span className={isCritical ? 'text-rose-300' : 'text-amber-300'}>
                            {ev.movementName}
                          </span>
                        </div>
                        <span className="text-slate-400 text-[10px] tabular-nums">
                          {ev.timestamp}
                        </span>
                      </div>

                      <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px] text-slate-300">
                        <div>
                          <span className="text-slate-500 text-[10px] block">Sag Depth (ΔV)</span>
                          <span className="font-bold text-rose-400 tabular-nums">
                            -{ev.vSag.toFixed(2)} V
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 text-[10px] block">Peak Torque</span>
                          <span className="font-bold text-amber-300 tabular-nums">
                            {ev.peakTorque.toFixed(1)} N·m
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 text-[10px] block">Impedance R_int</span>
                          <span className="text-cyan-300 tabular-nums">
                            {ev.rIntEstimatedMo.toFixed(1)} mΩ
                          </span>
                        </div>
                      </div>

                      <div className="mt-1 pt-1 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500">
                        <span>
                          V: {ev.vPre.toFixed(2)}V →{' '}
                          <strong className="text-rose-300">{ev.vTrough.toFixed(2)}V</strong>
                        </span>
                        <span>Duration: {ev.durationMs}ms</span>
                        <span className="text-emerald-400">Recovered: 100%</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick Help Footer */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>
              Sag Severity: <strong className="text-amber-400">&gt;0.8V Moderate</strong> ·{' '}
              <strong className="text-rose-400">&gt;2.4V Critical</strong>
            </span>
            <span className="text-cyan-400 font-semibold">
              BMS 1000Hz CAN-FD Stream
            </span>
          </div>
        </div>
      </div>

      {/* Telemetry Dataset Export Modal Dialog */}
      {isExportModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
        >
          <div className="bg-[#090e1a] border border-cyan-500/50 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden font-mono text-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 bg-gradient-to-r from-slate-950 via-[#0a1226] to-[#070b14] border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    EXPORT TELEMETRY DATASET
                    <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700/60 font-mono">
                      {exportFormat.toUpperCase()}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    BMS 48V High-Torque Discharge & Dynamic Voltage Sag Records
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsExportModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 cursor-pointer transition-colors"
                title="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Format Selection */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  1. Choose Export Format
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setExportFormat('json')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      exportFormat === 'json'
                        ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 ring-1 ring-cyan-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-cyan-400" />
                        JSON Format
                      </span>
                      {exportFormat === 'json' && (
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Full structured object: pack metadata, statistics, detected sag incident log, and time-series points.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportFormat('csv')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      exportFormat === 'csv'
                        ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 ring-1 ring-cyan-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-emerald-400" />
                        CSV Table
                      </span>
                      {exportFormat === 'csv' && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Standard comma-separated table for Excel, Google Sheets, Pandas, MATLAB, or Jupyter analysis.
                    </p>
                  </button>
                </div>
              </div>

              {/* Scope Selection */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  2. Select Telemetry Scope
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setExportScope('window')}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      exportScope === 'window'
                        ? 'bg-slate-900 border-cyan-500 text-cyan-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-white text-[11px]">
                      Visible Window ({timeWindowSec}s)
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {visiblePoints.length} points · 250ms sampling
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportScope('all')}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      exportScope === 'all'
                        ? 'bg-slate-900 border-cyan-500 text-cyan-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-white text-[11px]">
                      Full Session Buffer
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {dataPoints.length} points · Total continuous log
                    </div>
                  </button>
                </div>
              </div>

              {/* Optional Dataset Inclusions */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  3. Inclusions & Metadata
                </label>
                <div className="space-y-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={includePredictiveInExport}
                      onChange={(e) => setIncludePredictiveInExport(e.target.checked)}
                      className="accent-cyan-400 rounded"
                    />
                    <span>Include +{forecastHorizonSec}s predictive voltage decay projection points</span>
                  </label>
                  {exportFormat === 'json' && (
                    <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                      <input
                        type="checkbox"
                        checked={includeSagEventsInExport}
                        onChange={(e) => setIncludeSagEventsInExport(e.target.checked)}
                        className="accent-cyan-400 rounded"
                      />
                      <span>Include structured high-torque voltage sag incident logs ({sagEvents.length} events)</span>
                    </label>
                  )}
                </div>
              </div>

              {/* Data Summary Stats Box */}
              <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 text-[11px] grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <span className="text-slate-500 block text-[10px]">Points Count:</span>
                  <span className="font-bold text-white">{getExportSourcePoints(exportScope).length} samples</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Rate:</span>
                  <span className="font-bold text-cyan-300">4.0 Hz (250ms)</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Voltage Span:</span>
                  <span className="font-bold text-amber-300">{stats.minVoltage.toFixed(1)}V - {stats.maxVoltage.toFixed(1)}V</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Est. Payload:</span>
                  <span className="font-bold text-emerald-400">
                    ~{(new Blob([generateFormattedExport(exportFormat)]).size / 1024).toFixed(1)} KB
                  </span>
                </div>
              </div>

              {/* Live Preview Box */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Output Preview ({exportFormat.toUpperCase()}):
                  </span>
                  <span className="text-[10px] text-slate-500">First 16 lines</span>
                </div>
                <pre className="p-3 bg-black/80 rounded-lg border border-slate-800 text-[10px] text-slate-300 font-mono overflow-x-auto max-h-36 leading-relaxed select-all">
                  {previewSnippet}
                </pre>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-mono cursor-pointer transition-colors"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyClipboard}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  {hasCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300 font-bold">COPIED!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>COPY TO CLIPBOARD</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleExportDownload}
                  className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-all shadow-md shadow-cyan-950/60"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>DOWNLOAD {exportFormat.toUpperCase()}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
