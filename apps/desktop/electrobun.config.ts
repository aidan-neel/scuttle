import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const copy: Record<string, string> = {
  "../web/dist": "views/mainview",
};

const vendoredSkillsDir = NodePath.resolve(import.meta.dirname, "../../vendor/astack/skills");
if (NodeFS.existsSync(vendoredSkillsDir)) {
  copy["../../vendor/astack/skills"] = "astack/skills";
}

export default {
  app: {
    name: "Scuttle",
    identifier: "dev.scuttle.app",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy,
    mac: {
      icons: "assets/icon.iconset",
    },
    linux: {
      icon: "assets/icon.png",
    },
    win: {
      icon: "assets/icon.ico",
    },
  },
  release: {
    generatePatch: false,
  },
};
