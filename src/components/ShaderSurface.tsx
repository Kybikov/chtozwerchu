import { useEffect, useRef } from "react";

// Small renderer for the licensed React Bits shader. One draw call, capped at
// 30 fps / 1200 backing pixels. No scene graph, textures or Three.js runtime.
export default function ShaderSurface({
  fragment,
  uniforms,
}: {
  fragment: string;
  uniforms: Record<string, number | number[]>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(uniforms);
  latest.current = uniforms;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const gl = element.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
    if (!gl) return;
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vertex = compile(
      gl.VERTEX_SHADER,
      "attribute vec2 aPosition; varying vec2 vUv; void main(){vUv=(aPosition+1.0)*0.5;gl_Position=vec4(aPosition,0.0,1.0);}",
    );
    const pixel = compile(gl.FRAGMENT_SHADER, fragment);
    if (!vertex || !pixel) {
      if (vertex) gl.deleteShader(vertex);
      if (pixel) gl.deleteShader(pixel);
      return;
    }
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, pixel);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(pixel);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const attribute = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    const names = ["u_time", "u_resolution", ...Object.keys(latest.current)];
    const locations = Object.fromEntries(
      names.map((name) => [name, gl.getUniformLocation(program, name)]),
    );
    const resize = () => {
      const rect = element.getBoundingClientRect();
      const ratio = Math.min(
        devicePixelRatio || 1,
        1,
        1200 / Math.max(rect.width, rect.height, 1),
      );
      element.width = Math.max(1, Math.round(rect.width * ratio));
      element.height = Math.max(1, Math.round(rect.height * ratio));
      gl.viewport(0, 0, element.width, element.height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let frame = 0,
      last = 0,
      alive = true;
    const born = performance.now();
    const draw = (now: number) => {
      if (!alive) return;
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / 30) return;
      last = now;
      gl.uniform1f(locations.u_time, (now - born) / 1000);
      gl.uniform2f(locations.u_resolution, element.width, element.height);
      for (const [name, value] of Object.entries(latest.current)) {
        if (Array.isArray(value)) {
          if (value.length === 3) gl.uniform3fv(locations[name], value);
          else gl.uniform2fv(locations[name], value);
        } else gl.uniform1f(locations[name], value);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    frame = requestAnimationFrame(draw);
    const lost = () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
    element.addEventListener("webglcontextlost", lost);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("webglcontextlost", lost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [fragment]);
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
