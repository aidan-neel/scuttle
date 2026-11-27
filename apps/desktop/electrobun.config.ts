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
    copy: {
      "../web/dist": "views/mainview",
    },
    mac: {
      icons: "assets/icon.iconset",
    },
    linux: {
      icon: "assets/icon.png",
    },
    win: {
      icon: "assets/icon.png",
    },
  },
};
