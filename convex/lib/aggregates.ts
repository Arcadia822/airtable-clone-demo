import { TableAggregate } from "@convex-dev/aggregate";

import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

export const baseCount = new TableAggregate<{
  Namespace: string;
  Key: string;
  DataModel: DataModel;
  TableName: "bases";
}>(components.baseCount, {
  namespace: (doc) => doc.orgId,
  sortKey: (doc) => doc._id,
});

export const tableCount = new TableAggregate<{
  Namespace: string;
  Key: string;
  DataModel: DataModel;
  TableName: "tables";
}>(components.tableCount, {
  namespace: (doc) => doc.baseId,
  sortKey: (doc) => doc._id,
});

export const fieldCount = new TableAggregate<{
  Namespace: string;
  Key: string;
  DataModel: DataModel;
  TableName: "fields";
}>(components.fieldCount, {
  namespace: (doc) => doc.tableId,
  sortKey: (doc) => doc._id,
});

export const recordCount = new TableAggregate<{
  Namespace: string;
  Key: string;
  DataModel: DataModel;
  TableName: "records";
}>(components.recordCount, {
  namespace: (doc) => doc.orgId,
  sortKey: (doc) => doc._id,
});

export const tableRecordCount = new TableAggregate<{
  Namespace: string;
  Key: string;
  DataModel: DataModel;
  TableName: "records";
}>(components.tableRecordCount, {
  namespace: (doc) => doc.tableId,
  sortKey: (doc) => doc._id,
});

export const formCount = new TableAggregate<{
  Namespace: string;
  Key: string;
  DataModel: DataModel;
  TableName: "forms";
}>(components.formCount, {
  namespace: (doc) => doc.baseId,
  sortKey: (doc) => doc._id,
});

export const submissionCount = new TableAggregate<{
  Namespace: string;
  Key: string;
  DataModel: DataModel;
  TableName: "formSubmissions";
}>(components.submissionCount, {
  namespace: (doc) => `${doc.orgId}:${doc.submittedMonth}`,
  sortKey: (doc) => doc._id,
});

export const attachmentBytes = new TableAggregate<{
  Namespace: string;
  Key: string;
  DataModel: DataModel;
  TableName: "attachments";
}>(components.attachmentBytes, {
  namespace: (doc) => doc.orgId,
  sortKey: (doc) => doc._id,
  sumValue: (doc) => doc.size,
});

export const aiTurnCount = new TableAggregate<{
  Namespace: string;
  Key: string;
  DataModel: DataModel;
  TableName: "aiUsageEvents";
}>(components.aiTurnCount, {
  namespace: (doc) => `${doc.orgId}:${doc.month}`,
  sortKey: (doc) => doc._id,
});
