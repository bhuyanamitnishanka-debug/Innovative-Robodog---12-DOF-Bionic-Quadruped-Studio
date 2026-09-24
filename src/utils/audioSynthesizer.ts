// Web Audio API Procedural Sound Synthesizer for Robotic Telemetry
class AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private servoOsc: OscillatorNode | null = null;
  private servoGain: GainNode | null = null;
  private isServoRunning = false;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setServoWhine(speed: number, enabled: boolean) {
    if (!enabled) {
      this.stopServo();
      return;
    }
    this.initContext();
    if (!this.ctx) return;

    const absSpeed = Math.abs(speed);
    if (absSpeed < 0.05) {
      if (this.servoGain) {
        this.servoGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      }
      return;
    }

    if (!this.isServoRunning) {
      this.servoOsc = this.ctx.createOscillator();
      this.servoGain = this.ctx.createGain();

      this.servoOsc.type = 'sawtooth';
      this.servoOsc.frequency.setValueAtTime(180, this.ctx.currentTime);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(600, this.ctx.currentTime);
      filter.Q.setValueAtTime(3, this.ctx.currentTime);

      this.servoOsc.connect(filter);
      filter.connect(this.servoGain);
      this.servoGain.connect(this.ctx.destination);

      this.servoGain.gain.setValueAtTime(0.015, this.ctx.currentTime);
      this.servoOsc.start();
      this.isServoRunning = true;
    }

    // Dynamic pitch modulation based on speed
    if (this.servoOsc && this.servoGain) {
      const targetFreq = 180 + absSpeed * 160;
      const targetGain = Math.min(0.04, 0.01 + absSpeed * 0.01);
      this.servoOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.08);
      this.servoGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.08);
    }
  }

  public stopServo() {
    if (this.servoOsc && this.isServoRunning) {
      try {
        this.servoOsc.stop();
        this.servoOsc.disconnect();
      } catch (e) {
        // ignore
      }
      this.servoOsc = null;
      this.isServoRunning = false;
    }
  }

  public playFootstep(enabled: boolean) {
    if (!enabled) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.06);

      gain.gain.setValueAtTime(0.035, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.06);
    } catch (e) {
      // safe fallback
    }
  }

  public playLidarPing(enabled: boolean) {
    if (!enabled) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1800, this.ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.02, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.08);
    } catch (e) {
      // safe fallback
    }
  }

  public playDockingLatch(enabled: boolean) {
    if (!enabled) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, this.ctx.currentTime);
      osc.frequency.setValueAtTime(580, this.ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.15);
    } catch (e) {
      // safe fallback
    }
  }

  public playAlert(enabled: boolean) {
    if (!enabled) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.2);
    } catch (e) {
      // safe fallback
    }
  }

  public playPowerBurst(enabled: boolean) {
    if (!enabled) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      // High-power inverter turbine pitch escalation
      osc.frequency.setValueAtTime(260, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1480, this.ctx.currentTime + 0.38);

      gain.gain.setValueAtTime(0.065, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.38);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.38);
    } catch (e) {
      // safe fallback
    }
  }
}

export const audioSynth = new AudioSynthesizer();
