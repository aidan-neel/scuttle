import type { Database } from "bun:sqlite";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { UploadedAttachment } from "@scuttle/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const IMAGE_MIME_TO_EXT: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const EXT_TO_IMAGE_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const ALLOWED_EXTENSIONS = Object.values(IMAGE_MIME_TO_EXT);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dbAttachmentDirs = new WeakMap<Database, string>();

export const AttachmentErrorReason = Schema.Literals([
  "invalid_id",
  "invalid_mime",
  "invalid_payload",
  "too_large",
  "not_found",
  "io",
]);
export type AttachmentErrorReason = typeof AttachmentErrorReason.Type;

export class AttachmentServiceError extends Schema.TaggedError<AttachmentServiceError>()(
  "AttachmentServiceError",
  {
    reason: AttachmentErrorReason,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }

  get httpStatus(): number {
    switch (this.reason) {
      case "not_found":
        return 404;
      case "too_large":
        return 413;
      case "io":
        return 500;
      case "invalid_id":
      case "invalid_mime":
      case "invalid_payload":
        return 400;
    }
  }
}

export interface SaveUploadInput {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface ReadAttachmentResult {
  readonly id: string;
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly name: string;
}

export class AttachmentService extends Context.Service<
  AttachmentService,
  {
    readonly saveUpload: (
      input: SaveUploadInput,
    ) => Effect.Effect<UploadedAttachment, AttachmentServiceError>;
    readonly readAttachment: (
      id: string,
    ) => Effect.Effect<ReadAttachmentResult, AttachmentServiceError>;
    readonly resolveStoredPath: (id: string) => Effect.Effect<string, AttachmentServiceError>;
  }
>()("scuttle/server/AttachmentService") {}

interface AttachmentRow {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly ext: string;
  readonly created_at: string;
}

const normalizeMimeType = (raw: string): string => (raw.split(";")[0] ?? "").trim().toLowerCase();

const sanitizeAttachmentName = (rawName: string, ext: string): string => {
  const cleaned = rawName.replaceAll("\0", "").trim();
  const base = cleaned.split(/[/\\]/).findLast(Boolean)?.trim() ?? "";
  return (base.length > 0 ? base : `image.${ext}`).slice(0, 255);
};

const hasImageMagicBytes = (mimeType: string, bytes: Uint8Array): boolean => {
  switch (mimeType) {
    case "image/png":
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return (
        bytes.length >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61
      );
    case "image/webp":
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    default:
      return false;
  }
};

const parseSafeUuid = (rawId: string): string | null => {
  const trimmed = rawId.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
};

const buildSafeTargetPath = (attachmentsDir: string, id: string, ext: string): string | null => {
  const root = NodePath.resolve(attachmentsDir);
  const candidate = NodePath.resolve(root, `${id}.${ext}`);
  return candidate.startsWith(`${root}${NodePath.sep}`) ? candidate : null;
};

const readAttachmentRow = (db: Database, id: string): AttachmentRow | null =>
  db
    .query<AttachmentRow, [string]>(
      "SELECT id, kind, name, mime_type, size_bytes, ext, created_at FROM attachments WHERE id = ?",
    )
    .get(id);

const findAttachmentPathOnDisk = (
  attachmentsDir: string,
  id: string,
  preferredExt?: string,
): { readonly path: string; readonly ext: string } | null => {
  const candidates = preferredExt
    ? [preferredExt, ...ALLOWED_EXTENSIONS.filter((ext) => ext !== preferredExt)]
    : ALLOWED_EXTENSIONS;
  for (const ext of candidates) {
    const candidate = buildSafeTargetPath(attachmentsDir, id, ext);
    if (candidate && NodeFS.existsSync(candidate) && NodeFS.statSync(candidate).isFile()) {
      return { path: candidate, ext };
    }
  }
  return null;
};

export const resolveAttachmentDirForDb = (db: Database): string | null => {
  const registered = dbAttachmentDirs.get(db);
  if (registered) return registered;
  try {
    const dbs = db
      .query<{ readonly name: string; readonly file: string }, []>("PRAGMA database_list")
      .all();
    const main = dbs.find((entry) => entry.name === "main");
    if (main?.file && main.file.length > 0 && main.file !== ":memory:") {
      return NodePath.join(NodePath.dirname(main.file), "attachments");
    }
  } catch {
    return null;
  }
  return null;
};

export const tryReadStoredAttachment = (
  db: Database,
  rawId: string,
): {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly path: string;
  readonly bytes: Uint8Array;
} | null => {
  const id = parseSafeUuid(rawId);
  if (!id) return null;
  const attachmentsDir = resolveAttachmentDirForDb(db);
  if (!attachmentsDir) return null;
  const row = readAttachmentRow(db, id);
  const found = findAttachmentPathOnDisk(attachmentsDir, id, row?.ext);
  if (!found) return null;
  try {
    const bytes = new Uint8Array(NodeFS.readFileSync(found.path));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) return null;
    const mimeType = row?.mime_type ?? EXT_TO_IMAGE_MIME[found.ext];
    if (!mimeType || !Object.hasOwn(IMAGE_MIME_TO_EXT, mimeType)) return null;
    return {
      id,
      name: row?.name ?? `${id}.${found.ext}`,
      mimeType,
      path: found.path,
      bytes,
    };
  } catch {
    return null;
  }
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const { db } = yield* Sqlite.SqliteDatabase;
  const attachmentsDir = NodePath.resolve(config.dataDir, "attachments");
  dbAttachmentDirs.set(db, attachmentsDir);

  const resolveStoredPathSync = (rawId: string): Effect.Effect<string, AttachmentServiceError> => {
    const id = parseSafeUuid(rawId);
    if (!id) {
      return Effect.fail(
        new AttachmentServiceError({
          reason: "invalid_id",
          detail: "Attachment ID must be a valid UUID.",
        }),
      );
    }
    const row = readAttachmentRow(db, id);
    const found = findAttachmentPathOnDisk(attachmentsDir, id, row?.ext);
    if (!found) {
      return Effect.fail(
        new AttachmentServiceError({
          reason: "not_found",
          detail: `Attachment "${id}" was not found.`,
        }),
      );
    }
    return Effect.succeed(found.path);
  };

  const resolveStoredPath = Effect.fn("AttachmentService.resolveStoredPath")(function* (
    rawId: string,
  ) {
    return yield* resolveStoredPathSync(rawId);
  });

  const saveUpload = Effect.fn("AttachmentService.saveUpload")(function* (input: SaveUploadInput) {
    const mimeType = normalizeMimeType(input.mimeType);
    const ext = Object.hasOwn(IMAGE_MIME_TO_EXT, mimeType)
      ? IMAGE_MIME_TO_EXT[mimeType]
      : undefined;
    if (!ext) {
      return yield* new AttachmentServiceError({
        reason: "invalid_mime",
        detail:
          "Unsupported image MIME type. Allowed: image/png, image/jpeg, image/gif, image/webp.",
      });
    }
    if (input.bytes.byteLength === 0) {
      return yield* new AttachmentServiceError({
        reason: "invalid_payload",
        detail: "Image attachment cannot be empty.",
      });
    }
    if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return yield* new AttachmentServiceError({
        reason: "too_large",
        detail: "Image attachment exceeds the 20 MB limit.",
      });
    }
    if (!hasImageMagicBytes(mimeType, input.bytes)) {
      return yield* new AttachmentServiceError({
        reason: "invalid_payload",
        detail: `Image payload does not match declared MIME type "${mimeType}".`,
      });
    }

    const id = crypto.randomUUID().toLowerCase();
    const name = sanitizeAttachmentName(input.name, ext);
    const targetPath = buildSafeTargetPath(attachmentsDir, id, ext);
    if (!targetPath) {
      return yield* new AttachmentServiceError({
        reason: "invalid_id",
        detail: "Failed to resolve safe attachment storage path.",
      });
    }

    yield* Effect.try({
      try: () => {
        NodeFS.mkdirSync(attachmentsDir, { recursive: true });
        NodeFS.writeFileSync(targetPath, input.bytes);
        db.query(
          `INSERT INTO attachments (id, kind, name, mime_type, size_bytes, ext, created_at)
           VALUES (?, 'image', ?, ?, ?, ?, ?)`,
        ).run(id, name, mimeType, input.bytes.byteLength, ext, new Date().toISOString());
      },
      catch: (cause) =>
        new AttachmentServiceError({
          reason: "io",
          detail: cause instanceof Error ? cause.message : "Failed to persist attachment.",
        }),
    });

    return {
      id,
      kind: "image" as const,
      name,
      mimeType,
      sizeBytes: input.bytes.byteLength,
      url: `/api/attachments/${id}`,
    };
  });

  const readAttachment = Effect.fn("AttachmentService.readAttachment")(function* (rawId: string) {
    const path = yield* resolveStoredPathSync(rawId);
    const id = parseSafeUuid(rawId)!;
    const row = readAttachmentRow(db, id);
    const ext = NodePath.extname(path).slice(1).toLowerCase();
    const mimeType = row?.mime_type ?? EXT_TO_IMAGE_MIME[ext];
    if (!mimeType) {
      return yield* new AttachmentServiceError({
        reason: "not_found",
        detail: `Attachment "${id}" metadata was not found.`,
      });
    }
    const bytes = yield* Effect.try({
      try: () => new Uint8Array(NodeFS.readFileSync(path)),
      catch: (cause) =>
        new AttachmentServiceError({
          reason: "io",
          detail: cause instanceof Error ? cause.message : "Failed to read attachment.",
        }),
    });
    return {
      id,
      path,
      bytes,
      mimeType,
      name: row?.name ?? `${id}.${ext}`,
    };
  });

  return AttachmentService.of({
    saveUpload,
    readAttachment,
    resolveStoredPath,
  });
});

export const layer = Layer.effect(AttachmentService, make);
