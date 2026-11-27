import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  detectSoftwareRenderer,
  initRenderMode,
  isSoftwareRenderer,
  resetRenderModeCache,
} from "../../src/lib/renderMode.ts";

interface MockDebugInfo {
  UNMASKED_RENDERER_WEBGL: number;
  UNMASKED_VENDOR_WEBGL: number;
}

interface MockGl {
  getExtension: (name: string) => MockDebugInfo | { loseContext: () => void } | null;
  getParameter: (param: number) => unknown;
}

const RENDERER_PARAM = 0x9246;
const VENDOR_PARAM = 0x9245;

function installMockDocument(options: {
  gl: MockGl | null;
  onCreateCanvas?: () => void;
  onGetContext?: (contextId: string, attrs?: unknown) => void;
}): { dataset: Record<string, string | undefined> } {
  const dataset: Record<string, string | undefined> = {};
  const mockCanvas = {
    getContext: (contextId: string, attrs?: unknown) => {
      options.onGetContext?.(contextId, attrs);
      return options.gl;
    },
  };
  const mockDocument = {
    documentElement: { dataset },
    createElement: (tag: string) => {
      if (tag === "canvas") {
        options.onCreateCanvas?.();
        return mockCanvas;
      }
      return {};
    },
  };
  Reflect.set(globalThis, "document", mockDocument);
  return { dataset };
}

describe("renderMode", () => {
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

  beforeEach(() => {
    resetRenderModeCache();
  });

  afterEach(() => {
    resetRenderModeCache();
    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  });

  test("returns false when document is undefined", () => {
    Reflect.deleteProperty(globalThis, "document");
    expect(detectSoftwareRenderer()).toBe(false);
    expect(isSoftwareRenderer()).toBe(false);
  });

  test("returns true when WebGL context with failIfMajorPerformanceCaveat is null", () => {
    let capturedAttrs: unknown;
    installMockDocument({
      gl: null,
      onGetContext: (_id, attrs) => {
        capturedAttrs = attrs;
      },
    });

    expect(detectSoftwareRenderer()).toBe(true);
    expect(isSoftwareRenderer()).toBe(true);
    expect(capturedAttrs).toEqual({ failIfMajorPerformanceCaveat: true });
  });

  test.each([
    ["Google SwiftShader", "Google Inc. (Google)"],
    ["llvmpipe (LLVM 15.0.7, 256 bits)", "Mesa"],
    ["softpipe", "Mesa/X.org"],
    ["Software Adapter", "Unknown"],
    ["Mesa Offscreen", "Mesa"],
    ["Microsoft Basic Render Driver", "Microsoft"],
    ["SVGA3D; build: RELEASE; LLVM;", "VMware, Inc."],
    ["VirtualBox Graphics Adapter", "Oracle"],
  ])("detects software renderer string %s (%s) and releases context", (renderer, vendor) => {
    let lostContext = false;
    installMockDocument({
      gl: {
        getExtension: (name) => {
          if (name === "WEBGL_debug_renderer_info") {
            return {
              UNMASKED_RENDERER_WEBGL: RENDERER_PARAM,
              UNMASKED_VENDOR_WEBGL: VENDOR_PARAM,
            };
          }
          if (name === "WEBGL_lose_context") {
            return {
              loseContext: () => {
                lostContext = true;
              },
            };
          }
          return null;
        },
        getParameter: (param) => {
          if (param === RENDERER_PARAM) return renderer;
          if (param === VENDOR_PARAM) return vendor;
          return null;
        },
      },
    });

    expect(detectSoftwareRenderer()).toBe(true);
    expect(lostContext).toBe(true);
  });

  test("returns false for hardware GPU renderer and releases context", () => {
    let lostContext = false;
    installMockDocument({
      gl: {
        getExtension: (name) => {
          if (name === "WEBGL_debug_renderer_info") {
            return {
              UNMASKED_RENDERER_WEBGL: RENDERER_PARAM,
              UNMASKED_VENDOR_WEBGL: VENDOR_PARAM,
            };
          }
          if (name === "WEBGL_lose_context") {
            return {
              loseContext: () => {
                lostContext = true;
              },
            };
          }
          return null;
        },
        getParameter: (param) => {
          if (param === RENDERER_PARAM) return "ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)";
          if (param === VENDOR_PARAM) return "Google Inc. (Apple)";
          return null;
        },
      },
    });

    expect(isSoftwareRenderer()).toBe(false);
    expect(lostContext).toBe(true);
  });

  test("memoizes detection result across calls", () => {
    let createCanvasCount = 0;
    installMockDocument({
      gl: null,
      onCreateCanvas: () => {
        createCanvasCount += 1;
      },
    });

    expect(detectSoftwareRenderer()).toBe(true);
    expect(isSoftwareRenderer()).toBe(true);
    expect(detectSoftwareRenderer()).toBe(true);
    expect(createCanvasCount).toBe(1);
  });

  test("initRenderMode sets data-render=software only for software renderers", () => {
    const { dataset: swDataset } = installMockDocument({ gl: null });
    initRenderMode();
    expect(swDataset.render).toBe("software");

    resetRenderModeCache();
    const { dataset: hwDataset } = installMockDocument({
      gl: {
        getExtension: () => null,
        getParameter: () => null,
      },
    });
    initRenderMode();
    expect(hwDataset.render).toBeUndefined();
  });
});
