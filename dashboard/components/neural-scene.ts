import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, DynamicDrawUsage, Float32BufferAttribute,
  Group, LineBasicMaterial, LineSegments, PerspectiveCamera, Points, PointsMaterial, Scene, Vector3, WebGLRenderer,
} from "three";

export function startNeuralScene(host: HTMLElement, pointerArea: HTMLElement) {
  const renderer = new WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.append(renderer.domElement);
  const scene = new Scene();
  const network = new Group();
  scene.add(network);
  const camera = new PerspectiveCamera(39, 1, 0.1, 30);
  camera.position.z = 9.6;
  const compact = host.clientWidth < 410;
  const count = compact ? 58 : 114;
  function readPalette() {
    const palette = getComputedStyle(host);
    return ["--scene-violet", "--scene-lavender", "--scene-cyan", "--scene-blue"]
      .map((token) => new Color(palette.getPropertyValue(token).trim()));
  }
  const colors = readPalette();
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = textureCanvas.height = 32;
  const brush = textureCanvas.getContext("2d")!;
  const gradient = brush.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.23, "rgba(255,255,255,.85)");
  gradient.addColorStop(0.52, "rgba(255,255,255,.24)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  brush.fillStyle = gradient;
  brush.fillRect(0, 0, 32, 32);
  const texture = new CanvasTexture(textureCanvas);
  const nodes = Array.from({ length: count }, (_, index) => {
    const latitude = Math.acos(1 - 2 * (index + .5) / count);
    const longitude = index * 2.399963;
    const layer = index % 9 === 0 ? .48 : index % 3 === 0 ? .76 : 1;
    return new Vector3(
      Math.sin(latitude) * Math.cos(longitude) * 3.05 * layer,
      Math.cos(latitude) * 1.55 * layer,
      Math.sin(latitude) * Math.sin(longitude) * 1.6 * layer,
    );
  });
  const connections: Array<[Vector3, Vector3]> = [];
  for (let i = 0; i < nodes.length; i++) {
    const point = nodes[i]!;
    const neighbors = nodes.slice(i + 1).filter((next) => point.distanceToSquared(next) < 2.45);
    for (const neighbor of neighbors.slice(0, compact ? 3 : 4)) connections.push([point, neighbor]);
  }
  const vertices = new BufferGeometry().setFromPoints(nodes);
  vertices.setAttribute("color", new Float32BufferAttribute(nodes.flatMap((point, i) => {
    const color = colors[(point.x > 1.25 ? 2 : i % 4)]!;
    return [color.r, color.g, color.b];
  }), 3));
  const edges = new BufferGeometry().setFromPoints(connections.flat());
  const core = new BufferGeometry().setFromPoints(nodes.filter((_, i) => i % 13 === 0));
  const pulseCount = Math.min(connections.length, compact ? 7 : 14);
  const pulsePosition = new Float32BufferAttribute(new Float32Array(pulseCount * 3), 3).setUsage(DynamicDrawUsage);
  const pulses = new BufferGeometry().setAttribute("position", pulsePosition);
  const line = new LineBasicMaterial({ color: colors[0], transparent: true, opacity: .38, depthWrite: false, blending: AdditiveBlending });
  const node = new PointsMaterial({ map: texture, vertexColors: true, size: .145, transparent: true, opacity: .92, depthWrite: false, blending: AdditiveBlending });
  const glow = new PointsMaterial({ map: texture, color: colors[1], size: .47, transparent: true, opacity: .66, depthWrite: false, blending: AdditiveBlending });
  const energy = new PointsMaterial({ map: texture, color: colors[2], size: .22, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const packets = new Points(pulses, energy);
  packets.frustumCulled = false;
  network.add(new LineSegments(edges, line), new Points(vertices, node), new Points(core, glow), packets);

  let x = 0, y = 0, time = 0, last = 0, frame = 0;
  let visible = true;
  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.position.z = Math.max(6.8, 9 / camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.15 : 1.5));
    renderer.setSize(width, height, false);
  }
  function render(now: number) {
    frame = 0;
    if (!visible || document.hidden) return;
    frame = requestAnimationFrame(render);
    if (last && now - last < (compact ? 32 : 15)) return;
    time += last ? Math.min((now - last) / 1000, .05) : 0;
    last = now;
    network.rotation.x += (y * .16 + Math.sin(time * .5) * .11 - network.rotation.x) * .065;
    network.rotation.y += (x * .24 + Math.sin(time * .34) * .42 - network.rotation.y) * .065;
    network.rotation.z = -.12 + Math.sin(time * .44) * .06;
    for (let i = 0; i < pulseCount; i++) {
      const [a, b] = connections[Math.floor(i * connections.length / pulseCount)]!;
      const t = (time * (.28 + i % 4 * .06) + i * .37) % 1;
      pulsePosition.setXYZ(i, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    }
    pulsePosition.needsUpdate = true;
    renderer.render(scene, camera);
    if (host.dataset.renderState !== "active") host.dataset.renderState = "active";
  }
  function sync() {
    last = 0;
    if (visible && !document.hidden) {
      if (!frame) frame = requestAnimationFrame(render);
    } else {
      cancelAnimationFrame(frame);
      frame = 0;
      if (host.dataset.renderState === "active") host.dataset.renderState = "paused";
    }
  }
  function move(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    const rect = pointerArea.getBoundingClientRect();
    x = (event.clientX - rect.left) / rect.width * 2 - 1;
    y = (event.clientY - rect.top) / rect.height * 2 - 1;
  }
  function reset() { x = 0; y = 0; }
  function loseContext() {
    visible = false;
    sync();
    host.dataset.renderState = "static";
  }

  const theme = new MutationObserver(() => {
    const colors = readPalette();
    line.color.copy(colors[0]!);
    glow.color.copy(colors[1]!);
    energy.color.copy(colors[2]!);
    const attribute = vertices.getAttribute("color");
    nodes.forEach((point, i) => {
      const color = colors[point.x > 1.25 ? 2 : i % 4]!;
      attribute.setXYZ(i, color.r, color.g, color.b);
    });
    attribute.needsUpdate = true;
  });
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const sizes = new ResizeObserver(resize);
  const intersection = new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; sync(); });
  sizes.observe(host);
  intersection.observe(host);
  document.addEventListener("visibilitychange", sync);
  renderer.domElement.addEventListener("webglcontextlost", loseContext);
  pointerArea.addEventListener("pointermove", move, { passive: true });
  pointerArea.addEventListener("pointerleave", reset);
  resize();
  sync();

  return () => {
    cancelAnimationFrame(frame);
    theme.disconnect();
    sizes.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", sync);
    pointerArea.removeEventListener("pointermove", move);
    pointerArea.removeEventListener("pointerleave", reset);
    renderer.domElement.removeEventListener("webglcontextlost", loseContext);
    [line, node, glow, energy, vertices, edges, core, pulses, texture].forEach((resource) => resource.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    host.dataset.renderState = "static";
  };
}
