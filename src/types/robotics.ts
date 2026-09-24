export type GaitType = 'walk' | 'trot' | 'gallop' | 'creep' | 'pace' | 'bound' | 'crawl' | 'stand';

export type ViewMode = 'bionic' | 'kinematic' | 'electrical' | 'lidar' | 'thermal';

export interface JointState {
  hipAbduction: number; // degrees
  hipPitch: number;     // degrees
  kneePitch: number;    // degrees
  torque: number;       // N·m
  temperature: number;  // °C (overall/average)
  hipRollTemp?: number; // °C (Actuator 1: Abduction/Roll)
  hipPitchTemp?: number;// °C (Actuator 2: Hip Pitch)
  kneePitchTemp?: number;// °C (Actuator 3: Knee Pitch)
}

export interface LegJoints {
  fl: JointState;
  fr: JointState;
  rl: JointState;
  rr: JointState;
}

export interface LidarPoint {
  angle: number;       // radians
  distance: number;    // meters
  intensity: number;
  x: number;
  y: number;
}

export interface TelemetryState {
  // Power & BMS
  voltage: number;         // V
  current: number;         // A
  power: number;           // W
  batteryPercent: number;  // %
  bmsTemp: number;         // °C
  bmsCellVoltages: number[];// 12 cells
  chargingState: 'disconnected' | 'approaching' | 'docked_charging' | 'charged';
  chargeTimeRemainingMin: number;

  // Kinematics & Pose
  gait: GaitType;
  linearVelocity: number;  // m/s
  angularVelocity: number; // rad/s
  strideLength: number;    // mm (e.g. 80 to 480 mm)
  swingFrequency: number;  // Hz (e.g. 0.4 to 4.2 Hz)
  bodyPitch: number;       // degrees
  bodyRoll: number;        // degrees
  stanceHeight: number;    // mm (140 to 280)
  heading: number;         // degrees (0 to 360)
  positionX: number;       // meters
  positionY: number;       // meters
  targetWaypoint: { x: number; y: number } | null;

  // Joint Telemetry
  legs: LegJoints;
  avgMotorTemp: number;
  totalTorqueOutput: number;

  // Perception & Compute
  nearestObstacleDist: number; // meters
  nearestObstacleAngle: number; // degrees
  lidarPoints: LidarPoint[];
  canBusRateHz: number;        // 1000 Hz
  mcuCoreM7Load: number;       // %
  mcuCoreM4Load: number;       // %
  imuUpdateRateHz: number;     // 400 Hz

  // Control State
  emergencyStop: boolean;
  controlMode: 'manual' | 'autonomous_vla' | 'docking';
  viewMode: ViewMode;
  audioEnabled: boolean;
  powerBurstActive?: boolean;
  powerBurstRemainingSec?: number;
}

export interface VLAResponse {
  missionSummary: string;
  recommendedGait: GaitType;
  targetVelocity: {
    linearX: number;
    angularZ: number;
    stanceHeight: number;
  };
  spatialAssessment: string;
  tacticalActions: string[];
  jointTorqueBias: string;
  safetyLockout: boolean;
  _note?: string;
}

export interface SystemSpec {
  category: string;
  name: string;
  value: string;
  detail: string;
}

export type EventSeverity = 'info' | 'warning' | 'critical';

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  relativeTimeMs: number;
  severity: EventSeverity;
  subsystem: 'CAN-FD' | 'BMS-48V' | 'ACTUATORS' | 'IMU-400Hz' | 'LIDAR-SLAM' | 'VLA-CORE' | 'THERMAL';
  code: string;
  message: string;
  metric?: string;
  acknowledged?: boolean;
}
