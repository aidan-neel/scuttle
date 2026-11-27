const SOFTWARE_RENDERER_RE =
  /swiftshader|llvmpipe|softpipe|software|mesa offscreen|basic render driver|vmware|virtualbox/i;

let cachedSoftwareRenderer: boolean | null = null;

export function detectSoftwareRenderer(): boolean {
  if (cachedSoftwareRenderer !== null) {
    return cachedSoftwareRenderer;
  }
  if (typeof document === "undefined") {
    return false;
  }

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
  if (!gl) {
    cachedSoftwareRenderer = true;
    return true;
  }

  let software = false;
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (debugInfo) {
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
    const info = `${typeof renderer === "string" ? renderer : ""} ${typeof vendor === "string" ? vendor : ""}`;
    software = SOFTWARE_RENDERER_RE.test(info);
  }

  gl.getExtension("WEBGL_lose_context")?.loseContext();
  cachedSoftwareRenderer = software;
  return software;
}

export function isSoftwareRenderer(): boolean {
  return detectSoftwareRenderer();
}

export function initRenderMode(): void {
  if (isSoftwareRenderer()) {
    document.documentElement.dataset.render = "software";
  }
}

export function resetRenderModeCache(): void {
  cachedSoftwareRenderer = null;
}
