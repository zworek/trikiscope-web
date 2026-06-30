/**
 * triki.js — Triki BLE library
 * Clean port of TrikiScope Python communication layer to the Web Bluetooth API.
 *
 * Exports:
 *   ODR_PRESETS          — array of { label, bytes } for ODR selection
 *   TrikiSensors         — IMU sample in real physical units
 *   TrikiDevice          — EventTarget; call connect() / disconnect() / setLed() / resetOrientation()
 *
 * Events fired by TrikiDevice:
 *   statuschange         — detail: { status: 'connecting'|'connected'|'disconnected'|'error'|'idle' }
 *   sensorupdate         — detail: TrikiSensors instance
 *   orientationupdate    — detail: { pitch, roll, yaw, calibrating }
 *   gesture              — detail: { name, magnitude }
 *   packet               — detail: { bytes: Uint8Array }  (raw BLE notification)
 */

// ── BLE UUIDs ─────────────────────────────────────────────────────────────────
const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // write
const NUS_TX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // notify
const LED_UUID    = '6e400004-b5a3-f393-e0a9-e50e24dcca9e';

// ── Protocol constants ────────────────────────────────────────────────────────
const FRAME_SIZE      = 14;
const FRAME_MARKER    = 0x22;
const STARTUP_DISCARD = 20;
const GYRO_SCALE      = 131.0;   // LSB per deg/s  (LSM6DSL ±250 dps range)
const ACCEL_SCALE     = 2048.0;  // LSB per g      (LSM6DSL ±16 g range)
const INIT_SEQUENCE   = new Uint8Array([0x01, 0x00]);
const STOP_COMMAND    = new Uint8Array([0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const DEG2RAD         = Math.PI / 180;
const RAD2DEG         = 180 / Math.PI;

// ── ODR presets (exported) ────────────────────────────────────────────────────
export const ODR_PRESETS = [
  { label: '52 Hz',   hz: 52,   bytes: [0x20,0x10,0x00,0xD0,0x07,0x34,0x00,0x03] },
  { label: '104 Hz',  hz: 104,  bytes: [0x20,0x10,0x00,0xD0,0x07,0x68,0x00,0x03] },
  { label: '208 Hz',  hz: 208,  bytes: [0x20,0x10,0x00,0xD0,0x07,0xD0,0x00,0x03] },
  { label: '416 Hz',  hz: 416,  bytes: [0x20,0x10,0x00,0xD0,0x07,0xA0,0x01,0x03] },
  { label: '833 Hz',  hz: 833,  bytes: [0x20,0x10,0x00,0xD0,0x07,0x41,0x03,0x03] },
  { label: '1666 Hz', hz: 1666, bytes: [0x20,0x10,0x00,0xD0,0x07,0x82,0x06,0x03] },
];

// ── TrikiSensors ─────────────────────────────────────────────────────────────
export class TrikiSensors {
  constructor() {
    this.accelX = 0;  this.accelY = 0;  this.accelZ = 0;   // g
    this.gyroX  = 0;  this.gyroY  = 0;  this.gyroZ  = 0;   // deg/s
    this.rawAccelX = 0; this.rawAccelY = 0; this.rawAccelZ = 0;
    this.rawGyroX  = 0; this.rawGyroY  = 0; this.rawGyroZ  = 0;
    this.accelMag = 0;     // sqrt(ax²+ay²+az²), ≈1.0 at rest
    this.gyroMag  = 0;     // sqrt(gx²+gy²+gz²) in deg/s
    this.button      = false;  // held state
    this.click       = false;  // rising edge this frame
    this.frameIndex  = 0;
    this.timestampMs = 0;  // performance.now() at parse time
  }
}

// ── FrameParser ───────────────────────────────────────────────────────────────
// Re-assembles 14-byte frames from BLE notification chunks.
// Header: [0x22][0x00 released | 0x01 pressed][6×int16LE gyro+accel]
class FrameParser {
  constructor() {
    this._buf        = new Uint8Array(512);
    this._len        = 0;
    this._lastButton = 0;
    this._frameIdx   = 0;
    this._discarded  = 0;
  }

  reset() {
    this._len        = 0;
    this._lastButton = 0;
    this._frameIdx   = 0;
    this._discarded  = 0;
  }

  push(bytes) {
    // Grow backing buffer if needed
    if (this._len + bytes.length > this._buf.length) {
      const grown = new Uint8Array(Math.max(this._buf.length * 2, this._len + bytes.length + 64));
      grown.set(this._buf.subarray(0, this._len));
      this._buf = grown;
    }
    this._buf.set(bytes, this._len);
    this._len += bytes.length;
    return this._drain();
  }

  _drain() {
    const out = [];
    const buf = this._buf;
    let pos = 0;

    while (pos + FRAME_SIZE <= this._len) {
      if (buf[pos] !== FRAME_MARKER) { pos++; continue; }
      const status = buf[pos + 1];
      if (status !== 0x00 && status !== 0x01) { pos++; continue; }
      const s = this._parseFrame(buf, pos, status);
      pos += FRAME_SIZE;
      if (s !== null) out.push(s);
    }

    // Slide remaining bytes to the front
    if (pos > 0) {
      buf.copyWithin(0, pos, this._len);
      this._len -= pos;
    }
    return out;
  }

  _parseFrame(buf, offset, status) {
    if (this._discarded < STARTUP_DISCARD) { this._discarded++; return null; }

    const i = offset + 2;
    const rawGX = int16LE(buf, i);
    const rawGY = int16LE(buf, i + 2);
    const rawGZ = int16LE(buf, i + 4);
    const rawAX = int16LE(buf, i + 6);
    const rawAY = int16LE(buf, i + 8);
    const rawAZ = int16LE(buf, i + 10);

    const s = new TrikiSensors();
    s.rawGyroX  = rawGX;  s.rawGyroY  = rawGY;  s.rawGyroZ  = rawGZ;
    s.rawAccelX = rawAX;  s.rawAccelY = rawAY;  s.rawAccelZ = rawAZ;
    s.gyroX  = rawGX / GYRO_SCALE;
    s.gyroY  = rawGY / GYRO_SCALE;
    s.gyroZ  = rawGZ / GYRO_SCALE;
    s.accelX = rawAX / ACCEL_SCALE;
    s.accelY = rawAY / ACCEL_SCALE;
    s.accelZ = rawAZ / ACCEL_SCALE;
    s.accelMag = Math.sqrt(s.accelX**2 + s.accelY**2 + s.accelZ**2);
    s.gyroMag  = Math.sqrt(s.gyroX**2  + s.gyroY**2  + s.gyroZ**2);
    s.button     = status !== 0;
    s.click      = s.button && this._lastButton === 0;
    this._lastButton = status;
    s.frameIndex  = this._frameIdx++;
    s.timestampMs = performance.now();
    return s;
  }
}

function int16LE(buf, i) {
  return ((buf[i] | (buf[i + 1] << 8)) << 16) >> 16;
}

// ── MadgwickAHRS ─────────────────────────────────────────────────────────────
// Ported verbatim from TrikiScope/trikiscope/orientation.py
// q = [w, x, y, z]; gyro in rad/s; accel in any unit (normalised internally)
class MadgwickAHRS {
  constructor(beta = 1.5) {
    this.beta = beta;
    this.q = [1, 0, 0, 0];
  }

  reset() { this.q = [1, 0, 0, 0]; }

  update(gx, gy, gz, ax, ay, az, dt) {
    if (dt <= 0) return;
    let [q1, q2, q3, q4] = this.q;

    const _2q1 = 2*q1, _2q2 = 2*q2, _2q3 = 2*q3, _2q4 = 2*q4;
    const _4q1 = 4*q1, _4q2 = 4*q2, _4q3 = 4*q3;
    const _8q2 = 8*q2, _8q3 = 8*q3;
    const q1q1 = q1*q1, q2q2 = q2*q2, q3q3 = q3*q3, q4q4 = q4*q4;

    if (ax === 0 && ay === 0 && az === 0) return;
    let norm = Math.sqrt(ax*ax + ay*ay + az*az);
    ax /= norm; ay /= norm; az /= norm;

    let s1 = _4q1*q3q3 + _2q3*ax + _4q1*q2q2 - _2q2*ay;
    let s2 = _4q2*q4q4 - _2q4*ax + 4*q1q1*q2 - _2q1*ay - _4q2 + _8q2*q2q2 + _8q2*q3q3 + _4q2*az;
    let s3 = 4*q1q1*q3 + _2q1*ax + _4q3*q4q4 - _2q4*ay - _4q3 + _8q3*q2q2 + _8q3*q3q3 + _4q3*az;
    let s4 = 4*q2q2*q4 - _2q2*ax + 4*q3q3*q4 - _2q3*ay;

    norm = Math.sqrt(s1*s1 + s2*s2 + s3*s3 + s4*s4);
    if (norm > 0) { s1/=norm; s2/=norm; s3/=norm; s4/=norm; }

    const qd1 = 0.5*(-q2*gx - q3*gy - q4*gz) - this.beta*s1;
    const qd2 = 0.5*(q1*gx  + q3*gz - q4*gy) - this.beta*s2;
    const qd3 = 0.5*(q1*gy  - q2*gz + q4*gx) - this.beta*s3;
    const qd4 = 0.5*(q1*gz  + q2*gy - q3*gx) - this.beta*s4;

    q1 += qd1*dt; q2 += qd2*dt; q3 += qd3*dt; q4 += qd4*dt;
    norm = Math.sqrt(q1*q1 + q2*q2 + q3*q3 + q4*q4);
    if (norm === 0) return;
    this.q = [q1/norm, q2/norm, q3/norm, q4/norm];
  }
}

// ── Quaternion ────────────────────────────────────────────────────────────────
// (x, y, z, w) convention — matches WPF / TrikiScope Python
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x; this.y = y; this.z = z; this.w = w;
  }

  static identity() { return new Quaternion(0, 0, 0, 1); }

  static fromAxisAngle(ax, ay, az, angleDeg) {
    const len = Math.sqrt(ax*ax + ay*ay + az*az);
    if (len === 0) return Quaternion.identity();
    const r = angleDeg * DEG2RAD;
    const s = Math.sin(r * 0.5) / len;
    return new Quaternion(ax*s, ay*s, az*s, Math.cos(r * 0.5));
  }

  static slerp(a, b, t) {
    a = a.normalized(); b = b.normalized();
    let dot = a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w;
    if (dot < 0) { b = new Quaternion(-b.x, -b.y, -b.z, -b.w); dot = -dot; }
    if (dot > 0.9995) {
      return new Quaternion(
        a.x + t*(b.x-a.x), a.y + t*(b.y-a.y),
        a.z + t*(b.z-a.z), a.w + t*(b.w-a.w)
      ).normalized();
    }
    const theta0 = Math.acos(Math.max(-1, Math.min(1, dot)));
    const theta  = theta0 * t;
    const sinT   = Math.sin(theta);
    const sinT0  = Math.sin(theta0);
    const s0 = Math.cos(theta) - dot * sinT / sinT0;
    const s1 = sinT / sinT0;
    return new Quaternion(s0*a.x + s1*b.x, s0*a.y + s1*b.y, s0*a.z + s1*b.z, s0*a.w + s1*b.w);
  }

  multiply(o) {
    return new Quaternion(
      this.w*o.x + this.x*o.w + this.y*o.z - this.z*o.y,
      this.w*o.y + this.y*o.w + this.z*o.x - this.x*o.z,
      this.w*o.z + this.z*o.w + this.x*o.y - this.y*o.x,
      this.w*o.w - this.x*o.x - this.y*o.y - this.z*o.z
    );
  }

  normalized() {
    const n = Math.sqrt(this.x*this.x + this.y*this.y + this.z*this.z + this.w*this.w);
    if (n === 0) return Quaternion.identity();
    return new Quaternion(this.x/n, this.y/n, this.z/n, this.w/n);
  }

  inverse() {
    const n2 = this.x*this.x + this.y*this.y + this.z*this.z + this.w*this.w;
    if (n2 === 0) return Quaternion.identity();
    return new Quaternion(-this.x/n2, -this.y/n2, -this.z/n2, this.w/n2);
  }

  toEulerDegrees() {
    const { x, y, z, w } = this;
    // Roll (x-axis rotation)
    const sinrCosp = 2*(w*x + y*z);
    const cosrCosp = 1 - 2*(x*x + y*y);
    const roll = Math.atan2(sinrCosp, cosrCosp) * RAD2DEG;
    // Pitch (y-axis rotation)
    const sinp = 2*(w*y - z*x);
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * 90 : Math.asin(sinp) * RAD2DEG;
    // Yaw (z-axis rotation)
    const sinyCosp = 2*(w*z + x*y);
    const cosyCosp = 1 - 2*(y*y + z*z);
    const yaw = Math.atan2(sinyCosp, cosyCosp) * RAD2DEG;
    return [pitch, roll, yaw];
  }
}

// ── VisualOrientationMapper ───────────────────────────────────────────────────
// Madgwick + auto-zero calibration + SLERP smoothing + dead-band
// Ported from TrikiScope/trikiscope/orientation.py VisualOrientationMapper
class VisualOrientationMapper {
  constructor() {
    this._ahrs            = new MadgwickAHRS(1.5);
    this._gyroGain        = 2.5;
    this._fallbackDt      = 0.02;
    this._minDt           = 0.001;
    this._smoothing       = 0.35;
    this._deadbandDeg     = 8.0;

    this._lastTsMs        = null;
    this._offset          = Quaternion.identity();
    this._smoothed        = Quaternion.identity();
    this._firstSample     = true;

    this._autoZeroPending  = false;
    this._autoZeroCount    = 0;
    this._autoZeroStable   = 0;
    this._autoZeroMin      = 0;
    this._autoZeroStableReq = 0;
    this._autoZeroMax      = 0;

    this.calibrating = false;
  }

  update(sensors) {
    let dt = this._fallbackDt;
    if (this._lastTsMs !== null) {
      dt = (sensors.timestampMs - this._lastTsMs) / 1000;
      if (dt <= this._minDt) dt = this._fallbackDt;
    }
    this._lastTsMs = sensors.timestampMs;

    const gx =  sensors.gyroX * this._gyroGain * DEG2RAD;
    const gy =  sensors.gyroY * this._gyroGain * DEG2RAD;
    const gz = -sensors.gyroZ * this._gyroGain * DEG2RAD; // negate Z: CCW spin → visual left

    this._ahrs.update(gx, gy, gz, sensors.accelX, sensors.accelY, sensors.accelZ, dt);
    const rawQ = toVisualQuat(this._ahrs.q);

    if (this._autoZeroPending) return this._autoZeroStep(sensors, rawQ);

    let target = applyDeadband(this._offset.multiply(rawQ), this._deadbandDeg);

    if (this._firstSample) {
      this._smoothed = target;
      this._firstSample = false;
    } else {
      this._smoothed = Quaternion.slerp(this._smoothed, target, this._smoothing);
    }

    const [pitch, roll, yaw] = this._smoothed.toEulerDegrees();
    return { pitch, roll, yaw, calibrating: false };
  }

  reset() {
    const current = toVisualQuat(this._ahrs.q);
    this._offset       = current.inverse();
    this._smoothed     = Quaternion.identity();
    this._firstSample  = true;
    this._autoZeroPending = false;
    this._autoZeroCount = 0;
    this._autoZeroStable = 0;
    this.calibrating   = false;
  }

  resetForNewStream(minFrames = 50, stableWindow = 10, maxFrames = 200) {
    this._ahrs.reset();
    this._lastTsMs     = null;
    this._offset       = Quaternion.identity();
    this._smoothed     = Quaternion.identity();
    this._firstSample  = true;
    this._autoZeroPending  = true;
    this._autoZeroCount    = 0;
    this._autoZeroStable   = 0;
    this._autoZeroMin      = minFrames;
    this._autoZeroStableReq = stableWindow;
    this._autoZeroMax      = maxFrames;
    this.calibrating = true;
  }

  _autoZeroStep(sensors, rawQ) {
    this.calibrating = true;
    this._autoZeroCount++;
    if (this._autoZeroCount > this._autoZeroMin) {
      const still = sensors.gyroMag <= 2.0 && sensors.accelMag >= 0.85 && sensors.accelMag <= 1.15;
      this._autoZeroStable = still ? this._autoZeroStable + 1 : 0;
    }
    if (this._autoZeroStable >= this._autoZeroStableReq || this._autoZeroCount >= this._autoZeroMax) {
      this._offset      = rawQ.inverse();
      this._smoothed    = Quaternion.identity();
      this._firstSample = true;
      this._autoZeroPending = false;
      this.calibrating  = false;
    }
    return { pitch: 0, roll: 0, yaw: 0, calibrating: true };
  }
}

// Madgwick [w,x,y,z] → Quaternion(-x, y, -z, w)  (WPF axis remap)
function toVisualQuat(q) {
  return new Quaternion(-q[1], q[2], -q[3], q[0]);
}

function applyDeadband(q, deadbandDeg) {
  if (deadbandDeg <= 0) return q;
  q = q.normalized();
  if (q.w < 0) q = new Quaternion(-q.x, -q.y, -q.z, -q.w);
  const w = Math.max(-1, Math.min(1, q.w));
  const angleDeg = 2 * Math.acos(w) * RAD2DEG;
  if (angleDeg <= deadbandDeg) return Quaternion.identity();
  const axisLen = Math.sqrt(q.x*q.x + q.y*q.y + q.z*q.z);
  if (axisLen <= 1e-12) return Quaternion.identity();
  return Quaternion.fromAxisAngle(q.x/axisLen, q.y/axisLen, q.z/axisLen, angleDeg - deadbandDeg);
}

// ── GestureDetector ───────────────────────────────────────────────────────────
// Ported from TrikiScope/trikiscope/gestures.py
class GestureDetector {
  constructor() { this.reset(); }

  reset() {
    this._freeFallRun  = 0;
    this._shakeRun     = 0;
    this._lastEventTs  = -1e9; // seconds
    this.lastEvent     = null;
  }

  update(sensors) {
    const tSec  = sensors.timestampMs / 1000;
    const accel = sensors.accelMag;
    const gyro  = sensors.gyroMag;

    this._freeFallRun = accel < 0.35 ? this._freeFallRun + 1 : 0;
    this._shakeRun    = gyro  > 300  ? this._shakeRun + 1    : 0;

    if (tSec - this._lastEventTs < 0.4) return null;

    let event = null;
    const maxAxis = Math.max(Math.abs(sensors.gyroX), Math.abs(sensors.gyroY), Math.abs(sensors.gyroZ));

    if (accel > 2.5) {
      event = { name: 'TAP / IMPACT', magnitude: accel };
    } else if (this._freeFallRun >= 2) {
      event = { name: 'FREE-FALL', magnitude: accel };
    } else if (this._shakeRun >= 4) {
      event = { name: 'SHAKE', magnitude: gyro };
    } else if (maxAxis > 250) {
      event = { name: 'SPIN', magnitude: maxAxis };
    }

    if (event) {
      this._lastEventTs = tSec;
      this.lastEvent    = event;
    }
    return event;
  }
}

// ── TrikiDevice ───────────────────────────────────────────────────────────────
export class TrikiDevice extends EventTarget {
  constructor() {
    super();
    this._parser        = new FrameParser();
    this._orientMapper  = new VisualOrientationMapper();
    this._gestures      = new GestureDetector();

    this._device        = null;
    this._server        = null;
    this._rxChar        = null;
    this._ledChar       = null;

    this._status        = 'idle';
    this._latestSensors = new TrikiSensors();
    this._deviceInfo    = {};
    this._batteryLevel  = null;

    this._packetCount   = 0;
    this._ppsCount      = 0;
    this._ppsWindowStart = 0;
    this._ppsLast       = 0;

    this._buttonHeld    = false;
    this._clickLockout  = 0;

    this._notifyHandler     = null;
    this._disconnectHandler = null;
    this._initCommand       = new Uint8Array(ODR_PRESETS[2].bytes); // 208 Hz default
  }

  get supported()  { return typeof navigator !== 'undefined' && 'bluetooth' in navigator; }
  get status()     { return this._status; }
  get connected()  { return this._status === 'connected'; }
  get sensors()    { return this._latestSensors; }
  get deviceInfo() { return { ...this._deviceInfo, batteryLevel: this._batteryLevel }; }
  get packetsPerSecond() { return this._ppsLast; }
  get packetCount()      { return this._packetCount; }
  get buttonHeld()       { return this._buttonHeld; }

  async connect(odrIndex = 2) {
    if (!this.supported) throw new Error('Web Bluetooth not supported in this browser');
    const preset = ODR_PRESETS[Math.max(0, Math.min(odrIndex, ODR_PRESETS.length - 1))];
    this._initCommand = new Uint8Array(preset.bytes);
    this._setStatus('connecting');
    try {
      this._device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Triki' }],
        optionalServices: [
          NUS_SERVICE,
          '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
          '0000180f-0000-1000-8000-00805f9b34fb', // Battery
        ],
      });
      this._disconnectHandler = () => this._onGattDisconnected();
      this._device.addEventListener('gattserverdisconnected', this._disconnectHandler);
      await this._doConnect();
    } catch (err) {
      this._setStatus('error');
      throw err;
    }
  }

  async disconnect() {
    if (this._rxChar) {
      try {
        if (this._rxChar.writeValueWithoutResponse) {
          await this._rxChar.writeValueWithoutResponse(STOP_COMMAND);
        } else {
          await this._rxChar.writeValue(STOP_COMMAND);
        }
      } catch { /* ignore — device may already be disconnecting */ }
    }
    if (this._device?.gatt?.connected) this._device.gatt.disconnect();
    this._cleanup();
    this._setStatus('idle');
  }

  async setLed(on) {
    if (!this._ledChar) return;
    const payload = new Uint8Array([on ? 1 : 0]);
    try {
      if (this._ledChar.writeValueWithResponse) {
        await this._ledChar.writeValueWithResponse(payload);
      } else {
        await this._ledChar.writeValue(payload);
      }
    } catch { /* LED char may be unavailable on this firmware */ }
  }

  resetOrientation() {
    this._orientMapper.reset();
  }

  async _doConnect() {
    this._server = await this._device.gatt.connect();

    // NUS: required
    const nusSvc = await this._server.getPrimaryService(NUS_SERVICE);
    this._rxChar = await nusSvc.getCharacteristic(NUS_RX);
    const txChar = await nusSvc.getCharacteristic(NUS_TX);

    // LED: optional (silently skip if missing)
    try { this._ledChar = await nusSvc.getCharacteristic(LED_UUID); } catch { this._ledChar = null; }

    // Device Information Service: optional
    try {
      const diSvc  = await this._server.getPrimaryService('0000180a-0000-1000-8000-00805f9b34fb');
      const readStr = async (uuid) => {
        try {
          const c = await diSvc.getCharacteristic(uuid);
          const v = await c.readValue();
          return new TextDecoder().decode(v).replace(/\0/g, '').trim();
        } catch { return null; }
      };
      this._deviceInfo = {
        name:             this._device.name ?? null,
        manufacturer:     await readStr('00002a29-0000-1000-8000-00805f9b34fb'),
        firmwareRevision: await readStr('00002a26-0000-1000-8000-00805f9b34fb'),
        serialNumber:     await readStr('00002a25-0000-1000-8000-00805f9b34fb'),
      };
    } catch {
      this._deviceInfo = { name: this._device.name ?? null };
    }

    // Battery: optional
    try {
      const batSvc  = await this._server.getPrimaryService('0000180f-0000-1000-8000-00805f9b34fb');
      const batChar = await batSvc.getCharacteristic('00002a19-0000-1000-8000-00805f9b34fb');
      const v = await batChar.readValue();
      this._batteryLevel = v.getUint8(0);
    } catch { this._batteryLevel = null; }

    // Subscribe to sensor stream
    await txChar.startNotifications();
    this._notifyHandler = (e) => this._onNotify(e);
    txChar.addEventListener('characteristicvaluechanged', this._notifyHandler);

    // Send init sequence
    await this._sendInit();

    // Reset state
    this._parser.reset();
    this._orientMapper.resetForNewStream();
    this._gestures.reset();
    this._packetCount = 0;
    this._ppsCount    = 0;
    this._ppsWindowStart = performance.now();
    this._ppsLast     = 0;

    this._setStatus('connected');
  }

  async _sendInit() {
    const rx = this._rxChar;
    // Step 1: write-with-response to wake the IMU
    if (rx.writeValueWithResponse) {
      await rx.writeValueWithResponse(INIT_SEQUENCE);
    } else {
      await rx.writeValue(INIT_SEQUENCE);
    }
    // Step 2: set ODR — write-without-response to start streaming
    if (rx.writeValueWithoutResponse) {
      await rx.writeValueWithoutResponse(this._initCommand);
    } else {
      await rx.writeValue(this._initCommand);
    }
  }

  _onNotify(event) {
    const now   = performance.now();
    const bytes = new Uint8Array(event.target.value.buffer);

    this._packetCount++;
    this._ppsCount++;
    if (now - this._ppsWindowStart >= 1000) {
      this._ppsLast       = Math.round(this._ppsCount * 1000 / (now - this._ppsWindowStart));
      this._ppsCount      = 0;
      this._ppsWindowStart = now;
    }

    this.dispatchEvent(new CustomEvent('packet', { detail: { bytes } }));

    const frames = this._parser.push(bytes);
    for (const sensors of frames) {
      this._latestSensors = sensors;
      this._buttonHeld    = sensors.button;

      if (sensors.click && now > this._clickLockout) {
        this._clickLockout = now + 120;
        this.dispatchEvent(new Event('click'));
      }

      const ori = this._orientMapper.update(sensors);
      this.dispatchEvent(new CustomEvent('orientationupdate', { detail: ori }));

      const gesture = this._gestures.update(sensors);
      if (gesture) {
        this.dispatchEvent(new CustomEvent('gesture', { detail: gesture }));
      }

      this.dispatchEvent(new CustomEvent('sensorupdate', { detail: sensors }));
    }
  }

  _onGattDisconnected() {
    this._cleanup();
    if (this._status === 'connected' || this._status === 'connecting') {
      this._setStatus('disconnected');
    }
  }

  _cleanup() {
    this._rxChar   = null;
    this._ledChar  = null;
    this._server   = null;
    this._buttonHeld = false;
  }

  _setStatus(s) {
    this._status = s;
    this.dispatchEvent(new CustomEvent('statuschange', { detail: { status: s } }));
  }
}
