import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { ShadowMapService } from './shadow-map.service';
import { PredictionService } from './prediction.service';

// A single measured ping (no sessionId — that lives at the batch envelope level)
interface PingData {
  timestamp:        string;       // ISO string — serialisable over HTTP
  lat:              number;
  lng:              number;
  speed_kmh:        number;
  heading:          number;
  signal_strength:  number | null;
  downlink_mbps:    number | null;
  rtt_ms:           number | null;
  connection_type:  string | null;
  battery_level:    number | null;
  buffer_level_sec: number | null;
  bitrate_kbps:     number | null;
}

// ── Change-detection thresholds ───────────────────────────────────────────────
// A ping is only pushed into the buffer when at least one of these is true.
// This filters out redundant samples for stationary users on a stable network,
// reducing storage by ~60–80% without losing meaningful signal.

const BUFFER_CHANGE_THRESHOLD_S = 2;       // seconds of buffer level delta
const DISTANCE_THRESHOLD_M      = 50;      // metres of movement
const MAX_SILENCE_MS             = 15_000; // always push a heartbeat every 15 s

// Batch size: how many meaningful pings to accumulate before sending to the backend.
// At ~1 meaningful ping / 15–20 s on a stable session, this means ~1 API call / 3–5 min.
const BATCH_SIZE    = 10;
const PING_INTERVAL = 4_000;   // measurement interval (ms) — NOT the send interval

// ── Haversine distance (metres) ───────────────────────────────────────────────

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable({ providedIn: 'root' })
export class TelemetryService implements OnDestroy {
  private apiUrl     = environment.apiUrl;
  private sessionId: string | null = null;

  // Ping buffer — flushed when full or on session end
  private pingBuffer:   PingData[] = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // Change-detection state
  private lastPushedPing: PingData | null = null;
  private lastPushTimeMs  = 0;

  // Latest values updated by the player component
  private bufferLevel:     number | null = null;
  private bitrateKbps:     number | null = null;
  private lastBitrateKbps: number | null = null;

  // Geolocation
  private geoWatchId:   number | null = null;
  private lastPosition: GeolocationCoordinates | null = null;

  // Battery
  private batteryLevel: number | null = null;

  constructor(
    private http: HttpClient,
    private shadowMap: ShadowMapService,
    private prediction: PredictionService,
  ) {}

  // ── Session lifecycle ─────────────────────────────────────────────────────

  async startSession(videoId: string): Promise<void> {
    if (this.sessionId) this.stopSession();

    try {
      const res: any = await this.http
        .post(`${this.apiUrl}/telemetry/session`, { videoId })
        .toPromise();
      this.sessionId = res.sessionId;

      this.lastPushedPing = null;
      this.lastPushTimeMs  = 0;

      this.startGeolocation();
      await this.initBattery();
      this.startPingLoop();
      this.prediction.setSessionId(res.sessionId);
      this.prediction.startPredicting();

      if (this.lastPosition) {
        this.shadowMap.onVideoStart(this.lastPosition.latitude, this.lastPosition.longitude);
      }
    } catch (e) {
      // Telemetry failure must never break playback
    }
  }

  stopSession(): void {
    if (!this.sessionId) return;
    const id = this.sessionId;

    this.stopPingLoop();
    this.stopGeolocation();
    this.prediction.stopPredicting();
    this.sessionId = null;

    // Flush remaining buffered pings before closing the session
    this.flushPings(id);

    this.http.patch(`${this.apiUrl}/telemetry/session/${id}/end`, {
      genabr_active: this.prediction.genabrWasActive,
    }).subscribe({ error: () => {} });
  }

  ngOnDestroy(): void {
    this.stopSession();
  }

  // ── Called by player component ────────────────────────────────────────────

  updateBufferLevel(sec: number): void {
    this.bufferLevel = sec;
  }

  updateBitrate(
    kbps:   number,
    reason: 'abr_auto' | 'genabr_override' | 'user_manual' = 'abr_auto',
  ): void {
    if (this.lastBitrateKbps !== null && this.lastBitrateKbps !== kbps) {
      this.reportBitrateSwitch(this.lastBitrateKbps, kbps, reason);
    }
    this.lastBitrateKbps = kbps;
    this.bitrateKbps     = kbps;
  }

  reportStall(durationMs: number): void {
    if (!this.sessionId || !this.lastPosition) return;
    this.prediction.notifyStall();
    this.http.post(`${this.apiUrl}/telemetry/stall`, {
      sessionId:   this.sessionId,
      duration_ms: durationMs,
      lat:         this.lastPosition.latitude,
      lng:         this.lastPosition.longitude,
    }).subscribe({ error: () => {} });
  }

  // ── Ping loop ─────────────────────────────────────────────────────────────

  private startPingLoop(): void {
    this.pingInterval = setInterval(() => this.collectPing(), PING_INTERVAL);
  }

  private stopPingLoop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /** Measures current state and, if the reading is meaningfully different from
   *  the last saved ping, pushes it into the local buffer.
   *  Identical / near-identical readings are dropped (change detection).
   *  When the buffer reaches BATCH_SIZE it is flushed in one HTTP call. */
  private collectPing(): void {
    if (!this.sessionId) return;

    const conn = this.getConnectionInfo();
    const pos  = this.lastPosition;

    // Keep PredictionService context fresh on every tick (pure local, zero cost)
    this.prediction.updateNetworkContext(conn.type, conn.downlink, this.bufferLevel, this.bitrateKbps);

    const ping: PingData = {
      timestamp:        new Date().toISOString(),
      lat:              pos?.latitude   ?? 0,
      lng:              pos?.longitude  ?? 0,
      speed_kmh:        pos?.speed != null ? pos.speed * 3.6 : 0,
      heading:          pos?.heading    ?? 0,
      signal_strength:  null,
      downlink_mbps:    conn.downlink,
      rtt_ms:           conn.rtt,
      connection_type:  conn.type,
      battery_level:    this.batteryLevel,
      buffer_level_sec: this.bufferLevel,
      bitrate_kbps:     this.bitrateKbps,
    };

    if (!this.shouldPush(ping)) return;

    this.lastPushedPing = ping;
    this.lastPushTimeMs  = Date.now();
    this.pingBuffer.push(ping);

    if (this.pingBuffer.length >= BATCH_SIZE) {
      this.flushPings(this.sessionId);
    }
  }

  /** Returns true if this ping carries new information worth storing.
   *  Conditions (any one is sufficient):
   *    1. First ping ever this session
   *    2. Heartbeat — more than MAX_SILENCE_MS since last push
   *    3. Buffer level changed by more than threshold
   *    4. Bitrate changed
   *    5. Connection type changed (e.g. WiFi → 4G)
   *    6. User moved more than DISTANCE_THRESHOLD_M */
  private shouldPush(ping: PingData): boolean {
    if (!this.lastPushedPing) return true;                                 // (1) first ping

    const silenceMs = Date.now() - this.lastPushTimeMs;
    if (silenceMs >= MAX_SILENCE_MS) return true;                          // (2) heartbeat

    const bufDelta = Math.abs(
      (ping.buffer_level_sec ?? 0) - (this.lastPushedPing.buffer_level_sec ?? 0),
    );
    if (bufDelta >= BUFFER_CHANGE_THRESHOLD_S) return true;                // (3) buffer change

    if (ping.bitrate_kbps !== this.lastPushedPing.bitrate_kbps) return true; // (4) bitrate

    if (ping.connection_type !== this.lastPushedPing.connection_type) return true; // (5) conn type

    const dist = haversineMetres(
      ping.lat, ping.lng,
      this.lastPushedPing.lat, this.lastPushedPing.lng,
    );
    if (dist >= DISTANCE_THRESHOLD_M) return true;                         // (6) movement

    return false;
  }

  /** Drains the ping buffer and sends it as a single batch request.
   *  Safe to call with an explicit sessionId after this.sessionId has been
   *  cleared (i.e., during stopSession). */
  private flushPings(sessionId: string): void {
    if (this.pingBuffer.length === 0) return;

    const batch = this.pingBuffer.splice(0);   // drain atomically

    this.http.post(`${this.apiUrl}/telemetry/pings`, {
      sessionId,
      pings: batch,
    }).subscribe({ error: () => {} });
  }

  // ── Geolocation ───────────────────────────────────────────────────────────

  private startGeolocation(): void {
    if (!navigator.geolocation) return;
    this.geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.lastPosition  = pos.coords;
        const lat          = pos.coords.latitude;
        const lng          = pos.coords.longitude;
        const speedKmh     = pos.coords.speed != null ? pos.coords.speed * 3.6 : 0;
        const heading      = pos.coords.heading ?? 0;
        this.shadowMap.onPositionUpdate(lat, lng);
        this.prediction.updatePosition(lat, lng, heading, speedKmh);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 5000 },
    );
  }

  private stopGeolocation(): void {
    if (this.geoWatchId !== null) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
  }

  // ── Battery API ───────────────────────────────────────────────────────────

  private async initBattery(): Promise<void> {
    try {
      const nav = navigator as any;
      if (nav.getBattery) {
        const battery = await nav.getBattery();
        this.batteryLevel = battery.level;
        battery.addEventListener('levelchange', () => {
          this.batteryLevel = battery.level;
        });
      }
    } catch { /* not available */ }
  }

  // ── Network info ──────────────────────────────────────────────────────────

  private getConnectionInfo(): { downlink: number | null; rtt: number | null; type: string | null } {
    const conn = (navigator as any).connection;
    if (!conn) return { downlink: null, rtt: null, type: null };
    return {
      downlink: conn.downlink      ?? null,
      rtt:      conn.rtt           ?? null,
      type:     conn.effectiveType ?? null,
    };
  }

  // ── Bitrate switch reporting ──────────────────────────────────────────────

  private reportBitrateSwitch(from: number, to: number, reason: string): void {
    if (!this.sessionId) return;
    this.http.post(`${this.apiUrl}/telemetry/bitrate-switch`, {
      sessionId: this.sessionId,
      from_kbps: from,
      to_kbps:   to,
      reason,
    }).subscribe({ error: () => {} });
  }
}
