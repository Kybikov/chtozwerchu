"use client";
// React Bits Pro GrainWave shader, live-fetched 2026-11-02.
// Studio adaptation: retain original shader; use a small native WebGL renderer.
import ShaderSurface from "../ShaderSurface";
import "./grain-wave.css";

export interface GrainWaveProps {
  /** Studio adaptation: explicit theme avoids an SSR theme script in a client-only app. */
  theme?: "dark" | "light";
  /** Width of the component */
  width?: string | number;
  /** Height of the component */
  height?: string | number;
  /** Additional CSS classes */
  className?: string;
  /** Animation speed multiplier */
  speed?: number;
  /** Number of wave lines */
  waveCount?: number;
  /** Wave amplitude/height */
  waveAmplitude?: number;
  /** Horizontal wave frequency */
  waveFrequency?: number;
  /** Line thickness */
  lineThickness?: number;
  /** Grain/dither intensity */
  grainIntensity?: number;
  /** Start color (top waves) */
  startColor?: string;
  /** End color (bottom waves) */
  endColor?: string;
  /** Background color for light mode */
  lightBackground?: string;
  /** Background color for dark mode */
  darkBackground?: string;
  /** Overall brightness */
  brightness?: number;
  /** Wave speed variation between lines */
  speedVariation?: number;
  /** Width of the wave effect (horizontal spread) */
  waveWidth?: number;
  /** Scale of the entire effect */
  scale?: number;
}

const fragmentShader = `
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_speed;
uniform float u_waveCount;
uniform float u_waveAmplitude;
uniform float u_waveFrequency;
uniform float u_lineThickness;
uniform float u_grainIntensity;
uniform vec3 u_startColor;
uniform vec3 u_endColor;
uniform vec3 u_backgroundColor;
uniform float u_brightness;
uniform float u_speedVariation;
uniform float u_waveWidth;
uniform float u_scale;

varying vec2 vUv;

float generateNoise(vec2 position) {
  vec2 seed = vec2(12.9898, 78.233);
  float dotProduct = dot(position, seed);
  return fract(sin(dotProduct) * 43758.5453);
}

float applyGrain(vec2 position) {
  return (generateNoise(position) * 2.0 - 1.0) / 256.0;
}

vec4 calculateWaveLine(vec2 coord, float animSpeed, float horizontalScale, vec3 color) {
  float waveOffset = sin(u_time * animSpeed + coord.x * horizontalScale * u_waveFrequency) * u_waveAmplitude;
  float edgeFalloff = smoothstep(1.0, 0.0, abs(coord.x));
  coord.y += waveOffset * edgeFalloff;

  float lineIntensity = smoothstep(u_lineThickness, 0.0, abs(coord.y));

  float yFade = smoothstep(1.0, 0.2, abs(coord.y));
  float xFade = smoothstep(1.0, 0.3, abs(coord.x));
  float combinedFade = yFade * xFade;

  return vec4(color * lineIntensity * combinedFade, 1.0);
}

void main() {
  vec2 coord = vUv * 2.0 - 1.0;
  coord.x *= u_resolution.x / u_resolution.y;

  coord /= u_scale;

  coord.x /= u_waveWidth;

  vec4 colorAccumulator = vec4(0.0);

  for (float i = 0.0; i <= 50.0; i += 1.0) {
    if (i >= u_waveCount) break;

    float progress = i / u_waveCount * 2.0;

    float lineSpeed = u_speed + progress * u_speedVariation;

    float colorMix = i / u_waveCount;
    vec3 waveColor = mix(u_startColor, u_endColor, colorMix);

    colorAccumulator += calculateWaveLine(coord, lineSpeed, progress, waveColor);
  }

  vec3 waveColor = colorAccumulator.rgb * u_brightness;

  float waveIntensity = clamp(length(waveColor), 0.0, 1.0);
  float grain = applyGrain(coord) * u_grainIntensity * waveIntensity;
  waveColor += vec3(grain);

  float bgLuminance = dot(u_backgroundColor, vec3(0.299, 0.587, 0.114));
  vec3 finalColor;
  if (bgLuminance > 0.5) {
    float waveAlpha = clamp(length(waveColor), 0.0, 1.0);
    finalColor = mix(u_backgroundColor, waveColor, waveAlpha);
  } else {
    finalColor = u_backgroundColor + waveColor;
  }

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

const rgb = (hex: string) => {
  const value = parseInt(hex.replace("#", ""), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ].map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
};
export default function GrainWave({
  theme = "dark",
  width = "100%",
  height = "100%",
  className = "",
  speed = 0.5,
  waveCount = 25,
  waveAmplitude = 0.85,
  waveFrequency = 4,
  lineThickness = 0.2,
  grainIntensity = 50,
  startColor = "#ff6666",
  endColor = "#6666ff",
  lightBackground = "#ffffff",
  darkBackground = "#000000",
  brightness = 1,
  speedVariation = 0.006,
  waveWidth = 3.5,
  scale = 0.6,
}: GrainWaveProps) {
  return (
    <div
      className={"grain-wave-container " + className}
      style={{ width, height }}
    >
      <ShaderSurface
        fragment={fragmentShader}
        uniforms={{
          u_speed: speed,
          u_waveCount: waveCount,
          u_waveAmplitude: waveAmplitude,
          u_waveFrequency: waveFrequency,
          u_lineThickness: lineThickness,
          u_grainIntensity: grainIntensity,
          u_startColor: rgb(startColor),
          u_endColor: rgb(endColor),
          u_backgroundColor: rgb(
            theme === "dark" ? darkBackground : lightBackground,
          ),
          u_brightness: brightness,
          u_speedVariation: speedVariation,
          u_waveWidth: waveWidth,
          u_scale: scale,
        }}
      />
    </div>
  );
}
