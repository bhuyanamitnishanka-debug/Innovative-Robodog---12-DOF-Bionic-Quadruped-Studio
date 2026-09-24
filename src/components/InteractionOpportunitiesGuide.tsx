import React from 'react';
import { Layers, Compass, Zap, Cpu, Radio, ArrowUpRight, CheckCircle2 } from 'lucide-react';

interface InteractionOpportunitiesGuideProps {
  onNavigateTab: (tab: string) => void;
}

export const InteractionOpportunitiesGuide: React.FC<InteractionOpportunitiesGuideProps> = ({
  onNavigateTab,
}) => {
  const opportunities = [
    {
      id: 'kinematics',
      title: '1. 12-DOF Inverse Kinematics & Strain Gauge Tuning',
      videoTimestamp: '00:18 - 00:54',
      targetTab: 'kinematics',
      icon: Layers,
      videoFeature: 'High-torque brushless actuators with planetary gearboxes & strain gauges',
      interactiveOpportunity:
        'Allow users to interactively drag foot effectors, adjust joint angles, and observe real-time torque strain readings and compliance feedback.',
      deepenedExperience:
        'Helps users grasp how 12 independent degrees of freedom distribute ground reaction forces and enable adaptive foot compliance over rough terrain.',
      cta: 'Explore Kinematics Lab',
    },
    {
      id: 'lidar',
      title: '2. 360° LiDAR SLAM Raycasting & Perception Sweep',
      videoTimestamp: '01:35 - 01:50',
      targetTab: 'simulator',
      icon: Compass,
      videoFeature: 'Dual-depth LiDAR scanners and active stereo vision array',
      interactiveOpportunity:
        'Interactive point-cloud sensor sweep allowing users to place autonomous navigational target waypoints on the ground and observe dynamic path planning.',
      deepenedExperience:
        'Visually demonstrates how 400Hz LiDAR sensor fusion transforms raw laser reflections into real-time obstacle avoidance and terrain maps.',
      cta: 'Open Simulator & LiDAR',
    },
    {
      id: 'docking',
      title: '3. PWM Distribution Histogram, Voltage Sag & 80A Docking',
      videoTimestamp: '00:56 - 01:34',
      targetTab: 'electrical',
      icon: Zap,
      videoFeature: '20 kHz SVPWM Inverter Gate Drivers, 48V 15Ah Li-Ion Core & High-Torque Overdrive',
      interactiveOpportunity:
        'Motor controller duty cycle frequency histogram with probability density splines, real-time voltage sag tracking during 172 N·m climb bursts, and automated 80A magnetic docking.',
      deepenedExperience:
        'Reveals inverter gate-driver saturation limits (>85% duty), FOC modulation efficiency, cell internal impedance (mΩ), and low-voltage cutoff safety margins.',
      cta: 'Explore Electrical & PWM Histogram',
    },
    {
      id: 'vla',
      title: '4. Gemini Embedded Vision (VLA) Natural Language Control',
      videoTimestamp: '01:35 - 02:00',
      targetTab: 'vla',
      icon: Cpu,
      videoFeature: 'Gemini Embedded Vision model running on TensorRT INT8 accelerator',
      interactiveOpportunity:
        'Prompt-driven cognitive interface where users type tactical commands ("Crawl under obstacle", "Perform high-speed sprint") and see live gait dispatch.',
      deepenedExperience:
        'Bridges high-level artificial intelligence reasoning with low-level 400Hz brushless motor velocity vectors and safety lockouts.',
      cta: 'Launch Gemini VLA',
    },
    {
      id: 'controller',
      title: '5. Tactile RD-C1 Joystick & Gait Swapping Teleoperation',
      videoTimestamp: '02:01 - 02:37',
      targetTab: 'simulator',
      icon: Radio,
      videoFeature: 'RD-C1 remote with dual-axis Hall-effect sticks and physical gait switches',
      interactiveOpportunity:
        'Virtual Hall effect joystick with drag and keyboard controls (WASD/Arrows), instant trot/bound/pace switching, and stance height sliders.',
      deepenedExperience:
        'Provides visceral tactile feedback on how gait phase offsets directly affect quadruped agility, ground clearance, and battery draw.',
      cta: 'Operate Virtual RD-C1',
    },
  ];

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-6 shadow-xl space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1">
          Video Content Analysis & Interaction Framework
        </div>
        <h2 className="font-['Chakra_Petch'] text-2xl font-bold text-slate-100">
          OPPORTUNITIES FOR INTERACTIVE ANIMATED ENGAGEMENT
        </h2>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
          Comprehensive synthesis of the presentation video's core themes, detailing how each technical segment is mapped directly into hands-on, animated engineering interactions that deepen user understanding.
        </p>
      </div>

      <div className="space-y-4">
        {opportunities.map((opp) => {
          const Icon = opp.icon;
          return (
            <div
              key={opp.id}
              className="bg-[#050811] rounded-lg border border-slate-800/80 p-5 hover:border-cyan-500/50 transition-colors"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-800/60">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-cyan-950/60 border border-cyan-700/60 flex items-center justify-center text-cyan-400 shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-['Chakra_Petch'] text-base font-bold text-slate-100">
                      {opp.title}
                    </h3>
                    <span className="text-[11px] font-mono text-cyan-400">
                      Video Timestamp: {opp.videoTimestamp}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => onNavigateTab(opp.targetTab)}
                  className="px-3.5 py-1.5 rounded bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-600/70 text-xs font-mono text-cyan-200 flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <span>{opp.cta}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 text-xs">
                <div>
                  <span className="text-[10px] font-mono text-slate-500 uppercase block mb-1">
                    Video Feature Highlight:
                  </span>
                  <p className="text-slate-300 leading-relaxed font-medium">
                    {opp.videoFeature}
                  </p>
                </div>

                <div>
                  <span className="text-[10px] font-mono text-cyan-400 uppercase block mb-1">
                    Interactive Animated Element:
                  </span>
                  <p className="text-slate-400 leading-relaxed">
                    {opp.interactiveOpportunity}
                  </p>
                </div>

                <div>
                  <span className="text-[10px] font-mono text-emerald-400 uppercase block mb-1">
                    Deepened Learning Outcome:
                  </span>
                  <p className="text-slate-400 leading-relaxed">
                    {opp.deepenedExperience}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
