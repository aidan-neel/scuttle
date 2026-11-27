import * as Schema from "effect/Schema";
import { ThreadId, TurnId } from "@scuttle/shared/ids";

const Text = (max: number) => Schema.String.check(Schema.isMaxLength(max));
const Key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120));
const Label = Text(200);
const Body = Text(4_000);
const Bounded = <S extends Schema.Top>(item: S, max: number) =>
  Schema.Array(item).check(Schema.isMaxLength(max));

export const VisualizationId = Key.pipe(Schema.brand("VisualizationId"));
export type VisualizationId = typeof VisualizationId.Type;

export const Tone = Schema.Literals(["neutral", "primary", "success", "warning", "danger"]);
export type Tone = typeof Tone.Type;

export const VizKpiItem = Schema.Struct({
  id: Schema.optionalKey(Key),
  label: Label,
  value: Schema.Union([Schema.Finite, Label]),
  delta: Schema.optionalKey(Label),
  tone: Schema.optionalKey(Tone),
  note: Schema.optionalKey(Label),
  sparkline: Schema.optionalKey(Bounded(Schema.Finite, 120)),
  filterKey: Schema.optionalKey(Key),
  filterValue: Schema.optionalKey(Label),
});
export type VizKpiItem = typeof VizKpiItem.Type;

export const VizKpiBlock = Schema.Struct({
  kind: Schema.Literal("kpis"),
  items: Bounded(VizKpiItem, 12),
});
export type VizKpiBlock = typeof VizKpiBlock.Type;

export const VizChartType = Schema.Literals([
  "bar",
  "horizontal-bar",
  "stacked-bar",
  "line",
  "area",
  "donut",
]);
export type VizChartType = typeof VizChartType.Type;

export const VizChartSeries = Schema.Struct({
  id: Key,
  label: Label,
  tone: Schema.optionalKey(Tone),
  values: Bounded(Schema.Finite, 500),
});
export type VizChartSeries = typeof VizChartSeries.Type;

export const VizChartBlock = Schema.Struct({
  kind: Schema.Literal("chart"),
  title: Schema.optionalKey(Label),
  subtitle: Schema.optionalKey(Label),
  chartType: VizChartType,
  unit: Schema.optionalKey(Text(24)),
  categories: Schema.optionalKey(Bounded(Label, 500)),
  series: Bounded(VizChartSeries, 12),
  filterKey: Schema.optionalKey(Key),
  height: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 120, maximum: 640 }))),
});
export type VizChartBlock = typeof VizChartBlock.Type;

export const VizColumnAlign = Schema.Literals(["left", "right"]);
export type VizColumnAlign = typeof VizColumnAlign.Type;

export const VizColumnKind = Schema.Literals(["text", "number", "badge", "bar", "code"]);
export type VizColumnKind = typeof VizColumnKind.Type;

export const VizTableColumn = Schema.Struct({
  key: Key,
  label: Label,
  align: Schema.optionalKey(VizColumnAlign),
  kind: Schema.optionalKey(VizColumnKind),
});
export type VizTableColumn = typeof VizTableColumn.Type;

export const VizCell = Schema.Union([Schema.Finite, Text(2_000)]);
export type VizCell = typeof VizCell.Type;

export const VizFilterTags = Schema.Record(Key, Label);
export type VizFilterTags = typeof VizFilterTags.Type;

export const VizTableRow = Schema.Struct({
  id: Key,
  cells: Schema.Record(Key, VizCell),
  tone: Schema.optionalKey(Tone),
  filterTags: Schema.optionalKey(VizFilterTags),
  detail: Schema.optionalKey(Body),
});
export type VizTableRow = typeof VizTableRow.Type;

export const VizTableBlock = Schema.Struct({
  kind: Schema.Literal("table"),
  title: Schema.optionalKey(Label),
  searchable: Schema.optionalKey(Schema.Boolean),
  filterColumn: Schema.optionalKey(Key),
  columns: Bounded(VizTableColumn, 16),
  rows: Bounded(VizTableRow, 1_000),
});
export type VizTableBlock = typeof VizTableBlock.Type;

export const VizComparisonItem = Schema.Struct({
  id: Key,
  title: Label,
  subtitle: Schema.optionalKey(Label),
  status: Label,
  tone: Schema.optionalKey(Tone),
  metric: Schema.optionalKey(Label),
  detail: Schema.optionalKey(Body),
  group: Schema.optionalKey(Label),
});
export type VizComparisonItem = typeof VizComparisonItem.Type;

export const VizComparisonBlock = Schema.Struct({
  kind: Schema.Literal("comparison"),
  title: Schema.optionalKey(Label),
  columns: Schema.optionalKey(Bounded(Label, 6)),
  items: Bounded(VizComparisonItem, 200),
});
export type VizComparisonBlock = typeof VizComparisonBlock.Type;

export const VizFlowDirection = Schema.Literals(["horizontal", "vertical"]);
export type VizFlowDirection = typeof VizFlowDirection.Type;

export const VizFlowNode = Schema.Struct({
  id: Key,
  label: Label,
  sublabel: Schema.optionalKey(Label),
  tone: Schema.optionalKey(Tone),
  badge: Schema.optionalKey(Text(40)),
  detail: Schema.optionalKey(Body),
  group: Schema.optionalKey(Label),
});
export type VizFlowNode = typeof VizFlowNode.Type;

export const VizFlowEdge = Schema.Struct({
  from: Key,
  to: Key,
  label: Schema.optionalKey(Text(60)),
  dashed: Schema.optionalKey(Schema.Boolean),
});
export type VizFlowEdge = typeof VizFlowEdge.Type;

export const VizFlowBlock = Schema.Struct({
  kind: Schema.Literal("flow"),
  title: Schema.optionalKey(Label),
  direction: Schema.optionalKey(VizFlowDirection),
  nodes: Bounded(VizFlowNode, 80),
  edges: Bounded(VizFlowEdge, 200),
});
export type VizFlowBlock = typeof VizFlowBlock.Type;

export const VizCalloutBlock = Schema.Struct({
  kind: Schema.Literal("callout"),
  tone: Schema.optionalKey(Tone),
  title: Schema.optionalKey(Label),
  body: Body,
});
export type VizCalloutBlock = typeof VizCalloutBlock.Type;

export const VizBlock = Schema.Union([
  VizKpiBlock,
  VizChartBlock,
  VizTableBlock,
  VizComparisonBlock,
  VizFlowBlock,
  VizCalloutBlock,
]);
export type VizBlock = typeof VizBlock.Type;

export const VizTab = Schema.Struct({
  id: Key,
  label: Label,
  badge: Schema.optionalKey(Text(40)),
  blocks: Bounded(VizBlock, 24),
});
export type VizTab = typeof VizTab.Type;

export const VizStructuredSpec = Schema.Struct({
  mode: Schema.Literal("structured"),
  title: Label,
  subtitle: Schema.optionalKey(Label),
  takeaway: Schema.optionalKey(Text(400)),
  tabs: Schema.optionalKey(Bounded(VizTab, 8)),
  blocks: Schema.optionalKey(Bounded(VizBlock, 24)),
});
export type VizStructuredSpec = typeof VizStructuredSpec.Type;

export const VizSandboxSpec = Schema.Struct({
  mode: Schema.Literal("sandbox"),
  title: Label,
  subtitle: Schema.optionalKey(Label),
  html: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200_000)),
  height: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 80, maximum: 1_600 })),
  ),
});
export type VizSandboxSpec = typeof VizSandboxSpec.Type;

export const ScuttleVizSpec = Schema.Union([VizStructuredSpec, VizSandboxSpec]);
export type ScuttleVizSpec = typeof ScuttleVizSpec.Type;

export const ThreadVisualization = Schema.Struct({
  id: VisualizationId,
  threadId: ThreadId,
  turnId: Schema.optionalKey(TurnId),
  title: Label,
  spec: ScuttleVizSpec,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ThreadVisualization = typeof ThreadVisualization.Type;

export const decodeScuttleVizSpec = Schema.decodeUnknownExit(ScuttleVizSpec);
